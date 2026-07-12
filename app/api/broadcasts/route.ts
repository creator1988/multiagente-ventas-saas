import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { crearBroadcast, agregarDestinatariosBroadcast, enviarBroadcast } from '@/lib/kapso';
import { nombreClienteVisible } from '@/lib/cliente-nombre';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';
const KAPSO_TEMPLATE_ID = process.env.KAPSO_TEMPLATE_ID_OFERTA_DIARIA ?? '';

// Kapso acepta máximo 1000 destinatarios por request a /recipients
const LOTE_MAXIMO = 1000;

// ---------------------------------------------------------------------------
// GET /api/broadcasts — rutas activas con conteo de clientes activos, para
// los checkboxes de selección múltiple
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    const rows = await sql`
      SELECT r.id, r.nombre, COUNT(c.id) AS total_clientes
      FROM rutas r
      LEFT JOIN clientes c ON c.ruta_id = r.id AND c.activo = true
      WHERE r.empresa_id = ${empresa_id}
        AND r.activo = true
      GROUP BY r.id
      ORDER BY r.nombre ASC
    `;
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[broadcasts GET]', error);
    return NextResponse.json({ error: 'Error consultando rutas', detalle: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/broadcasts — arma los destinatarios de las rutas seleccionadas,
// elige 3 ofertas activas al azar (una vez, compartidas por toda la
// transmisión) y ejecuta el flujo completo en Kapso: crear broadcast →
// agregar destinatarios (por lotes de 1000) → enviar.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as { empresa_id?: string; ruta_ids: string[] };
  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  console.log('[broadcasts] rutas_ids:', body.ruta_ids);

  if (!Array.isArray(body.ruta_ids) || body.ruta_ids.length === 0) {
    return NextResponse.json({ error: 'ruta_ids requerido' }, { status: 400 });
  }
  if (!KAPSO_TEMPLATE_ID) {
    return NextResponse.json(
      { error: 'KAPSO_TEMPLATE_ID_OFERTA_DIARIA no está configurada (ID de la plantilla distrisanty_oferta_diaria en Kapso)' },
      { status: 500 }
    );
  }

  try {
    const clientesRows = await sql`
      SELECT whatsapp, nombre_negocio, nombre_contacto
      FROM clientes
      WHERE empresa_id = ${empresa_id}
        AND activo = true
        AND ruta_id = ANY(${body.ruta_ids}::uuid[])
    `;

    console.log('[broadcasts] clientes encontrados:', clientesRows.length);

    if (clientesRows.length === 0) {
      return NextResponse.json({ error: 'No hay clientes activos en las rutas seleccionadas' }, { status: 422 });
    }

    const ofertasRows = await sql`
      SELECT nombre, precio_combo
      FROM ofertas
      WHERE empresa_id = ${empresa_id}
        AND activo = true
      ORDER BY RANDOM()
      LIMIT 3
    `;

    if (ofertasRows.length < 3) {
      return NextResponse.json(
        { error: `Se necesitan al menos 3 ofertas activas para la plantilla (hay ${ofertasRows.length})` },
        { status: 422 }
      );
    }

    const ofertas = ofertasRows.map((o) => ({
      nombre: o.nombre as string,
      precio: `$${Number(o.precio_combo).toLocaleString('es-CO')}`,
    }));

    console.log('[broadcasts] ofertas seleccionadas:', ofertas.map((o) => o.nombre));

    const destinatarios = clientesRows.map((c) => {
      const whatsapp = c.whatsapp as string;
      const nombre = nombreClienteVisible(c as { nombre_negocio: string | null; nombre_contacto: string | null }) ?? 'Cliente';
      return {
        phone_number: whatsapp.startsWith('+') ? whatsapp : `+${whatsapp}`,
        parametros: [
          nombre,
          ofertas[0].nombre, ofertas[0].precio,
          ofertas[1].nombre, ofertas[1].precio,
          ofertas[2].nombre, ofertas[2].precio,
        ],
      };
    });

    const nombreBroadcast = `Transmisión ${new Date().toLocaleDateString('es-CO')} (${body.ruta_ids.length} ruta${body.ruta_ids.length > 1 ? 's' : ''})`;
    const { id: broadcastId } = await crearBroadcast(nombreBroadcast, KAPSO_TEMPLATE_ID);

    let agregados = 0;
    let duplicados = 0;
    const errores: string[] = [];

    for (let i = 0; i < destinatarios.length; i += LOTE_MAXIMO) {
      const lote = destinatarios.slice(i, i + LOTE_MAXIMO);
      const resultado = await agregarDestinatariosBroadcast(broadcastId, lote);
      agregados += resultado.added;
      duplicados += resultado.duplicates;
      errores.push(...resultado.errors);
    }

    const envio = await enviarBroadcast(broadcastId);

    return NextResponse.json({
      data: {
        broadcast_id: broadcastId,
        estado: envio.status,
        total_clientes: clientesRows.length,
        agregados,
        duplicados,
        errores,
        ofertas: ofertas.map((o) => o.nombre),
      },
    });
  } catch (error) {
    const err = error as Error;
    console.log('[broadcasts] ERROR:', err.message, JSON.stringify(error, Object.getOwnPropertyNames(error)));
    console.error('[broadcasts POST]', error);
    return NextResponse.json({ error: 'Error enviando transmisión', detalle: String(error) }, { status: 500 });
  }
}
