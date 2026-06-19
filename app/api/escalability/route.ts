import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { anthropic, CLAUDE_MODEL } from '@/lib/claude';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// Cron semanal: analiza patrones de conversación y genera insights
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verificar cron secret para llamadas automáticas de Vercel
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    // Métricas de la última semana
    const [conversaciones, pedidos, clientesInactivos, topProductos] = await Promise.all([
      sql`
        SELECT
          COUNT(*) AS total,
          AVG(isa_score) AS score_promedio,
          SUM(CASE WHEN estado = 'escalada' THEN 1 ELSE 0 END) AS escaladas
        FROM conversaciones
        WHERE empresa_id = ${empresa_id}
          AND iniciada_at >= NOW() - INTERVAL '7 days'
      `,
      sql`
        SELECT
          COUNT(*) AS total,
          SUM(total) AS revenue,
          AVG(total) AS ticket_promedio
        FROM pedidos
        WHERE empresa_id = ${empresa_id}
          AND created_at >= NOW() - INTERVAL '7 days'
          AND estado != 'cancelado'
      `,
      sql`SELECT COUNT(*) AS total FROM v_clientes_inactivos WHERE empresa_id = ${empresa_id}`,
      sql`
        SELECT p.nombre, SUM(pi.cantidad) AS unidades_vendidas
        FROM pedido_items pi
        JOIN productos p ON p.id = pi.producto_id
        JOIN pedidos pe ON pe.id = pi.pedido_id
        WHERE pe.empresa_id = ${empresa_id}
          AND pe.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY p.nombre
        ORDER BY unidades_vendidas DESC
        LIMIT 10
      `,
    ]);

    const metricas = {
      semana: {
        conversaciones: conversaciones[0],
        pedidos: pedidos[0],
        clientes_inactivos: clientesInactivos[0]?.total,
        top_productos: topProductos,
      },
    };

    // Análisis con Claude
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: `Eres un analista de ventas para una distribuidora de consumo masivo en Colombia.
Analiza las métricas semanales y genera recomendaciones concretas y accionables.
Responde en JSON con este formato:
{
  "resumen": "2-3 oraciones del estado general",
  "alertas": ["alerta1", "alerta2"],
  "oportunidades": ["oportunidad1", "oportunidad2"],
  "acciones_recomendadas": [
    {"accion": "...", "impacto": "alto|medio|bajo", "plazo": "inmediato|semana|mes"}
  ]
}`,
      messages: [
        {
          role: 'user',
          content: `Analiza estas métricas de la última semana:\n${JSON.stringify(metricas, null, 2)}`,
        },
      ],
    });

    const bloque = response.content[0];
    if (bloque.type !== 'text') throw new Error('Respuesta inesperada');

    const analisis = JSON.parse(bloque.text);

    // Guardar análisis en DB para historial
    await sql`
      INSERT INTO cache_respuestas (empresa_id, cache_key, respuesta, ttl_seconds, expires_at)
      VALUES (
        ${empresa_id},
        ${'escalability_weekly_' + new Date().toISOString().split('T')[0]},
        ${JSON.stringify({ metricas, analisis })},
        604800,
        NOW() + INTERVAL '7 days'
      )
      ON CONFLICT (empresa_id, cache_key) DO UPDATE
      SET respuesta = EXCLUDED.respuesta, expires_at = EXCLUDED.expires_at
    `;

    return NextResponse.json({ data: { metricas, analisis } });
  } catch (error) {
    console.error('[escalability POST]', error);
    return NextResponse.json({ error: 'Error en análisis de escalabilidad' }, { status: 500 });
  }
}

// GET: obtener último análisis
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    const rows = await sql`
      SELECT respuesta, created_at FROM cache_respuestas
      WHERE empresa_id = ${empresa_id}
        AND cache_key LIKE 'escalability_weekly_%'
      ORDER BY created_at DESC
      LIMIT 4
    `;

    return NextResponse.json({
      data: rows.map((r) => ({
        ...JSON.parse(r.respuesta as string),
        fecha: r.created_at,
      })),
    });
  } catch (error) {
    console.error('[escalability GET]', error);
    return NextResponse.json({ error: 'Error obteniendo análisis' }, { status: 500 });
  }
}
