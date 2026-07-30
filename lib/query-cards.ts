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
  // Sin esto, conversaciones.ultimo_mensaje nunca se actualiza tras la creación
  // de la fila: el monitor (ORDER BY ultimo_mensaje DESC) deja de reflejar
  // actividad reciente y, en bases con más filas que el LIMIT, puede
  // directamente omitir conversaciones activas.
  if (params.rol === 'cliente') {
    // El cliente volvió a escribir: se reinicia el contador de reactivaciones
    // consecutivas sin respuesta, porque este es un nuevo momento de silencio.
    await sql`
      UPDATE conversaciones SET ultimo_mensaje = NOW(), reactivaciones_consecutivas = 0
      WHERE id = ${params.conversacion_id}
    `;
  } else {
    await sql`
      UPDATE conversaciones SET ultimo_mensaje = NOW() WHERE id = ${params.conversacion_id}
    `;
  }
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
// No basta con activo=true: una categoría sin ningún producto (ni combo) con
// stock disponible no debe aparecer en el selector — si el cliente la elige
// de todas formas recibe "no encontré productos" y la categoría sigue en la
// lista para que la vuelva a elegir por error. Cuenta como "con stock" si
// tiene al menos un producto propio con stock>0, o al menos un combo activo
// cuyos componentes tengan stock suficiente (mismo criterio que seleccionarOferta).
export async function obtenerCategorias(
  empresa_id: string
): Promise<QueryCardResult<Categoria[]>> {
  try {
    const rows = await sql`
      SELECT c.id, c.empresa_id, c.nombre, c.icono_url, c.orden_display, c.activo
      FROM categorias c
      WHERE c.empresa_id = ${empresa_id}
        AND c.activo = true
        AND (
          EXISTS (
            SELECT 1 FROM productos p
            WHERE p.categoria_id = c.id
              AND p.activo = true
              AND p.stock_disponible > 0
          )
          OR EXISTS (
            SELECT 1 FROM ofertas o
            WHERE o.categoria_id = c.id
              AND o.activo = true
              AND EXISTS (SELECT 1 FROM oferta_productos op WHERE op.oferta_id = o.id)
              AND NOT EXISTS (
                SELECT 1 FROM oferta_productos op
                JOIN productos p2 ON p2.id = op.producto_id
                WHERE op.oferta_id = o.id
                  AND p2.stock_disponible < op.cantidad
              )
          )
        )
      ORDER BY c.orden_display ASC NULLS LAST, c.nombre ASC
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
// Excluye combos cuyos componentes no tengan stock suficiente para armar al
// menos 1 unidad — mismo criterio de stockCombos que ya se usaba en
// seleccionarOferta, pero aplicado aquí ANTES de listar, para que el cliente
// no pueda seleccionar un combo agotado desde la lista.
export async function ofertasParaMostrar(
  empresa_id: string,
  categoria_id?: string
): Promise<QueryCardResult<Oferta[]>> {
  try {
    const rows = categoria_id
      ? await sql`
          SELECT o.id, o.empresa_id, o.categoria_id, o.nombre, o.descripcion, o.precio_combo,
                 o.url_imagen, o.activo, o.orden_display
          FROM ofertas o
          WHERE o.empresa_id = ${empresa_id}
            AND o.categoria_id = ${categoria_id}
            AND o.activo = true
            AND EXISTS (SELECT 1 FROM oferta_productos op WHERE op.oferta_id = o.id)
            AND NOT EXISTS (
              SELECT 1 FROM oferta_productos op
              JOIN productos p ON p.id = op.producto_id
              WHERE op.oferta_id = o.id
                AND p.stock_disponible < op.cantidad
            )
          ORDER BY o.orden_display ASC NULLS LAST, o.nombre ASC
          LIMIT 20
        `
      : await sql`
          SELECT o.id, o.empresa_id, o.categoria_id, o.nombre, o.descripcion, o.precio_combo,
                 o.url_imagen, o.activo, o.orden_display
          FROM ofertas o
          WHERE o.empresa_id = ${empresa_id}
            AND o.activo = true
            AND EXISTS (SELECT 1 FROM oferta_productos op WHERE op.oferta_id = o.id)
            AND NOT EXISTS (
              SELECT 1 FROM oferta_productos op
              JOIN productos p ON p.id = op.producto_id
              WHERE op.oferta_id = o.id
                AND p.stock_disponible < op.cantidad
            )
          ORDER BY o.orden_display ASC NULLS LAST, o.nombre ASC
          LIMIT 20
        `;
    return { data: rows as Oferta[], error: null, cached: false };
  } catch (e) {
    return { data: null, error: String(e), cached: false };
  }
}

// ============================================================
// CATEGORÍAS CON OFERTAS — para el selector de categorías de ofertas, solo
// categorías que tienen al menos una oferta activa Y CON STOCK (mismo
// criterio que ofertasParaMostrar): de lo contrario el cliente elige la
// categoría y cae en "no hay ofertas disponibles" sin razón aparente.
// ============================================================
export async function categoriasConOfertas(
  empresa_id: string
): Promise<QueryCardResult<Categoria[]>> {
  try {
    const rows = await sql`
      SELECT DISTINCT c.id, c.empresa_id, c.nombre, c.icono_url, c.orden_display, c.activo
      FROM categorias c
      JOIN ofertas o ON o.categoria_id = c.id
      WHERE c.empresa_id = ${empresa_id}
        AND c.activo = true
        AND o.activo = true
        AND EXISTS (SELECT 1 FROM oferta_productos op WHERE op.oferta_id = o.id)
        AND NOT EXISTS (
          SELECT 1 FROM oferta_productos op
          JOIN productos p ON p.id = op.producto_id
          WHERE op.oferta_id = o.id
            AND p.stock_disponible < op.cantidad
        )
      ORDER BY c.orden_display ASC NULLS LAST, c.nombre ASC
    `;
    return { data: rows as Categoria[], error: null, cached: false };
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

// ============================================================
// CONVERSACIONES PARA REACTIVAR — activas, cuyo último mensaje ESCRITO POR
// EL CLIENTE lleva entre 30 y 45 minutos sin que el cliente vuelva a
// escribir (las respuestas automáticas del bot no cuentan como "actividad
// del cliente" — el bot siempre contesta al instante, así que medir el
// silencio desde el último mensaje de la conversación nunca detectaría
// nada). reactivacion_enviada_at evita reenviar dos veces por el mismo
// silencio; se limpia solo cuando el cliente vuelve a escribir después.
// Además: nunca fuera del horario 7am-9pm (hora Colombia), y nunca más de
// 3 veces seguidas sin que el cliente responda (reactivaciones_consecutivas,
// se reinicia en guardarMensaje apenas el cliente vuelve a escribir).
//
// Cooldown post-venta: al confirmar un pedido, la conversación se marca
// 'completada' (calcularIsaScore) — pero si el cliente escribe algo después
// (ej. "gracias"), obtenerOCrearConversacion no encuentra conversación activa
// y crea una nueva. Sin este filtro, esa conversación nueva podía disparar el
// mensaje genérico de "carrito abandonado" 30-45 min después de una compra ya
// cerrada, y repetirse cada vez que el cliente respondía algo breve. Se
// excluye a cualquier cliente con un pedido confirmado en las últimas 24h.
// ============================================================
export interface ConversacionParaReactivar {
  conversacion_id: string;
  cliente_id: string;
  whatsapp: string;
}

export async function conversacionesParaReactivar(
  empresa_id: string
): Promise<ConversacionParaReactivar[]> {
  const rows = await sql`
    SELECT c.id AS conversacion_id, c.cliente_id, cl.whatsapp
    FROM conversaciones c
    JOIN clientes cl ON cl.id = c.cliente_id
    JOIN LATERAL (
      SELECT MAX(timestamp) AS ultimo_cliente FROM mensajes
      WHERE conversacion_id = c.id AND rol = 'cliente'
    ) m ON true
    WHERE c.empresa_id = ${empresa_id}
      AND c.estado = 'activa'
      AND m.ultimo_cliente BETWEEN NOW() - INTERVAL '45 minutes' AND NOW() - INTERVAL '30 minutes'
      AND (c.reactivacion_enviada_at IS NULL OR c.reactivacion_enviada_at < m.ultimo_cliente)
      AND c.reactivaciones_consecutivas < 3
      AND (cl.fecha_ultimo_pedido IS NULL OR cl.fecha_ultimo_pedido < NOW() - INTERVAL '24 hours')
      AND EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/Bogota') BETWEEN 7 AND 20
    ORDER BY m.ultimo_cliente ASC
    LIMIT 50
  `;
  return rows as ConversacionParaReactivar[];
}

export async function marcarReactivacionEnviada(conversacion_id: string): Promise<void> {
  await sql`
    UPDATE conversaciones
    SET reactivacion_enviada_at = NOW(), reactivaciones_consecutivas = reactivaciones_consecutivas + 1
    WHERE id = ${conversacion_id}
  `;
}
