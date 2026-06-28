import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { invalidarCache } from '@/lib/cache';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const categoria_id = searchParams.get('categoria_id');
  const activos = searchParams.get('activos') !== 'false';
  const ofertas = searchParams.get('ofertas') === 'true';

  if (!empresa_id) {
    return NextResponse.json({ error: 'EMPRESA_ID_DEFAULT no está configurada' }, { status: 500 });
  }

  try {
    if (ofertas) {
      const rows = await sql`
        SELECT * FROM v_ofertas_activas WHERE empresa_id = ${empresa_id}
      `;
      return NextResponse.json({ data: rows });
    }

    // LEFT JOIN para incluir productos con categoria_id NULL (placeholders de combos)
    const rows = categoria_id
      ? await sql`
          SELECT p.*,
                 COALESCE(c.nombre, 'Sin categoría') AS categoria_nombre
          FROM productos p
          LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE p.empresa_id = ${empresa_id}
            AND p.categoria_id = ${categoria_id}
            AND p.activo = ${activos}
          ORDER BY p.nombre
        `
      : await sql`
          SELECT p.*,
                 COALESCE(c.nombre, 'Sin categoría') AS categoria_nombre
          FROM productos p
          LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE p.empresa_id = ${empresa_id}
            AND p.activo = ${activos}
          ORDER BY COALESCE(c.nombre, 'Sin categoría'), p.nombre
        `;

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[products GET]', error);
    return NextResponse.json(
      { error: 'Error consultando productos', detalle: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const producto_id = searchParams.get('id');

  if (!producto_id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const body = (await request.json()) as {
    empresa_id?: string;
    nombre?: string;
    precio_lista?: number;
    stock_disponible?: number;
    activo?: boolean;
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  try {
    // Solo actualizar campos enviados
    if (body.precio_lista !== undefined) {
      await sql`
        UPDATE productos SET precio_lista = ${body.precio_lista}
        WHERE id = ${producto_id} AND empresa_id = ${empresa_id}
      `;
    }
    if (body.stock_disponible !== undefined) {
      await sql`
        UPDATE productos SET stock_disponible = ${body.stock_disponible}
        WHERE id = ${producto_id} AND empresa_id = ${empresa_id}
      `;
    }
    if (body.activo !== undefined) {
      await sql`
        UPDATE productos SET activo = ${body.activo}
        WHERE id = ${producto_id} AND empresa_id = ${empresa_id}
      `;
    }
    if (body.nombre) {
      await sql`
        UPDATE productos SET nombre = ${body.nombre}
        WHERE id = ${producto_id} AND empresa_id = ${empresa_id}
      `;
    }

    // Invalidar cache de catálogo al cambiar producto
    await invalidarCache(empresa_id, 'catalogo');
    await invalidarCache(empresa_id, 'consulta_stock');

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[products PATCH]', error);
    return NextResponse.json({ error: 'Error actualizando producto' }, { status: 500 });
  }
}
