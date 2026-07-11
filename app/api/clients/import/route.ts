import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { ClienteImportRow, ResultadoImportClientes, AsignacionRutaImport } from '@/types';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// neon sql returns a union type; cast rows to work with TypeScript
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (r: any): Row[] => r as Row[];

// Intenta garantizar los índices únicos que hacen seguro el UPSERT vía
// ON CONFLICT. Si ya existen filas duplicadas en producción para
// (empresa_id, whatsapp) en clientes o (empresa_id, nombre) en rutas, la
// creación del índice falla — en ese caso se usa el UPSERT manual
// (SELECT + INSERT/UPDATE) como red de seguridad en vez de tumbar toda
// la importación con un error de Postgres.
async function asegurarIndicesUnicos(): Promise<boolean> {
  try {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_empresa_whatsapp ON clientes(empresa_id, whatsapp)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_rutas_empresa_nombre ON rutas(empresa_id, nombre)`;
    return true;
  } catch (e) {
    console.error('[clients/import] No se pudieron crear los índices únicos (probablemente hay duplicados existentes). Se usará UPSERT manual:', e);
    return false;
  }
}

// Crea (o encuentra) la ruta con el nombre exacto que el usuario confirmó
// en la previsualización — nunca se deriva ni se asume un nombre aquí.
async function getOrCreateRutaPorNombre(empresa_id: string, nombreCrudo: string, usarOnConflict: boolean): Promise<string | null> {
  const nombre = nombreCrudo.trim();
  if (!nombre) return null;

  if (usarOnConflict) {
    const inserted = rows(await sql`
      INSERT INTO rutas (empresa_id, nombre, asesor_nombre, activo)
      VALUES (${empresa_id}, ${nombre}, 'Por asignar', true)
      ON CONFLICT (empresa_id, nombre) DO NOTHING
      RETURNING id
    `);
    if (inserted.length > 0) return inserted[0].id as string;

    const existente = rows(await sql`
      SELECT id FROM rutas WHERE empresa_id = ${empresa_id} AND nombre = ${nombre} LIMIT 1
    `);
    return existente.length > 0 ? (existente[0].id as string) : null;
  }

  const existente = rows(await sql`
    SELECT id FROM rutas WHERE empresa_id = ${empresa_id} AND nombre = ${nombre} LIMIT 1
  `);
  if (existente.length > 0) return existente[0].id as string;

  const creado = rows(await sql`
    INSERT INTO rutas (empresa_id, nombre, asesor_nombre, activo)
    VALUES (${empresa_id}, ${nombre}, 'Por asignar', true)
    RETURNING id
  `);
  return creado[0].id as string;
}

// ---------------------------------------------------------------------------
// GET /api/clients/import — whatsapps ya existentes, para clasificar la
// previsualización (nuevo/existente) antes de importar
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    const existentes = rows(await sql`
      SELECT whatsapp FROM clientes WHERE empresa_id = ${empresa_id}
    `);
    return NextResponse.json({ data: existentes.map((r) => r.whatsapp as string) });
  } catch (err) {
    console.error('[clients/import GET]', err);
    return NextResponse.json({ error: 'Error consultando clientes existentes', detalle: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clients/import — UPSERT de clientes por whatsapp. La ruta de
// cada cliente se resuelve por la decisión explícita del usuario en
// `asignaciones` (una por cada código de ruta detectado en el Excel) — nunca
// se crea o asume una ruta automáticamente a partir del código.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as {
    empresa_id?: string;
    clientes: ClienteImportRow[];
    asignaciones: AsignacionRutaImport[];
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;
  const usarOnConflict = await asegurarIndicesUnicos();

  const resultado: ResultadoImportClientes = {
    nuevos: 0,
    actualizados: 0,
    invalidos: 0,
    rutas_creadas: 0,
    errores: [],
  };

  // Resolver, por cada código de ruta detectado, el ruta_id final según lo
  // que el usuario eligió en la previsualización (existente o crear nueva).
  const mapaRutas = new Map<string, string | null>();
  for (const a of body.asignaciones ?? []) {
    try {
      if (a.crear_nueva) {
        const ruta_id = await getOrCreateRutaPorNombre(empresa_id, a.nombre_sugerido, usarOnConflict);
        mapaRutas.set(a.ruta_codigo, ruta_id);
        if (ruta_id) resultado.rutas_creadas++;
      } else {
        mapaRutas.set(a.ruta_codigo, a.ruta_id ?? null);
      }
    } catch (err) {
      resultado.errores.push(`Ruta "${a.ruta_codigo}": ${String(err)}`);
    }
  }

  try {
    for (const c of body.clientes) {
      if (!c.valido || !c.whatsapp) {
        resultado.invalidos++;
        continue;
      }

      try {
        const ruta_id = c.ruta_codigo ? mapaRutas.get(c.ruta_codigo) ?? null : null;

        if (usarOnConflict) {
          // UPSERT real: el nombre_negocio siempre se actualiza desde el Excel;
          // nombre_contacto solo se pisa si seguía en el placeholder de
          // onboarding (no se sobreescribe un nombre real ya capturado por WhatsApp).
          const upsertRows = rows(await sql`
            INSERT INTO clientes (empresa_id, ruta_id, nombre_negocio, nombre_contacto, whatsapp, activo)
            VALUES (${empresa_id}, ${ruta_id}, ${c.nombre_limpio}, ${c.nombre_limpio}, ${c.whatsapp}, true)
            ON CONFLICT (empresa_id, whatsapp) DO UPDATE SET
              nombre_negocio = EXCLUDED.nombre_negocio,
              nombre_contacto = CASE
                WHEN clientes.nombre_contacto IS NULL OR clientes.nombre_contacto = 'Cliente nuevo'
                THEN EXCLUDED.nombre_contacto
                ELSE clientes.nombre_contacto
              END,
              ruta_id = COALESCE(EXCLUDED.ruta_id, clientes.ruta_id),
              activo = true
            RETURNING (xmax = 0) AS es_nuevo
          `);
          if (upsertRows[0]?.es_nuevo) {
            resultado.nuevos++;
          } else {
            resultado.actualizados++;
          }
        } else {
          const existing = rows(await sql`
            SELECT id, nombre_contacto FROM clientes
            WHERE empresa_id = ${empresa_id} AND whatsapp = ${c.whatsapp}
            LIMIT 1
          `);

          if (existing.length > 0) {
            const contactoActual = existing[0].nombre_contacto as string | null;
            const nuevoContacto =
              !contactoActual || contactoActual === 'Cliente nuevo' ? c.nombre_limpio : contactoActual;

            await sql`
              UPDATE clientes SET
                nombre_negocio = ${c.nombre_limpio},
                nombre_contacto = ${nuevoContacto},
                ruta_id = COALESCE(${ruta_id}, ruta_id),
                activo = true
              WHERE empresa_id = ${empresa_id} AND whatsapp = ${c.whatsapp}
            `;
            resultado.actualizados++;
          } else {
            await sql`
              INSERT INTO clientes (empresa_id, ruta_id, nombre_negocio, nombre_contacto, whatsapp, activo)
              VALUES (${empresa_id}, ${ruta_id}, ${c.nombre_limpio}, ${c.nombre_limpio}, ${c.whatsapp}, true)
            `;
            resultado.nuevos++;
          }
        }
      } catch (err) {
        resultado.errores.push(`Fila ${c.fila_numero} (${c.nombre_limpio}): ${String(err)}`);
      }
    }

    return NextResponse.json({ data: resultado });
  } catch (err) {
    console.error('[clients/import POST]', err);
    return NextResponse.json({ error: 'Error en la importación', detalle: String(err) }, { status: 500 });
  }
}
