import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
