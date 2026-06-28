import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { limpiarNombreProducto } from '@/lib/nombre-limpio';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const empresa_id = process.env.EMPRESA_ID_DEFAULT ?? '';
  if (!empresa_id) {
    return NextResponse.json({ error: 'EMPRESA_ID_DEFAULT no configurado' }, { status: 500 });
  }

  const productos = await sql`
    SELECT id, nombre, descripcion
    FROM productos
    WHERE empresa_id = ${empresa_id}
      AND descripcion IS NOT NULL
      AND descripcion != ''
  `;

  let actualizados = 0;
  for (const p of productos) {
    const textoBase = (p.descripcion as string).trim();
    const nombreNuevo = limpiarNombreProducto(textoBase);
    if (nombreNuevo && nombreNuevo !== (p.nombre as string)) {
      await sql`UPDATE productos SET nombre = ${nombreNuevo} WHERE id = ${p.id}`;
      actualizados++;
    }
  }

  return NextResponse.json({ data: { actualizados, total: productos.length } });
}
