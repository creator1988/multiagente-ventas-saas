import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { ClienteImportRow, ResultadoImportClientes } from '@/types';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// neon sql returns a union type; cast rows to work with TypeScript
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (r: any): Row[] => r as Row[];

async function getOrCreateRuta(empresa_id: string, codigo: string): Promise<string | null> {
  if (!codigo) return null;
  const nombre = `Ruta ${codigo}`;

  const existing = rows(await sql`
    SELECT id FROM rutas WHERE empresa_id = ${empresa_id} AND nombre = ${nombre} LIMIT 1
  `);
  if (existing.length > 0) return existing[0].id as string;

  const created = rows(await sql`
    INSERT INTO rutas (empresa_id, nombre, asesor_nombre, activo)
    VALUES (${empresa_id}, ${nombre}, 'Por asignar', true)
    RETURNING id
  `);
  return created[0].id as string;
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
// POST /api/clients/import — UPSERT de clientes por whatsapp
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as {
    empresa_id?: string;
    clientes: ClienteImportRow[];
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  const resultado: ResultadoImportClientes = {
    nuevos: 0,
    actualizados: 0,
    invalidos: 0,
    errores: [],
  };

  try {
    for (const c of body.clientes) {
      if (!c.valido || !c.whatsapp) {
        resultado.invalidos++;
        continue;
      }

      try {
        const ruta_id = await getOrCreateRuta(empresa_id, c.ruta_codigo);

        const existing = rows(await sql`
          SELECT id, nombre_contacto FROM clientes
          WHERE empresa_id = ${empresa_id} AND whatsapp = ${c.whatsapp}
          LIMIT 1
        `);

        if (existing.length > 0) {
          // El nombre_negocio siempre se actualiza desde el Excel. El
          // nombre_contacto solo se sobreescribe si sigue siendo el
          // placeholder de onboarding — no se pisa un nombre real ya
          // capturado por WhatsApp.
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
