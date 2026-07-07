import { sql } from './db';
import { getClient, CLAUDE_MODEL } from './claude';
import { ISA_SCORE_PROMPT } from './agent-prompt';
import type { ISAScoreResult } from '@/types';

// ============================================================
// calcularIsaScore — evalúa una conversación con Claude, guarda el score
// en conversaciones.isa_score y marca estado='completada'.
// Reutilizado por POST /api/monitor (manual, desde el dashboard) y por
// el disparo automático al confirmar un pedido (agent-core.ts).
// ============================================================
export async function calcularIsaScore(conversacion_id: string): Promise<ISAScoreResult | null> {
  const mensajes = await sql`
    SELECT rol, contenido, timestamp
    FROM mensajes
    WHERE conversacion_id = ${conversacion_id}
    ORDER BY timestamp ASC
  `;

  if (!mensajes.length) return null;

  const transcripcion = mensajes
    .map((m) => `[${m.rol}]: ${m.contenido}`)
    .join('\n');

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    system: ISA_SCORE_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Evalúa esta conversación de ventas:\n\n${transcripcion}`,
      },
    ],
  });

  const bloque = response.content[0];
  if (bloque.type !== 'text') {
    throw new Error('Respuesta inesperada del modelo');
  }

  const resultado = JSON.parse(bloque.text) as ISAScoreResult;
  resultado.conversacion_id = conversacion_id;

  await sql`
    UPDATE conversaciones
    SET isa_score = ${resultado.score},
        estado = 'completada'
    WHERE id = ${conversacion_id}
  `;

  return resultado;
}
