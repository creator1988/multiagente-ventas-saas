import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { calcularIsaScore } from '@/lib/monitor';

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
    const resultado = await calcularIsaScore(conversacion_id);

    if (!resultado) {
      return NextResponse.json({ error: 'Conversación sin mensajes' }, { status: 404 });
    }

    return NextResponse.json({ data: resultado });
  } catch (error) {
    console.error('[monitor POST]', error);
    return NextResponse.json({ error: 'Error calculando ISA Score' }, { status: 500 });
  }
}
