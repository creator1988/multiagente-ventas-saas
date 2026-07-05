import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getClient, CLAUDE_MODEL } from '@/lib/claude';
import { ISA_SCORE_PROMPT } from '@/lib/agent-prompt';
import type { ISAScoreResult } from '@/types';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// GET: listar conversaciones con sus ISA Scores
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const estado = searchParams.get('estado');

  try {
    const rows = estado
      ? await sql`
          SELECT c.*, COALESCE(cl.nombre_negocio, cl.nombre_contacto) AS cliente_nombre,
                 cl.whatsapp AS whatsapp_numero,
                 COUNT(m.id) AS total_mensajes
          FROM conversaciones c
          LEFT JOIN clientes cl ON cl.id = c.cliente_id
          LEFT JOIN mensajes m ON m.conversacion_id = c.id
          WHERE c.empresa_id = ${empresa_id}
            AND c.estado = ${estado}
          GROUP BY c.id, cl.nombre_negocio, cl.nombre_contacto, cl.whatsapp
          ORDER BY c.inicio DESC
          LIMIT 50
        `
      : await sql`
          SELECT c.*, COALESCE(cl.nombre_negocio, cl.nombre_contacto) AS cliente_nombre,
                 cl.whatsapp AS whatsapp_numero,
                 COUNT(m.id) AS total_mensajes
          FROM conversaciones c
          LEFT JOIN clientes cl ON cl.id = c.cliente_id
          LEFT JOIN mensajes m ON m.conversacion_id = c.id
          WHERE c.empresa_id = ${empresa_id}
          GROUP BY c.id, cl.nombre_negocio, cl.nombre_contacto, cl.whatsapp
          ORDER BY c.inicio DESC
          LIMIT 50
        `;

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[monitor GET]', error);
    return NextResponse.json({ error: 'Error consultando conversaciones' }, { status: 500 });
  }
}

// POST: calcular ISA Score de una conversación
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { conversacion_id } = (await request.json()) as { conversacion_id: string };

  if (!conversacion_id) {
    return NextResponse.json({ error: 'conversacion_id requerido' }, { status: 400 });
  }

  try {
    // Obtener todos los mensajes de la conversación
    const mensajes = await sql`
      SELECT rol, contenido, timestamp
      FROM mensajes
      WHERE conversacion_id = ${conversacion_id}
      ORDER BY timestamp ASC
    `;

    if (!mensajes.length) {
      return NextResponse.json({ error: 'Conversación sin mensajes' }, { status: 404 });
    }

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

    // Guardar score en la conversación
    await sql`
      UPDATE conversaciones
      SET isa_score = ${resultado.score},
          estado = 'completada'
      WHERE id = ${conversacion_id}
    `;

    return NextResponse.json({ data: resultado });
  } catch (error) {
    console.error('[monitor POST]', error);
    return NextResponse.json({ error: 'Error calculando ISA Score' }, { status: 500 });
  }
}
