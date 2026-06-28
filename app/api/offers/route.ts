import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

export async function GET(): Promise<NextResponse> {
  const empresa_id = EMPRESA_ID;
  if (!empresa_id) {
    return NextResponse.json({ error: 'EMPRESA_ID_DEFAULT no configurado' }, { status: 500 });
  }

  try {
    const ofertas = await sql`
      SELECT id, nombre, precio_combo, url_imagen, activo
      FROM ofertas
      WHERE empresa_id = ${empresa_id}
      ORDER BY creado_at
    `;

    const ids = ofertas.map((o) => o.id as string);
    const componentes = ids.length > 0
      ? await sql`
          SELECT op.oferta_id, op.cantidad, p.nombre AS producto_nombre, p.sku
          FROM oferta_productos op
          JOIN productos p ON p.id = op.producto_id
          WHERE op.oferta_id = ANY(${ids}::uuid[])
          ORDER BY p.nombre
        `
      : [];

    const compPorOferta: Record<string, Array<{ cantidad: number; producto_nombre: string; sku: string | null }>> = {};
    for (const c of componentes) {
      const oid = c.oferta_id as string;
      if (!compPorOferta[oid]) compPorOferta[oid] = [];
      compPorOferta[oid].push({
        cantidad: c.cantidad as number,
        producto_nombre: c.producto_nombre as string,
        sku: c.sku as string | null,
      });
    }

    const data = ofertas.map((o) => ({
      ...o,
      componentes: compPorOferta[o.id as string] ?? [],
    }));

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: 'Error consultando ofertas', detalle: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const oferta_id = searchParams.get('id');
  if (!oferta_id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const empresa_id = EMPRESA_ID;
  const body = (await request.json()) as { precio_combo?: number; activo?: boolean };

  try {
    if (body.precio_combo !== undefined) {
      await sql`
        UPDATE ofertas SET precio_combo = ${body.precio_combo}
        WHERE id = ${oferta_id} AND empresa_id = ${empresa_id}
      `;
    }
    if (body.activo !== undefined) {
      await sql`
        UPDATE ofertas SET activo = ${body.activo}
        WHERE id = ${oferta_id} AND empresa_id = ${empresa_id}
      `;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Error actualizando oferta', detalle: String(err) }, { status: 500 });
  }
}
