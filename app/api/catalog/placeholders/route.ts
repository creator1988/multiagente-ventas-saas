import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — cuántos placeholders hay (para mostrar antes de confirmar)
export async function GET(): Promise<NextResponse> {
  const empresa_id = process.env.EMPRESA_ID_DEFAULT ?? '';
  if (!empresa_id) return NextResponse.json({ error: 'EMPRESA_ID_DEFAULT no configurado' }, { status: 500 });

  const rows = await sql`
    SELECT id, nombre, creado_at
    FROM productos
    WHERE empresa_id = ${empresa_id}
      AND sku IS NULL
      AND precio_lista = 0
      AND stock_disponible = 0
      AND importacion_id IS NOT NULL
    ORDER BY creado_at DESC
  `;

  return NextResponse.json({ data: { count: rows.length, productos: rows } });
}

// DELETE — elimina placeholders y sus entradas en oferta_productos
export async function DELETE(): Promise<NextResponse> {
  const empresa_id = process.env.EMPRESA_ID_DEFAULT ?? '';
  if (!empresa_id) return NextResponse.json({ error: 'EMPRESA_ID_DEFAULT no configurado' }, { status: 500 });

  // 1. Identificar placeholders
  const placeholders = await sql`
    SELECT id FROM productos
    WHERE empresa_id = ${empresa_id}
      AND sku IS NULL
      AND precio_lista = 0
      AND stock_disponible = 0
      AND importacion_id IS NOT NULL
  `;

  if (placeholders.length === 0) {
    return NextResponse.json({ data: { eliminados: 0, enlaces_eliminados: 0 } });
  }

  const ids = placeholders.map((p) => p.id as string);

  // 2. Eliminar enlaces en oferta_productos que apuntan a estos placeholders
  const enlaces = await sql`
    DELETE FROM oferta_productos
    WHERE producto_id = ANY(${ids}::uuid[])
    RETURNING id
  `;

  // 3. Eliminar los placeholders
  const eliminados = await sql`
    DELETE FROM productos
    WHERE id = ANY(${ids}::uuid[])
      AND empresa_id = ${empresa_id}
    RETURNING id
  `;

  return NextResponse.json({
    data: {
      eliminados: eliminados.length,
      enlaces_eliminados: enlaces.length,
    },
  });
}
