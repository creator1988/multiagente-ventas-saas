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
               COALESCE(c.nombre_negocio, c.nombre_contacto) AS nombre,
               r.nombre AS ruta_nombre,
               COUNT(p.id) AS total_pedidos,
               MAX(p.creado_at) AS ultimo_pedido
        FROM clientes c
        LEFT JOIN pedidos p ON p.cliente_id = c.id
        LEFT JOIN rutas r ON r.id = c.ruta_id
        WHERE c.empresa_id = ${empresa_id}
          AND c.whatsapp = ${whatsapp}
        GROUP BY c.id, r.nombre
        LIMIT 1
      `;
    } else if (inactivos) {
      rows = await sql`
        SELECT * FROM v_clientes_inactivos WHERE empresa_id = ${empresa_id}
      `;
    } else {
      // Sin filtro de activo a propósito: la gestión de clientes del dashboard
      // necesita ver también los inactivos (opt-out de no-contacto) para
      // poder reactivarlos o editarlos, distinguidos visualmente en la UI.
      rows = await sql`
        SELECT c.*,
               COALESCE(c.nombre_negocio, c.nombre_contacto) AS nombre,
               r.nombre AS ruta_nombre,
               COUNT(p.id) AS total_pedidos,
               MAX(p.creado_at) AS ultimo_pedido
        FROM clientes c
        LEFT JOIN pedidos p ON p.cliente_id = c.id
        LEFT JOIN rutas r ON r.id = c.ruta_id
        WHERE c.empresa_id = ${empresa_id}
        GROUP BY c.id, r.nombre
        ORDER BY COALESCE(c.nombre_negocio, c.nombre_contacto)
      `;
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[clients GET]', error);
    return NextResponse.json({ error: 'Error consultando clientes' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/clients?id=xxx — editar un cliente (solo actualiza campos enviados)
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const cliente_id = searchParams.get('id');

  if (!cliente_id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const body = (await request.json()) as {
    empresa_id?: string;
    nombre_negocio?: string;
    telefono?: string;
    whatsapp?: string;
    direccion?: string;
    barrio?: string;
    tipo_negocio?: string;
    activo?: boolean;
    ruta_id?: string | null;
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  try {
    if (body.nombre_negocio !== undefined) {
      await sql`UPDATE clientes SET nombre_negocio = ${body.nombre_negocio} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.telefono !== undefined) {
      await sql`UPDATE clientes SET telefono = ${body.telefono} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.whatsapp !== undefined) {
      await sql`UPDATE clientes SET whatsapp = ${body.whatsapp} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.direccion !== undefined) {
      await sql`UPDATE clientes SET direccion = ${body.direccion} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.barrio !== undefined) {
      await sql`UPDATE clientes SET barrio = ${body.barrio} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.tipo_negocio !== undefined) {
      await sql`UPDATE clientes SET tipo_negocio = ${body.tipo_negocio} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.activo !== undefined) {
      await sql`UPDATE clientes SET activo = ${body.activo} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.ruta_id !== undefined) {
      await sql`UPDATE clientes SET ruta_id = ${body.ruta_id} WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[clients PATCH]', error);
    return NextResponse.json({ error: 'Error actualizando cliente', detalle: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/clients?id=xxx — eliminar un cliente permanentemente
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const cliente_id = searchParams.get('id');
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  if (!cliente_id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    await sql`DELETE FROM clientes WHERE id = ${cliente_id} AND empresa_id = ${empresa_id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[clients DELETE]', error);
    return NextResponse.json({ error: 'Error eliminando cliente (puede tener pedidos asociados)', detalle: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clients — acciones masivas sobre clientes seleccionados:
// desactivar, activar, eliminar o asignar ruta. Desactivar/activar nunca
// borran nada (el historial queda intacto); eliminar sí es permanente.
// ---------------------------------------------------------------------------
type AccionMasiva = 'desactivar' | 'activar' | 'eliminar' | 'asignar_ruta';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as {
    empresa_id?: string;
    ids: string[];
    accion: AccionMasiva;
    ruta_id?: string | null;
  };
  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids requerido' }, { status: 400 });
  }

  try {
    switch (body.accion) {
      case 'desactivar':
        await sql`UPDATE clientes SET activo = false WHERE empresa_id = ${empresa_id} AND id = ANY(${body.ids}::uuid[])`;
        break;
      case 'activar':
        await sql`UPDATE clientes SET activo = true WHERE empresa_id = ${empresa_id} AND id = ANY(${body.ids}::uuid[])`;
        break;
      case 'eliminar':
        await sql`DELETE FROM clientes WHERE empresa_id = ${empresa_id} AND id = ANY(${body.ids}::uuid[])`;
        break;
      case 'asignar_ruta':
        await sql`UPDATE clientes SET ruta_id = ${body.ruta_id ?? null} WHERE empresa_id = ${empresa_id} AND id = ANY(${body.ids}::uuid[])`;
        break;
      default:
        return NextResponse.json({ error: 'accion inválida' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, afectados: body.ids.length });
  } catch (error) {
    console.error('[clients POST bulk]', error);
    return NextResponse.json({ error: 'Error en la acción masiva', detalle: String(error) }, { status: 500 });
  }
}
