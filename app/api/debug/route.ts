import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sql = getSql();
  const { ids } = (await request.json()) as { ids: string[] };
  await sql`DELETE FROM oferta_productos WHERE oferta_id = ANY(${ids}::uuid[])`;
  const eliminadas = await sql`DELETE FROM ofertas WHERE id = ANY(${ids}::uuid[]) RETURNING id`;
  return NextResponse.json({ eliminadas: eliminadas.length });
}

export async function GET(): Promise<NextResponse> {
  const sql = getSql();

  const [ofertas, conSku, sinSku] = await Promise.all([
    sql`SELECT id, nombre, precio_combo, url_imagen, activo FROM ofertas ORDER BY creado_at`,
    sql`SELECT count(*)::int AS total FROM productos WHERE sku IS NOT NULL`,
    sql`SELECT count(*)::int AS total FROM productos WHERE sku IS NULL`,
  ]);

  return NextResponse.json({
    ofertas,
    productos_con_sku: conSku[0].total,
    productos_sin_sku: sinSku[0].total,
  });
}
