import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import type { KapsoStructuredMessage } from '@/types';
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

// Evita repetir CREATE TABLE en lambdas calientes
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

// Extrae texto de forma defensiva: primero message.text.body, luego text plano
function extraerTexto(msg: KapsoStructuredMessage): string {
  return msg.message?.text?.body ?? msg.text ?? '';
}

function normalizarAMensajes(payload: unknown): KapsoStructuredMessage[] {
  const p = payload as Record<string, unknown>;
  if (p.batch === true && Array.isArray(p.data)) {
    return p.data as KapsoStructuredMessage[];
  }
  return [p as unknown as KapsoStructuredMessage];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  const signature = request.headers.get('x-webhook-signature') ?? '';

  if (!verificarFirma(rawBody, signature)) {
    console.error('[kapso-webhook] Firma inválida');
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error('[kapso-webhook] JSON inválido');
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const idempotencyKey = request.headers.get('x-idempotency-key');

  try {
    await ensureTablaIdempotency();

    // Verificar duplicado
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
      // Marcar como en proceso antes de ejecutar
      await sql`
        INSERT INTO webhook_events_procesados (idempotency_key, empresa_id)
        VALUES (${idempotencyKey}, ${EMPRESA_ID})
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
    }

    const mensajes = normalizarAMensajes(payload);
    console.log(`[kapso-webhook] Mensajes recibidos: ${mensajes.length}`);

    // Agrupar por conversation_id (o por número si no viene)
    const grupos = new Map<string, { mensajes: KapsoStructuredMessage[]; from: string }>();
    for (const msg of mensajes) {
      if (msg.event !== 'whatsapp.message.received') continue;
      const clave = msg.conversation_id ?? msg.from;
      if (!grupos.has(clave)) {
        grupos.set(clave, { mensajes: [], from: msg.from });
      }
      grupos.get(clave)!.mensajes.push(msg);
    }

    if (grupos.size === 0) {
      console.log('[kapso-webhook] Sin mensajes whatsapp.message.received que procesar');
      return NextResponse.json({ ok: true, processed: 0 });
    }

    // Procesar cada conversación en paralelo
    await Promise.allSettled(
      Array.from(grupos.entries()).map(async ([claveConversacion, grupo]) => {
        const whatsapp = grupo.from;

        // Unir mensajes del mismo cliente en un único turno de conversación
        const textoUsuario = grupo.mensajes
          .map(extraerTexto)
          .filter(Boolean)
          .join(' / ');

        if (!textoUsuario.trim()) return;

        const empresa_id = EMPRESA_ID;

        const { data: cliente } = await identificarCliente(empresa_id, whatsapp);
        const conversacion_id = await obtenerOCrearConversacion(
          empresa_id,
          whatsapp,
          cliente?.id
        );

        // Guardar cada mensaje individual en el historial
        for (const msg of grupo.mensajes) {
          const texto = extraerTexto(msg);
          if (!texto) continue;
          await guardarMensaje({
            conversacion_id,
            empresa_id,
            rol: 'user',
            contenido: texto,
            tipo: msg.type ?? 'text',
            kapso_message_id: msg.message_id ?? msg.message?.id,
          });
        }

        const historial = await obtenerHistorialMensajes(conversacion_id, 10);
        const intencion = clasificarIntencion(textoUsuario);

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
          console.log(`[kapso-webhook] Conversación procesada: ${claveConversacion}`);
        } catch (claudeError) {
          console.error(
            `[kapso-webhook] Error en Claude para ${claveConversacion}, usando Groq fallback:`,
            claudeError
          );
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
    // Responder 200 para evitar reintentos infinitos de Kapso
    return NextResponse.json({ ok: true });
  }
}
