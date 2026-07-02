import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import type { KapsoV2Payload, KapsoV2Item } from '@/types';
import {
  identificarCliente,
  obtenerOCrearConversacion,
  obtenerHistorialMensajes,
  guardarMensaje,
} from '@/lib/query-cards';
import { clasificarIntencion } from '@/lib/intenciones';
import { procesarConClaude } from '@/lib/agent-core';
import { fallbackGroq } from '@/lib/groq';
import { sendMessage } from '@/lib/kapso/sendMessage';
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

function extraerTexto(item: KapsoV2Item): string {
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
    console.error('[kapso-webhook] JSON inválido');
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Solo procesar mensajes entrantes de WhatsApp
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

    // Agrupar por conversation.id — junta mensajes del mismo tendero en la ventana de buffering
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

    await Promise.allSettled(
      Array.from(grupos.entries()).map(async ([kapsoConvId, grupo]) => {
        const whatsapp = grupo.whatsapp;

        // Mensajes del mismo tendero en la ventana → un único turno para el agente
        const textoUsuario = grupo.items
          .map(extraerTexto)
          .filter(Boolean)
          .join(' / ');

        if (!textoUsuario.trim()) return;

        const empresa_id = EMPRESA_ID;

        // 1. Identificar tendero por número de WhatsApp en tabla clientes de Neon
        const { data: cliente } = await identificarCliente(empresa_id, whatsapp);

        // 2. Obtener o crear conversación en Neon
        const conversacion_id = await obtenerOCrearConversacion(empresa_id, whatsapp, cliente?.id);

        // 3. Guardar cada mensaje individual en tabla mensajes
        for (const item of grupo.items) {
          const texto = extraerTexto(item);
          if (!texto) continue;
          await guardarMensaje({
            conversacion_id,
            empresa_id,
            rol: 'user',
            contenido: texto,
            tipo: item.message?.type ?? 'text',
            kapso_message_id: item.message?.id,
          });
        }

        // 4. Obtener historial y clasificar intención
        const historial = await obtenerHistorialMensajes(conversacion_id, 10);
        const intencion = clasificarIntencion(textoUsuario);

        console.log(`[kapso-webhook] Tendero: ${whatsapp} | Intención: ${intencion} | Texto: "${textoUsuario}"`);

        // 5. Procesar con Claude (Query Card según intención → respuesta)
        try {
          await procesarConClaude({
            empresa_id,
            whatsapp,
            cliente,
            conversacion_id,
            textoUsuario,
            intencion,
            historial,
          });
          console.log(`[kapso-webhook] Conversación procesada: ${kapsoConvId}`);
        } catch (claudeError) {
          console.error(`[kapso-webhook] Error Claude para ${kapsoConvId}, Groq fallback:`, claudeError);

          // 6. Fallback Groq → respuesta de emergencia por WhatsApp
          const respuesta = await fallbackGroq(historial, textoUsuario);
          await sendMessage(whatsapp, respuesta);
          await guardarMensaje({
            conversacion_id,
            empresa_id,
            rol: 'assistant',
            contenido: respuesta,
          });

          if (cliente && process.env.ASESOR_EMAIL) {
            await notificarEscalado({
              asesor_email: process.env.ASESOR_EMAIL,
              cliente_nombre: cliente.nombre,
              whatsapp,
              motivo: 'Error en el agente IA — requiere atención manual',
              conversacion_id,
            });
          }
        }
      })
    );

    console.log(`[kapso-webhook] Procesado: ${grupos.size} conversaciones`);
    return NextResponse.json({ ok: true, processed: grupos.size });
  } catch (error) {
    console.error('[kapso-webhook] Error crítico:', error);
    return NextResponse.json({ ok: true });
  }
}
