import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// Vercel Cron Jobs dispara peticiones GET — por eso el cálculo vive aquí
// (no en POST, que un cron nunca podría llamar).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    const [topProductos, clientesInactivos] = await Promise.all([
      sql`
        SELECT p.nombre, SUM(pi.cantidad) AS unidades_vendidas
        FROM pedido_items pi
        JOIN productos p ON p.id = pi.producto_id
        JOIN pedidos pe ON pe.id = pi.pedido_id
        WHERE pe.empresa_id = ${empresa_id}
          AND pe.creado_at >= NOW() - INTERVAL '7 days'
          AND pe.estado != 'cancelado'
        GROUP BY p.nombre
        ORDER BY unidades_vendidas DESC
        LIMIT 5
      `,
      sql`
        SELECT cliente_id, nombre, whatsapp, ultimo_pedido, dias_sin_comprar
        FROM v_clientes_inactivos
        WHERE empresa_id = ${empresa_id}
          AND dias_sin_comprar > 15
        ORDER BY dias_sin_comprar DESC
      `,
    ]);

    const reporte = {
      generado_at: new Date().toISOString(),
      periodo_dias: 7,
      top_5_productos: topProductos,
      clientes_inactivos_15_dias: clientesInactivos,
    };

    await sql`
      INSERT INTO cache_respuestas (empresa_id, clave, respuesta, expira_at)
      VALUES (
        ${empresa_id},
        'escalability_report',
        ${JSON.stringify(reporte)},
        NOW() + INTERVAL '2 days'
      )
      ON CONFLICT (empresa_id, clave) DO UPDATE
      SET respuesta = EXCLUDED.respuesta, expira_at = EXCLUDED.expira_at
    `;

    return NextResponse.json({ data: reporte });
  } catch (error) {
    console.error('[cron/escalability GET]', error);
    return NextResponse.json({ error: 'Error generando reporte de escalabilidad' }, { status: 500 });
  }
}
