import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sql = getSql();

  const [resumen, muestraProductos, ofertas] = await Promise.all([
    sql`
      SELECT count(*)::int AS total, min(creado_at) AS mas_antiguo, max(creado_at) AS mas_reciente
      FROM productos
      WHERE precio_lista = 0
    `,
    sql`
      SELECT id, nombre, descripcion, sku, precio_lista, url_imagen, importacion_id, creado_at
      FROM productos
      WHERE precio_lista = 0
      ORDER BY creado_at DESC
      LIMIT 20
    `,
    sql`
      SELECT id, nombre, precio_combo, url_imagen, activo, importacion_id, creado_at
      FROM ofertas
      ORDER BY creado_at
      LIMIT 12
    `,
  ]);

  return NextResponse.json({ resumen: resumen[0], productos_precio_0: muestraProductos, ofertas });
}
