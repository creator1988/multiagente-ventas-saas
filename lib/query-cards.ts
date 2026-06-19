import { sql } from './db';
import type {
  Cliente,
  Producto,
  VOfertaActiva,
  VTopProductoCliente,
  Pedido,
  PedidoItem,
  QueryCardResult,
} from '@/types';

// ============================================================
// IDENTIFICAR_CLIENTE
// ============================================================
export async function identificarCliente(
  empresa_id: string,
  whatsapp: string
): Promise<QueryCardResult<Cliente>> {
  try {
    const rows = await sql`
      SELECT * FROM clientes
      WHERE empresa_id = ${empresa_id}
        AND whatsapp = ${whatsapp}
        AND activo = true
      LIMIT 1
    `;
    return { data: (rows[0] as Cliente) ?? null, error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// CATALOGO_CATEGORIA
// ============================================================
export async function catalogoPorCategoria(
  empresa_id: string,
  categoria_nombre?: string
): Promise<QueryCardResult<Producto[]>> {
  try {
    const rows = categoria_nombre
      ? await sql`
          SELECT p.*, c.nombre AS categoria_nombre
          FROM productos p
          JOIN categorias c ON c.id = p.categoria_id
          WHERE p.empresa_id = ${empresa_id}
            AND p.activo = true
            AND p.stock_disponible > 0
            AND LOWER(c.nombre) LIKE ${'%' + categoria_nombre.toLowerCase() + '%'}
          ORDER BY p.nombre
          LIMIT 20
        `
      : await sql`
          SELECT p.*, c.nombre AS categoria_nombre
          FROM productos p
          JOIN categorias c ON c.id = p.categoria_id
          WHERE p.empresa_id = ${empresa_id}
            AND p.activo = true
            AND p.stock_disponible > 0
          ORDER BY c.nombre, p.nombre
          LIMIT 20
        `;
    return { data: rows as Producto[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// OFERTAS_ACTIVAS
// ============================================================
export async function ofertasActivas(
  empresa_id: string
): Promise<QueryCardResult<VOfertaActiva[]>> {
  try {
    const rows = await sql`
      SELECT * FROM v_ofertas_activas
      WHERE empresa_id = ${empresa_id}
    `;
    return { data: rows as VOfertaActiva[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// HISTORIAL_CLIENTE
// ============================================================
export async function historialCliente(
  empresa_id: string,
  cliente_id: string
): Promise<QueryCardResult<VTopProductoCliente[]>> {
  try {
    const rows = await sql`
      SELECT * FROM v_top_productos_cliente
      WHERE empresa_id = ${empresa_id}
        AND cliente_id = ${cliente_id}
      ORDER BY total_pedidos DESC
      LIMIT 10
    `;
    return { data: rows as VTopProductoCliente[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// CONSULTAR_STOCK
// ============================================================
export async function consultarStock(
  empresa_id: string,
  producto_nombre: string
): Promise<QueryCardResult<Producto[]>> {
  try {
    const rows = await sql`
      SELECT id, nombre, stock_disponible, precio_base, unidad
      FROM productos
      WHERE empresa_id = ${empresa_id}
        AND activo = true
        AND LOWER(nombre) LIKE ${'%' + producto_nombre.toLowerCase() + '%'}
      ORDER BY nombre
      LIMIT 5
    `;
    return { data: rows as Producto[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// ULTIMO_PEDIDO
// ============================================================
export async function ultimoPedido(
  empresa_id: string,
  cliente_id: string
): Promise<QueryCardResult<{ pedido: Pedido; items: PedidoItem[] }>> {
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      WHERE empresa_id = ${empresa_id}
        AND cliente_id = ${cliente_id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!pedidos.length) return { data: null, error: null, cached: false };

    const pedido = pedidos[0] as Pedido;
    const items = await sql`
      SELECT pi.*, p.nombre AS producto_nombre
      FROM pedido_items pi
      JOIN productos p ON p.id = pi.producto_id
      WHERE pi.pedido_id = ${pedido.id}
    `;

    return {
      data: { pedido, items: items as PedidoItem[] },
      error: null,
      cached: false,
    };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// REGISTRAR_PEDIDO
// ============================================================
export interface ItemPedido {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
}

export async function registrarPedido(
  empresa_id: string,
  cliente_id: string,
  conversacion_id: string,
  items: ItemPedido[],
  notas?: string
): Promise<QueryCardResult<{ pedido_id: string; total: number }>> {
  try {
    const total = items.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);

    const pedidoRows = await sql`
      INSERT INTO pedidos (empresa_id, cliente_id, conversacion_id, estado, total, notas)
      VALUES (${empresa_id}, ${cliente_id}, ${conversacion_id}, 'pendiente', ${total}, ${notas ?? null})
      RETURNING id
    `;

    const pedido_id = pedidoRows[0].id as string;

    for (const item of items) {
      await sql`
        INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, subtotal)
        VALUES (
          ${pedido_id},
          ${item.producto_id},
          ${item.cantidad},
          ${item.precio_unitario},
          ${item.cantidad * item.precio_unitario}
        )
      `;
    }

    // Descontar stock
    for (const item of items) {
      await sql`
        UPDATE productos
        SET stock_disponible = stock_disponible - ${item.cantidad}
        WHERE id = ${item.producto_id}
          AND empresa_id = ${empresa_id}
      `;
    }

    return { data: { pedido_id, total }, error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// GUARDAR MENSAJE
// ============================================================
export async function guardarMensaje(params: {
  conversacion_id: string;
  empresa_id: string;
  rol: 'user' | 'assistant';
  contenido: string;
  tipo?: string;
  kapso_message_id?: string;
}): Promise<void> {
  await sql`
    INSERT INTO mensajes (conversacion_id, empresa_id, rol, contenido, tipo, kapso_message_id)
    VALUES (
      ${params.conversacion_id},
      ${params.empresa_id},
      ${params.rol},
      ${params.contenido},
      ${params.tipo ?? 'text'},
      ${params.kapso_message_id ?? null}
    )
  `;
}

// ============================================================
// OBTENER O CREAR CONVERSACIÓN
// ============================================================
export async function obtenerOCrearConversacion(
  empresa_id: string,
  whatsapp: string,
  cliente_id?: string
): Promise<string> {
  const activa = await sql`
    SELECT id FROM conversaciones
    WHERE empresa_id = ${empresa_id}
      AND whatsapp_numero = ${whatsapp}
      AND estado = 'activa'
    ORDER BY iniciada_at DESC
    LIMIT 1
  `;

  if (activa.length) return activa[0].id as string;

  const nueva = await sql`
    INSERT INTO conversaciones (empresa_id, cliente_id, whatsapp_numero, estado)
    VALUES (${empresa_id}, ${cliente_id ?? null}, ${whatsapp}, 'activa')
    RETURNING id
  `;

  return nueva[0].id as string;
}

// ============================================================
// HISTORIAL DE MENSAJES (para contexto del LLM)
// ============================================================
export async function obtenerHistorialMensajes(
  conversacion_id: string,
  limite: number = 10
): Promise<Array<{ rol: 'user' | 'assistant'; contenido: string }>> {
  const rows = await sql`
    SELECT rol, contenido FROM mensajes
    WHERE conversacion_id = ${conversacion_id}
      AND rol IN ('user', 'assistant')
    ORDER BY created_at DESC
    LIMIT ${limite}
  `;

  return (rows as Array<{ rol: 'user' | 'assistant'; contenido: string }>).reverse();
}
