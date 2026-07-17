import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { guardarMensaje } from '@/lib/query-cards';
import { enviarTexto } from '@/lib/kapso';
import { notificarEscalado } from '@/lib/resend';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';
const ESTADOS_VALIDOS = ['activa', 'completada', 'escalada'] as const;
type Estado = (typeof ESTADOS_VALIDOS)[number];

// GET ?id=UUID          -> conversación completa con todos sus mensajes
// GET ?lista=true (o sin params) -> conversaciones con último mensaje, ordenadas por ultimo_mensaje DESC
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const id = searchParams.get('id');

  try {
    if (id) {
      const conv = await sql`
        SELECT co.*, COALESCE(cl.nombre_negocio, cl.nombre_contacto) AS cliente_nombre,
               cl.whatsapp AS whatsapp_numero
        FROM conversaciones co
        LEFT JOIN clientes cl ON cl.id = co.cliente_id
        WHERE co.id = ${id} AND co.empresa_id = ${empresa_id}
        LIMIT 1
      `;

      if (!conv.length) {
        return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
      }

      const mensajes = await sql`
        SELECT id, rol, contenido, tipo, timestamp
        FROM mensajes
        WHERE conversacion_id = ${id}
        ORDER BY timestamp ASC
      `;

      return NextResponse.json({ data: { ...conv[0], mensajes } });
    }

    const rows = await sql`
      SELECT co.id, co.estado, co.isa_score, co.ultimo_mensaje, co.inicio,
             COALESCE(cl.nombre_negocio, cl.nombre_contacto) AS cliente_nombre,
             cl.whatsapp AS whatsapp_numero,
             um.contenido AS ultimo_mensaje_texto
      FROM conversaciones co
      LEFT JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN LATERAL (
        SELECT contenido FROM mensajes m
        WHERE m.conversacion_id = co.id
        ORDER BY m.timestamp DESC
        LIMIT 1
      ) um ON true
      WHERE co.empresa_id = ${empresa_id}
      ORDER BY co.ultimo_mensaje DESC NULLS LAST, co.inicio DESC
      LIMIT 200
    `;

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[conversations GET]', error);
    return NextResponse.json({ error: 'Error consultando conversaciones' }, { status: 500 });
  }
}

// POST ?id=UUID -> enviar un mensaje directo al cliente como agente (vía Kapso) y registrarlo en el hilo
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const { mensaje } = (await request.json()) as { mensaje?: string };
  if (!mensaje?.trim()) {
    return NextResponse.json({ error: 'mensaje requerido' }, { status: 400 });
  }

  try {
    const rows = await sql`
      SELECT cl.whatsapp
      FROM conversaciones co
      JOIN clientes cl ON cl.id = co.cliente_id
      WHERE co.id = ${id} AND co.empresa_id = ${empresa_id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
    }

    await enviarTexto(rows[0].whatsapp as string, mensaje.trim());
    await guardarMensaje({ conversacion_id: id, rol: 'agente', contenido: mensaje.trim(), tipo: 'texto' });
    await sql`UPDATE conversaciones SET ultimo_mensaje = now() WHERE id = ${id}`;

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    console.error('[conversations POST]', error);
    return NextResponse.json({ error: 'Error enviando mensaje' }, { status: 500 });
  }
}

// PATCH ?id=UUID -> actualiza el estado de la conversación; si pasa a 'escalada' notifica al asesor por Resend
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const { estado, motivo } = (await request.json()) as { estado?: string; motivo?: string };
  if (!estado || !ESTADOS_VALIDOS.includes(estado as Estado)) {
    return NextResponse.json({ error: 'estado inválido' }, { status: 400 });
  }

  try {
    const rows =
      estado === 'escalada'
        ? await sql`
            WITH updated AS (
              UPDATE conversaciones
              SET estado = 'escalada', escalada_a = ${process.env.ASESOR_EMAIL ?? null}
              WHERE id = ${id} AND empresa_id = ${empresa_id}
              RETURNING *
            )
            SELECT updated.*, COALESCE(cl.nombre_negocio, cl.nombre_contacto) AS cliente_nombre,
                   cl.whatsapp AS whatsapp_numero
            FROM updated
            LEFT JOIN clientes cl ON cl.id = updated.cliente_id
          `
        : await sql`
            WITH updated AS (
              UPDATE conversaciones
              SET estado = ${estado}
              WHERE id = ${id} AND empresa_id = ${empresa_id}
              RETURNING *
            )
            SELECT updated.*, COALESCE(cl.nombre_negocio, cl.nombre_contacto) AS cliente_nombre,
                   cl.whatsapp AS whatsapp_numero
            FROM updated
            LEFT JOIN clientes cl ON cl.id = updated.cliente_id
          `;

    if (!rows.length) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
    }

    if (estado === 'escalada' && process.env.ASESOR_EMAIL) {
      await notificarEscalado({
        asesor_email: process.env.ASESOR_EMAIL,
        cliente_nombre: (rows[0].cliente_nombre as string) ?? 'Cliente',
        whatsapp: (rows[0].whatsapp_numero as string) ?? '',
        motivo: motivo ?? 'Escalada manual desde el monitor',
        conversacion_id: id,
      });
    }

    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    console.error('[conversations PATCH]', error);
    return NextResponse.json({ error: 'Error actualizando conversación' }, { status: 500 });
  }
}
