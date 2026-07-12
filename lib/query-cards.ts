import { sql } from './db';
import { getCached, setCached } from './cache';
import type {
  Cliente,
  Categoria,
  Producto,
  Oferta,
  VOfertaActiva,
  VTopProductoCliente,
  Pedido,
  PedidoItem,
  QueryCardResult,
  EstadoFlujo,
} from '@/types';

// ============================================================
// IDENTIFICAR_CLIENTE
// ============================================================
// No filtra por activo=true a propósito: el webhook necesita distinguir
// entre "cliente no existe" (crea uno temporal) y "cliente existe pero está
// inactivo" (gate de no-contacto) — ver app/api/webhook/kapso/route.ts.
export async function identificarCliente(
  empresa_id: string,
  whatsapp: string
): Promise<QueryCardResult<Cliente>> {
  try {
    // Maneja ambos formatos: "573043783705" y "+573043783705"
    const sinPlus = whatsapp.replace(/^\+/, '');
    const conPlus = `+${sinPlus}`;
    const rows = await sql`
      SELECT * FROM clientes
      WHERE empresa_id = ${empresa_id}
        AND (whatsapp = ${sinPlus} OR whatsapp = ${conPlus})
      LIMIT 1
    `;
    return { data: (rows[0] as Cliente) ?? null, error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

export async function reactivarCliente(cliente_id: string): Promise<void> {
  await sql`UPDATE clientes SET activo = true WHERE id = ${cliente_id}`;
}

export async function crearClienteTemporal(
  empresa_id: string,
  whatsapp: string
): Promise<QueryCardResult<Cliente>> {
  try {
    const rows = await sql`
      INSERT INTO clientes (empresa_id, nombre_negocio, nombre_contacto, whatsapp, activo)
      VALUES (${empresa_id}, 'Cliente nuevo', 'Cliente nuevo', ${whatsapp}, true)
      RETURNING *
    `;
    return { data: rows[0] as Cliente, error: null, cached: false };
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
      SELECT id, nombre, stock_disponible, precio_lista, unidad_medida
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
      ORDER BY creado_at DESC
      LIMIT 1
    `;

    if (!pedidos.length) return { data: null, error: null, cached: false };

    const pedido = pedidos[0] as Pedido;
    const items = await sql`
      SELECT pi.*, pi.nombre_snapshot AS producto_nombre
      FROM pedido_items pi
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
  tipo: 'producto' | 'oferta';
  producto_id?: string;
  oferta_id?: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
}

export async function registrarPedido(
  empresa_id: string,
  cliente_id: string,
  conversacion_id: string,
  items: ItemPedido[],
  notas?: string,
  ruta_id?: string | null
): Promise<QueryCardResult<{ pedido_id: string; total: number }>> {
  try {
    const total = items.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);

    console.log('[registrar-pedido] cliente_id:', cliente_id);
    console.log('[registrar-pedido] empresa_id:', empresa_id);
    console.log('[registrar-pedido] carrito:', JSON.stringify(items));
    console.log('[registrar-pedido] total:', total);

    const pedidoRows = await sql`
      INSERT INTO pedidos (empresa_id, cliente_id, ruta_id, estado, canal, total, notas)
      VALUES (${empresa_id}, ${cliente_id}, ${ruta_id ?? null}, 'nuevo', 'whatsapp', ${total}, ${notas ?? null})
      RETURNING id
    `;

    const pedido_id = pedidoRows[0].id as string;

    await sql`
      UPDATE conversaciones SET pedido_id = ${pedido_id} WHERE id = ${conversacion_id}
    `;

    for (const item of items) {
      await sql`
        INSERT INTO pedido_items (pedido_id, producto_id, oferta_id, tipo, cantidad, precio_unitario, nombre_snapshot)
        VALUES (
          ${pedido_id},
          ${item.producto_id ?? null},
          ${item.oferta_id ?? null},
          ${item.tipo},
          ${item.cantidad},
          ${item.precio_unitario},
          ${item.nombre}
        )
      `;
    }

    // Descontar stock: directo para productos, vía componentes para ofertas (combos)
    for (const item of items) {
      if (item.tipo === 'oferta' && item.oferta_id) {
        const componentes = await sql`
          SELECT producto_id, cantidad FROM oferta_productos WHERE oferta_id = ${item.oferta_id}
        `;
        for (const c of componentes) {
          await sql`
            UPDATE productos
            SET stock_disponible = stock_disponible - ${(c.cantidad as number) * item.cantidad}
            WHERE id = ${c.producto_id}
              AND empresa_id = ${empresa_id}
          `;
        }
      } else if (item.producto_id) {
        await sql`
          UPDATE productos
          SET stock_disponible = stock_disponible - ${item.cantidad}
          WHERE id = ${item.producto_id}
            AND empresa_id = ${empresa_id}
        `;
      }
    }

    return { data: { pedido_id, total }, error: null, cached: false };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    console.log('[registrar-pedido] ERROR:', err.message, err.code);
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// GUARDAR MENSAJE
// ============================================================
export async function guardarMensaje(params: {
  conversacion_id: string;
  rol: 'cliente' | 'agente';
  contenido: string;
  tipo?: string;
}): Promise<void> {
  await sql`
    INSERT INTO mensajes (conversacion_id, rol, contenido, tipo)
    VALUES (
      ${params.conversacion_id},
      ${params.rol},
      ${params.contenido},
      ${params.tipo ?? 'texto'}
    )
  `;
}

// ============================================================
// OBTENER O CREAR CONVERSACIÓN
// ============================================================
export async function obtenerOCrearConversacion(
  empresa_id: string,
  cliente_id: string
): Promise<string> {
  const activa = await sql`
    SELECT id FROM conversaciones
    WHERE empresa_id = ${empresa_id}
      AND cliente_id = ${cliente_id}
      AND estado = 'activa'
    ORDER BY inicio DESC
    LIMIT 1
  `;

  if (activa.length) return activa[0].id as string;

  const nueva = await sql`
    INSERT INTO conversaciones (empresa_id, cliente_id, canal, estado)
    VALUES (${empresa_id}, ${cliente_id}, 'whatsapp', 'activa')
    RETURNING id
  `;

  return nueva[0].id as string;
}

// ============================================================
// OBTENER CATEGORÍAS
// ============================================================
export async function obtenerCategorias(
  empresa_id: string
): Promise<QueryCardResult<Categoria[]>> {
  try {
    const rows = await sql`
      SELECT id, empresa_id, nombre, icono_url, orden_display, activo
      FROM categorias
      WHERE empresa_id = ${empresa_id}
        AND activo = true
      ORDER BY orden_display ASC NULLS LAST, nombre ASC
    `;
    return { data: rows as Categoria[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// PRODUCTOS POR CATEGORÍA (para catálogo de una categoría)
// ============================================================
export async function productosPorCategoria(
  empresa_id: string,
  categoria_id: string
): Promise<QueryCardResult<Producto[]>> {
  try {
    const rows = await sql`
      SELECT id, empresa_id, categoria_id, nombre, descripcion,
             precio_lista, unidad_medida, stock_disponible, url_imagen, activo
      FROM productos
      WHERE empresa_id = ${empresa_id}
        AND categoria_id = ${categoria_id}
        AND activo = true
        AND stock_disponible > 0
      ORDER BY nombre ASC
      LIMIT 20
    `;
    return { data: rows as Producto[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// OFERTAS PARA MOSTRAR (tabla directa, con url_imagen)
// ============================================================
export async function ofertasParaMostrar(
  empresa_id: string
): Promise<QueryCardResult<Oferta[]>> {
  try {
    const rows = await sql`
      SELECT id, empresa_id, nombre, descripcion, precio_combo,
             url_imagen, activo, orden_display
      FROM ofertas
      WHERE empresa_id = ${empresa_id}
        AND activo = true
      ORDER BY orden_display ASC NULLS LAST, nombre ASC
      LIMIT 20
    `;
    return { data: rows as Oferta[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// OBTENER OFERTA CON COMPONENTES (para agregarla al carrito)
// ============================================================
export interface ComponenteOferta {
  producto_id: string;
  cantidad: number;
  stock_disponible: number;
}

export async function obtenerOferta(
  empresa_id: string,
  oferta_id: string
): Promise<QueryCardResult<{ id: string; nombre: string; precio_combo: number; componentes: ComponenteOferta[] }>> {
  try {
    const ofertaRows = await sql`
      SELECT id, nombre, precio_combo
      FROM ofertas
      WHERE id = ${oferta_id}
        AND empresa_id = ${empresa_id}
        AND activo = true
      LIMIT 1
    `;

    if (!ofertaRows.length) return { data: null, error: 'Oferta no encontrada', cached: false };

    const componentes = await sql`
      SELECT op.producto_id, op.cantidad, p.stock_disponible
      FROM oferta_productos op
      JOIN productos p ON p.id = op.producto_id
      WHERE op.oferta_id = ${oferta_id}
    `;

    return {
      data: {
        id: ofertaRows[0].id as string,
        nombre: ofertaRows[0].nombre as string,
        precio_combo: Number(ofertaRows[0].precio_combo),
        componentes: componentes.map(c => ({
          producto_id: c.producto_id as string,
          cantidad: c.cantidad as number,
          stock_disponible: c.stock_disponible as number,
        })),
      },
      error: null,
      cached: false,
    };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// ACTUALIZAR ÚLTIMO PEDIDO DEL CLIENTE
// ============================================================
export async function actualizarUltimoPedido(cliente_id: string): Promise<void> {
  try {
    await sql`
      UPDATE clientes
      SET fecha_ultimo_pedido = NOW()
      WHERE id = ${cliente_id}
    `;
  } catch (e) {
    console.error('[query-cards] actualizarUltimoPedido error:', e);
  }
}

// ============================================================
// ACTUALIZAR DATOS DE CLIENTE (nombre, dirección, teléfono) — cliente nuevo/incompleto
// Guarda el nombre en nombre_negocio Y nombre_contacto: antes solo se
// actualizaba nombre_contacto, dejando nombre_negocio congelado en el
// placeholder 'Cliente nuevo' (crearClienteTemporal) para siempre — eso
// filtraba a saludos, emails y logs vía el patrón nombre_negocio ?? nombre_contacto.
// ============================================================
export async function actualizarDatosCliente(
  cliente_id: string,
  datos: { nombre: string; direccion: string; telefono: string; barrio?: string }
): Promise<QueryCardResult<null>> {
  try {
    await sql`
      UPDATE clientes
      SET nombre_negocio = ${datos.nombre},
          nombre_contacto = ${datos.nombre},
          direccion = ${datos.direccion},
          barrio = ${datos.barrio ?? null},
          telefono = ${datos.telefono}
      WHERE id = ${cliente_id}
    `;
    return { data: null, error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// ESTADO DEL FLUJO (carrito y etapa — persistido en cache L1+L2)
// ============================================================
const ESTADO_DEFAULT: EstadoFlujo = { etapa: 'inicio', carrito: [] };

export async function getEstadoFlujo(
  empresa_id: string,
  conversacion_id: string
): Promise<EstadoFlujo> {
  try {
    const cached = await getCached(empresa_id, 'flujo', conversacion_id);
    if (!cached) return { ...ESTADO_DEFAULT };
    return JSON.parse(cached) as EstadoFlujo;
  } catch {
    return { ...ESTADO_DEFAULT };
  }
}

export async function setEstadoFlujo(
  empresa_id: string,
  conversacion_id: string,
  estado: EstadoFlujo
): Promise<void> {
  await setCached(empresa_id, 'flujo', conversacion_id, JSON.stringify(estado), 900);
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
      AND rol IN ('cliente', 'agente')
    ORDER BY timestamp DESC
    LIMIT ${limite}
  `;

  return (rows as Array<{ rol: string; contenido: string }>)
    .reverse()
    .map(m => ({
      rol: (m.rol === 'cliente' ? 'user' : 'assistant') as 'user' | 'assistant',
      contenido: m.contenido,
    }));
}
