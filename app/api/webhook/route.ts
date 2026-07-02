import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import type { KapsoWebhookPayload } from '@/types';
import {
  identificarCliente,
  obtenerOCrearConversacion,
  obtenerHistorialMensajes,
  guardarMensaje,
} from '@/lib/query-cards';
import { getCached, setCached } from '@/lib/cache';
import { clasificarIntencion } from '@/lib/intenciones';
import { procesarConClaude } from '@/lib/agent-core';
import { responderConGroq } from '@/lib/groq';
import { transcribirAudio, } from '@/lib/gemini';
import { descargarMedia, enviarTexto } from '@/lib/kapso';
import { notificarEscalado } from '@/lib/resend';
import { GROQ_SALUDO_PROMPT } from '@/lib/agent-prompt';

// Empresa por defecto (multi-tenant: en producción vendrá del token Kapso)
const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

function verificarFirmaKapso(payload: string, signature: string): boolean {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) return false;
  const esperada = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${esperada}` === signature;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-kapso-signature') ?? '';

  if (!verificarFirmaKapso(rawBody, signature)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  let payload: KapsoWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Solo procesar eventos de mensaje entrante
  if (payload.event !== 'message' || !payload.message) {
    return NextResponse.json({ ok: true });
  }

  const msg = payload.message;
  const whatsapp = msg.from;
  const empresa_id = payload.empresa_id ?? EMPRESA_ID;

  try {
    // 1. Identificar cliente
    const { data: cliente } = await identificarCliente(empresa_id, whatsapp);

    // 2. Obtener o crear conversación
    const conversacion_id = cliente?.id
      ? await obtenerOCrearConversacion(empresa_id, cliente.id)
      : '';

    // 3. Extraer texto del mensaje (manejar audio)
    let textoUsuario = '';
    let tipoMensaje = msg.type;

    if (msg.type === 'audio' && msg.audio) {
      try {
        const audioBuffer = await descargarMedia(msg.audio.id);
        const audioBase64 = audioBuffer.toString('base64');
        textoUsuario = await transcribirAudio(audioBase64, msg.audio.mime_type);
        tipoMensaje = 'text'; // después de transcribir, es texto
      } catch (e) {
        console.error('[webhook] Error transcribiendo audio:', e);
        await enviarTexto(
          whatsapp,
          'No pude procesar tu audio. ¿Me puedes escribir tu mensaje?'
        );
        return NextResponse.json({ ok: true });
      }
    } else if (msg.type === 'text' && msg.text) {
      textoUsuario = msg.text.body;
    } else if (msg.type === 'interactive' && msg.interactive) {
      textoUsuario =
        msg.interactive.list_reply?.title ??
        msg.interactive.button_reply?.title ??
        '';
    } else {
      await enviarTexto(whatsapp, 'Por ahora solo proceso texto y audios. ¿En qué te ayudo?');
      return NextResponse.json({ ok: true });
    }

    if (!textoUsuario.trim()) return NextResponse.json({ ok: true });

    // 4. Guardar mensaje del usuario
    await guardarMensaje({
      conversacion_id,
      rol: 'cliente',
      contenido: textoUsuario,
      tipo: tipoMensaje,
    });

    // 5. Clasificar intención
    const intencion = clasificarIntencion(textoUsuario);

    // 6. Fallback rápido: saludos y ACKs via Groq (<200ms objetivo)
    if (intencion === 'saludo') {
      const cacheKey = `saludo_${textoUsuario.toLowerCase().trim()}`;
      const cached = await getCached(empresa_id, 'saludo', cacheKey);
      let respuesta: string;

      if (cached) {
        respuesta = cached;
      } else {
        respuesta = await responderConGroq(GROQ_SALUDO_PROMPT, textoUsuario);
        await setCached(empresa_id, 'saludo', cacheKey, respuesta, 3600);
      }

      await enviarTexto(whatsapp, respuesta);
      await guardarMensaje({
        conversacion_id,
        rol: 'agente',
        contenido: respuesta,
      });
      return NextResponse.json({ ok: true });
    }

    // 7. Historial de conversación para contexto del LLM
    const historial = await obtenerHistorialMensajes(conversacion_id, 10);

    // 8. Procesar con Claude (catálogo, pedido, consulta)
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
    } catch (claudeError) {
      console.error('[webhook] Error en Claude, usando Groq fallback:', claudeError);

      // Fallback a Groq
      const { fallbackGroq } = await import('@/lib/groq');
      const respuesta = await fallbackGroq(historial, textoUsuario);
      await enviarTexto(whatsapp, respuesta);
      await guardarMensaje({
        conversacion_id,
        rol: 'agente',
        contenido: respuesta,
      });

      // Notificar al asesor si hay cliente registrado
      if (cliente && process.env.ASESOR_EMAIL) {
        await notificarEscalado({
          asesor_email: process.env.ASESOR_EMAIL,
          cliente_nombre: cliente.nombre_negocio ?? cliente.nombre_contacto ?? whatsapp,
          whatsapp,
          motivo: 'Error en el agente IA — requiere atención manual',
          conversacion_id,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[webhook] Error crítico:', error);
    // No retornar 500 a Kapso para evitar reintentos infinitos
    return NextResponse.json({ ok: true });
  }
}

// Verificación de webhook (GET para validación inicial de Kapso)
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('hub.challenge');
  const verify_token = searchParams.get('hub.verify_token');

  if (verify_token === process.env.KAPSO_WEBHOOK_SECRET) {
    return new NextResponse(challenge ?? 'ok');
  }

  return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
}
