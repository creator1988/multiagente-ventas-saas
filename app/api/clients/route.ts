import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const whatsapp = searchParams.get('whatsapp');
  const inactivos = searchParams.get('inactivos') === 'true';

  try {
    let rows;

    if (whatsapp) {
      rows = await sql`
        SELECT c.*,
               COUNT(p.id) AS total_pedidos,
               MAX(p.created_at) AS ultimo_pedido
        FROM clientes c
        LEFT JOIN pedidos p ON p.cliente_id = c.id
        WHERE c.empresa_id = ${empresa_id}
          AND c.whatsapp = ${whatsapp}
        GROUP BY c.id
        LIMIT 1
      `;
    } else if (inactivos) {
      rows = await sql`
        SELECT * FROM v_clientes_inactivos WHERE empresa_id = ${empresa_id}
      `;
    } else {
      rows = await sql`
        SELECT c.*,
               COUNT(p.id) AS total_pedidos,
               MAX(p.created_at) AS ultimo_pedido
        FROM clientes c
        LEFT JOIN pedidos p ON p.cliente_id = c.id
        WHERE c.empresa_id = ${empresa_id}
          AND c.activo = true
        GROUP BY c.id
        ORDER BY c.nombre
      `;
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[clients GET]', error);
    return NextResponse.json({ error: 'Error consultando clientes' }, { status: 500 });
  }
}
