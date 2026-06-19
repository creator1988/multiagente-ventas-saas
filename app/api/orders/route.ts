import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { registrarPedido } from '@/lib/query-cards';
import { notificarPedidoNuevo } from '@/lib/resend';
import { z } from 'zod';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

const PedidoSchema = z.object({
  empresa_id: z.string().uuid().optional(),
  cliente_id: z.string().uuid(),
  conversacion_id: z.string().uuid(),
  items: z.array(
    z.object({
      producto_id: z.string().uuid(),
      cantidad: z.number().int().positive(),
      precio_unitario: z.number().positive(),
    })
  ).min(1),
  notas: z.string().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const estado = searchParams.get('estado');
  const cliente_id = searchParams.get('cliente_id');
  const fecha = searchParams.get('fecha'); // YYYY-MM-DD

  try {
    let rows;

    if (fecha) {
      rows = await sql`SELECT * FROM v_pedidos_hoy WHERE empresa_id = ${empresa_id}`;
    } else if (cliente_id) {
      rows = await sql`
        SELECT p.*, c.nombre AS cliente_nombre
        FROM pedidos p
        JOIN clientes c ON c.id = p.cliente_id
        WHERE p.empresa_id = ${empresa_id}
          AND p.cliente_id = ${cliente_id}
        ORDER BY p.created_at DESC
        LIMIT 50
      `;
    } else if (estado) {
      rows = await sql`
        SELECT p.*, c.nombre AS cliente_nombre
        FROM pedidos p
        JOIN clientes c ON c.id = p.cliente_id
        WHERE p.empresa_id = ${empresa_id}
          AND p.estado = ${estado}
        ORDER BY p.created_at DESC
        LIMIT 100
      `;
    } else {
      rows = await sql`
        SELECT p.*, c.nombre AS cliente_nombre
        FROM pedidos p
        JOIN clientes c ON c.id = p.cliente_id
        WHERE p.empresa_id = ${empresa_id}
        ORDER BY p.created_at DESC
        LIMIT 100
      `;
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[orders GET]', error);
    return NextResponse.json({ error: 'Error consultando pedidos' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = PedidoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { empresa_id = EMPRESA_ID, cliente_id, conversacion_id, items, notas } = parsed.data;

  try {
    const result = await registrarPedido(empresa_id, cliente_id, conversacion_id, items, notas);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Obtener datos del cliente para notificación
    const clienteRows = await sql`
      SELECT nombre, email FROM clientes WHERE id = ${cliente_id} LIMIT 1
    `;
    const cliente = clienteRows[0] as { nombre: string; email?: string } | undefined;

    // Obtener nombres de productos para el email
    const productosRows = await sql`
      SELECT pi.cantidad, pi.subtotal, p.nombre
      FROM pedido_items pi
      JOIN productos p ON p.id = pi.producto_id
      WHERE pi.pedido_id = ${result.data!.pedido_id}
    `;

    if (process.env.ASESOR_EMAIL && cliente) {
      await notificarPedidoNuevo({
        asesor_email: process.env.ASESOR_EMAIL,
        cliente_nombre: cliente.nombre,
        pedido_id: result.data!.pedido_id,
        total: result.data!.total,
        items: productosRows.map((r) => ({
          nombre: r.nombre as string,
          cantidad: r.cantidad as number,
          subtotal: r.subtotal as number,
        })),
      });
    }

    return NextResponse.json({ data: result.data }, { status: 201 });
  } catch (error) {
    console.error('[orders POST]', error);
    return NextResponse.json({ error: 'Error registrando pedido' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const pedido_id = searchParams.get('id');

  if (!pedido_id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const { estado } = (await request.json()) as { estado: string };
  const estadosValidos = ['pendiente', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cancelado'];

  if (!estadosValidos.includes(estado)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 422 });
  }

  try {
    await sql`
      UPDATE pedidos
      SET estado = ${estado}, updated_at = NOW()
      WHERE id = ${pedido_id}
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[orders PATCH]', error);
    return NextResponse.json({ error: 'Error actualizando pedido' }, { status: 500 });
  }
}
