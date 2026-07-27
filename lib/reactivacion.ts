import { getClient, CLAUDE_MODEL } from './claude';
import { obtenerHistorialMensajes, guardarMensaje, marcarReactivacionEnviada, type ConversacionParaReactivar } from './query-cards';
import { enviarTexto } from './kapso';

const REACTIVACION_SYSTEM_PROMPT = `Eres un asesor comercial colombiano que retoma una conversación de WhatsApp que el cliente dejó sin terminar hace un rato (30-45 minutos).

Con el historial que se te da, escribe UN solo mensaje corto (máximo 2 líneas) para reabrir la conversación:
- Cálido y natural, nunca insistente ni con tono de venta forzada.
- Si el historial deja claro qué producto, categoría u oferta le interesó al cliente, menciónalo específicamente.
- Si no es claro, usa un gancho genérico ("¿seguimos con tu pedido?").
- Cierra con una pregunta abierta que invite a responder.
- No uses signos de "oferta por tiempo limitado" ni presión artificial.
- Responde solo con el texto del mensaje, sin comillas ni explicaciones.`;

export async function generarMensajeReactivacion(
  historial: Array<{ rol: 'user' | 'assistant'; contenido: string }>
): Promise<string> {
  const transcripcion = historial
    .map(m => `${m.rol === 'user' ? 'Cliente' : 'Agente'}: ${m.contenido}`)
    .join('\n');

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    system: REACTIVACION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcripcion }],
  });

  const bloque = response.content[0];
  if (bloque.type !== 'text') throw new Error('Respuesta inesperada de Claude');
  return bloque.text.trim();
}

export interface ResultadoReactivacion {
  conversacion_id: string;
  enviado: boolean;
  error?: string;
}

export async function reactivarConversacion(
  conversacion: ConversacionParaReactivar
): Promise<ResultadoReactivacion> {
  try {
    const historial = await obtenerHistorialMensajes(conversacion.conversacion_id, 10);
    const mensaje = await generarMensajeReactivacion(historial);

    await enviarTexto(conversacion.whatsapp, mensaje);
    await guardarMensaje({
      conversacion_id: conversacion.conversacion_id,
      rol: 'agente',
      contenido: mensaje,
    });
    await marcarReactivacionEnviada(conversacion.conversacion_id);

    return { conversacion_id: conversacion.conversacion_id, enviado: true };
  } catch (e) {
    return { conversacion_id: conversacion.conversacion_id, enviado: false, error: String(e) };
  }
}
