import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import type { KapsoV2Payload, KapsoV2Item } from '@/types';
import {
  identificarCliente,
  crearClienteTemporal,
  obtenerOCrearConversacion,
  obtenerHistorialMensajes,
  guardarMensaje,
} from '@/lib/query-cards';
import { clasificarIntencion } from '@/lib/intenciones';
import { procesarConClaude, procesarNuevoCliente } from '@/lib/agent-core';
import { fallbackGroq } from '@/lib/groq';
import { sendMessage } from '@/lib/kapso/sendMessage';
import { descargarMedia } from '@/lib/kapso';
import { transcribirAudio } from '@/lib/gemini';
import { notificarEscalado } from '@/lib/resend';
import { sql } from '@/lib/db';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

let tablaInicializada = false;

async function ensureTablaIdempotency(): Promise<void> {
  if (tablaInicializada) return;
  await sql`
    CREATE TABLE IF NOT EXISTS webhook_events_procesados (
      idempotency_key TEXT PRIMARY KEY,
      empresa_id      TEXT,
      procesado_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  tablaInicializada = true;
}

function verificarFirma(rawBody: string, signature: string): boolean {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[kapso-webhook] KAPSO_WEBHOOK_SECRET no está definida en Vercel');
    return false;
  }
  const esperada = createHmac('sha256', secret).update(rawBody).digest('hex');
  return esperada === signature;
}

function normalizarWhatsapp(numero: string): string {
  // Kapso envía sin +, la BD puede tener con o sin — normalizamos a sin +
  return numero.replace(/^\+/, '');
}

async function extraerTexto(item: KapsoV2Item): Promise<string> {
  const tipo = item.message?.type;

  if (tipo === 'interactive') {
    const interactive = item.message?.interactive;
    return (
      interactive?.list_reply?.id ??
      interactive?.button_reply?.id ??
      ''
    );
  }

  if (tipo === 'audio') {
    console.log('[audio] tipo de mensaje recibido:', tipo);
    console.log('[audio] Payload completo del mensaje:', JSON.stringify(item.message));

    const audioId = item.message?.audio?.id;
    const audioUrl = item.message?.audio?.url;
    console.log('[audio] audio.id:', audioId, '| audio.url:', audioUrl);

    if (!audioId) {
      console.error('[audio] No hay audio.id en el payload, no se puede descargar');
      return '';
    }
    try {
      console.log('[audio] Iniciando descarga con media_id:', audioId, 'phone_number_id:', item.phone_number_id);
      const buffer = await descargarMedia(audioId, item.phone_number_id);
      console.log('[audio] Descarga exitosa, bytes:', buffer.length);

      const base64 = buffer.toString('base64');
      const mime = item.message?.audio?.mime_type ?? 'audio/ogg';
      console.log('[audio] Enviando a Gemini... mime:', mime);

      const transcripcion = await transcribirAudio(base64, mime);
      console.log('[audio] Transcripción:', transcripcion);
      return transcripcion;
    } catch (e) {
      console.error('[audio] Error transcribiendo audio:', e);
      return '';
    }
  }

  return item.message?.text?.body ?? '';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature') ?? '';

  if (!verificarFirma(rawBody, signature)) {
    console.error('[kapso-webhook] Firma inválida');
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  let payload: KapsoV2Payload;
  try {
    payload = JSON.parse(rawBody) as KapsoV2Payload;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (payload.type !== 'whatsapp.message.received') {
    return NextResponse.json({ ok: true });
  }

  const items: KapsoV2Item[] = Array.isArray(payload.data) ? payload.data : [];
  if (items.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const idempotencyKey = request.headers.get('x-idempotency-key');

  try {
    await ensureTablaIdempotency();

    if (idempotencyKey) {
      const existente = await sql`
        SELECT 1 FROM webhook_events_procesados
        WHERE idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existente.length > 0) {
        console.log(`[kapso-webhook] Duplicado ignorado: ${idempotencyKey}`);
        return NextResponse.json({ ok: true, duplicate: true });
      }
      await sql`
        INSERT INTO webhook_events_procesados (idempotency_key, empresa_id)
        VALUES (${idempotencyKey}, ${EMPRESA_ID})
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
    }

    console.log(`[kapso-webhook] Mensajes recibidos: ${items.length}`);

    // Agrupar por conversation.id para unir mensajes del mismo tendero en la ventana de buffering
    const grupos = new Map<string, { items: KapsoV2Item[]; whatsapp: string }>();
    for (const item of items) {
      const convId = item.conversation?.id ?? item.message?.from;
      const whatsapp = item.message?.from;
      if (!convId || !whatsapp) continue;
      if (!grupos.has(convId)) {
        grupos.set(convId, { items: [], whatsapp });
      }
      grupos.get(convId)!.items.push(item);
    }

    const resultados = await Promise.allSettled(
      Array.from(grupos.entries()).map(async ([kapsoConvId, grupo]) => {
        const whatsappRaw = grupo.whatsapp;
        const whatsapp = normalizarWhatsapp(whatsappRaw);

        const textos = await Promise.all(grupo.items.map(extraerTexto));
        const textoUsuario = textos.filter(Boolean).join(' / ');

        if (!textoUsuario.trim()) return;

        const empresa_id = EMPRESA_ID;
        console.log(`[kapso-webhook] empresa_id="${empresa_id}" whatsapp="${whatsapp}" texto="${textoUsuario}"`);

        // 1. Buscar tendero en clientes por número WhatsApp
        const { data: cliente } = await identificarCliente(empresa_id, whatsapp);
        console.log(`[kapso-webhook] Cliente encontrado: ${cliente ? cliente.id : 'NO'}`);

        // 2. Si no existe, crear cliente temporal, mostrar categorías y terminar
        if (!cliente) {
          const { data: nuevo, error: errCliente } = await crearClienteTemporal(empresa_id, whatsapp);
          if (!nuevo) {
            console.error(`[kapso-webhook] Error creando cliente temporal:`, errCliente);
            return;
          }
          const conv_id = await obtenerOCrearConversacion(empresa_id, nuevo.id);
          await guardarMensaje({ conversacion_id: conv_id, rol: 'cliente', contenido: textoUsuario });
          await procesarNuevoCliente(empresa_id, nuevo, whatsappRaw, conv_id);
          console.log(`[kapso-webhook] Bienvenida con categorías enviada a: ${whatsapp}`);
          return;
        }

        console.log(`[kapso-webhook] Tendero: ${cliente.nombre_negocio ?? cliente.nombre_contacto ?? whatsapp}`);

        // 3. Obtener o crear conversación activa
        const conversacion_id = await obtenerOCrearConversacion(empresa_id, cliente.id);
        console.log(`[kapso-webhook] Conversación: ${conversacion_id}`);

        // 4. Guardar mensajes entrantes en tabla mensajes
        for (const item of grupo.items) {
          const tipo = item.message?.type ?? 'texto';
          // Para el guardado individual usamos el texto ya extraído en textoUsuario
          // Audio se guarda como '[audio transcrito]' para no re-llamar Gemini
          const textoItem =
            tipo === 'audio'
              ? '[audio transcrito]'
              : tipo === 'interactive'
              ? (item.message?.interactive?.list_reply?.id ?? item.message?.interactive?.button_reply?.id ?? '')
              : (item.message?.text?.body ?? '');
          if (!textoItem) continue;
          await guardarMensaje({
            conversacion_id,
            rol: 'cliente',
            contenido: textoItem,
            tipo,
          });
        }

        // 5. Historial + intención
        const historial = await obtenerHistorialMensajes(conversacion_id, 10);
        const intencion = clasificarIntencion(textoUsuario);
        console.log(`[kapso-webhook] Intención: ${intencion} | Texto: "${textoUsuario}"`);

        // 6. Procesar con Claude → Query Card según intención → respuesta
        try {
          await procesarConClaude({
            empresa_id,
            whatsapp: whatsappRaw,
            cliente,
            conversacion_id,
            textoUsuario,
            intencion,
            historial,
          });
          console.log(`[kapso-webhook] Conversación respondida: ${kapsoConvId}`);
        } catch (claudeError) {
          console.error(`[kapso-webhook] Error Claude, Groq fallback:`, claudeError);

          // Fallback Groq + guardar respuesta de emergencia
          const respuesta = await fallbackGroq(historial, textoUsuario);
          await sendMessage(whatsappRaw, respuesta);
          await guardarMensaje({ conversacion_id, rol: 'agente', contenido: respuesta });

          if (process.env.ASESOR_EMAIL) {
            await notificarEscalado({
              asesor_email: process.env.ASESOR_EMAIL,
              cliente_nombre: cliente.nombre_negocio ?? cliente.nombre_contacto ?? whatsapp,
              whatsapp: whatsappRaw,
              motivo: 'Error en el agente IA — requiere atención manual',
              conversacion_id,
            });
          }
        }
      })
    );

    resultados.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[kapso-webhook] Error en grupo ${i}:`, r.reason);
      }
    });

    console.log(`[kapso-webhook] Procesado: ${grupos.size} conversaciones`);
    return NextResponse.json({ ok: true, processed: grupos.size });
  } catch (error) {
    console.error('[kapso-webhook] Error crítico:', error);
    return NextResponse.json({ ok: true });
  }
}
