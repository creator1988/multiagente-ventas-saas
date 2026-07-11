import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// ---------------------------------------------------------------------------
// GET /api/routes — lista de rutas con conteo de clientes asignados
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    const rows = await sql`
      SELECT r.*, COUNT(c.id) AS total_clientes
      FROM rutas r
      LEFT JOIN clientes c ON c.ruta_id = r.id
      WHERE r.empresa_id = ${empresa_id}
      GROUP BY r.id
      ORDER BY r.nombre ASC
    `;
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[routes GET]', error);
    return NextResponse.json({ error: 'Error consultando rutas', detalle: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/routes — crear una nueva ruta
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as {
    empresa_id?: string;
    nombre: string;
    asesor_nombre?: string;
    asesor_telefono?: string;
    asesor_whatsapp?: string;
    dias_visita?: string;
    zona_cobertura?: string;
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  if (!body.nombre?.trim()) {
    return NextResponse.json({ error: 'nombre requerido' }, { status: 400 });
  }

  try {
    const rows = await sql`
      INSERT INTO rutas (empresa_id, nombre, asesor_nombre, asesor_telefono, asesor_whatsapp, dias_visita, zona_cobertura, activo)
      VALUES (
        ${empresa_id},
        ${body.nombre.trim()},
        ${body.asesor_nombre ?? null},
        ${body.asesor_telefono ?? null},
        ${body.asesor_whatsapp ?? null},
        ${body.dias_visita ?? null},
        ${body.zona_cobertura ?? null},
        true
      )
      RETURNING *
    `;
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (error) {
    console.error('[routes POST]', error);
    return NextResponse.json({ error: 'Error creando ruta', detalle: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/routes?id=xxx — editar una ruta (solo actualiza campos enviados)
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const ruta_id = searchParams.get('id');

  if (!ruta_id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const body = (await request.json()) as {
    empresa_id?: string;
    nombre?: string;
    asesor_nombre?: string;
    asesor_telefono?: string;
    asesor_whatsapp?: string;
    dias_visita?: string;
    zona_cobertura?: string;
    activo?: boolean;
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  try {
    if (body.nombre !== undefined) {
      await sql`UPDATE rutas SET nombre = ${body.nombre} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.asesor_nombre !== undefined) {
      await sql`UPDATE rutas SET asesor_nombre = ${body.asesor_nombre} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.asesor_telefono !== undefined) {
      await sql`UPDATE rutas SET asesor_telefono = ${body.asesor_telefono} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.asesor_whatsapp !== undefined) {
      await sql`UPDATE rutas SET asesor_whatsapp = ${body.asesor_whatsapp} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.dias_visita !== undefined) {
      await sql`UPDATE rutas SET dias_visita = ${body.dias_visita} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.zona_cobertura !== undefined) {
      await sql`UPDATE rutas SET zona_cobertura = ${body.zona_cobertura} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }
    if (body.activo !== undefined) {
      await sql`UPDATE rutas SET activo = ${body.activo} WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[routes PATCH]', error);
    return NextResponse.json({ error: 'Error actualizando ruta', detalle: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/routes?id=xxx — eliminar una ruta
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const ruta_id = searchParams.get('id');
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  if (!ruta_id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    await sql`DELETE FROM rutas WHERE id = ${ruta_id} AND empresa_id = ${empresa_id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[routes DELETE]', error);
    return NextResponse.json({ error: 'Error eliminando ruta (puede tener clientes asignados)', detalle: String(error) }, { status: 500 });
  }
}
