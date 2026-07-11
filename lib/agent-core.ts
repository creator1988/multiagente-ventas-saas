import type { Cliente, Intencion, EstadoFlujo, CartItem, PedidoItemConNombre, ProductoContexto } from '@/types';
import type { ItemPedido } from './query-cards';
import {
  obtenerCategorias,
  productosPorCategoria,
  ofertasParaMostrar,
  obtenerOferta,
  consultarStock,
  historialCliente,
  ultimoPedido,
  registrarPedido,
  actualizarUltimoPedido,
  actualizarDatosCliente,
  guardarMensaje,
  getEstadoFlujo,
  setEstadoFlujo,
} from './query-cards';
import { completarConClaude } from './claude';
import { buildSystemPrompt } from './agent-prompt';
import { getCached, setCached } from './cache';
import { enviarTexto, enviarListMessage, enviarReplyButtons, enviarProductoConBoton, enviarOfertaConBoton } from './kapso';
import { notificarPedidoNuevo, notificarPedidoFallido } from './resend';
import { calcularIsaScore } from './monitor';
import { sql } from './db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OFERTAS_REGEX = /\b(promoci[oó]n(es)?|ofertas?|combos?|especiales?)\b/i;

const BUSQUEDA_PRODUCTO_REGEX = /^(quiero|necesito|me\s*das?|dame|p[ií]deme|ponme|comprar?|llevar?|tienes?|busco|buscas?)\s+/i;

function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function esTextoOfertas(texto: string): boolean {
  return OFERTAS_REGEX.test(normalizarTexto(texto));
}

async function detectarCategoriaPorTexto(empresa_id: string, texto: string) {
  const { data: categorias } = await obtenerCategorias(empresa_id);
  if (!categorias || categorias.length === 0) return null;

  const textoNorm = normalizarTexto(texto);
  return categorias.find(c => textoNorm.includes(normalizarTexto(c.nombre))) ?? null;
}

interface ProcesarParams {
  empresa_id: string;
  whatsapp: string;
  cliente: Cliente | null;
  conversacion_id: string;
  textoUsuario: string;
  intencion: Intencion;
  historial: Array<{ rol: 'user' | 'assistant'; contenido: string }>;
}

// ============================================================
// PÚBLICO: procesarNuevoCliente — llamado desde route.ts para cliente recién creado
// ============================================================
export async function procesarNuevoCliente(
  empresa_id: string,
  cliente: Cliente,
  whatsapp: string,
  conversacion_id: string
): Promise<void> {
  await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
}

// ============================================================
// PÚBLICO: procesarConClaude — dispatcher principal (state machine)
// ============================================================
export async function procesarConClaude(params: ProcesarParams): Promise<void> {
  const { empresa_id, whatsapp, cliente, conversacion_id, textoUsuario, intencion } = params;

  console.log('[agent-core] empresa_id:', empresa_id, 'intencion:', intencion, 'texto:', textoUsuario.substring(0, 60));

  const estado = await getEstadoFlujo(empresa_id, conversacion_id);

  // PRIORIDAD 1: cancelación universal
  if (textoUsuario === 'btn_cancelar') {
    await cancelarFlujo(params);
    return;
  }

  // PRIORIDAD 2: estado "esperando_producto" — captura solo si es un UUID real (list_reply)
  if (estado.etapa === 'esperando_producto') {
    if (UUID_REGEX.test(textoUsuario)) {
      await seleccionarProducto(params, estado, textoUsuario);
      return;
    }
    // Texto libre en vez de selección de la lista: abandonamos la etapa y
    // dejamos que el mensaje se enrute por intención normalmente.
    await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'inicio' });
  }

  // PRIORIDAD 3: estado "esperando_cantidad" — botones rápidos (qty_N) o texto numérico
  if (estado.etapa === 'esperando_cantidad') {
    const qtyMatch = textoUsuario.match(/^qty_(\d+)$/);
    const num = qtyMatch
      ? parseInt(qtyMatch[1], 10)
      : parseInt(textoUsuario.trim(), 10);
    if (!isNaN(num) && num > 0) {
      await manejarCantidad(params, estado, num);
      return;
    }
    const msg = `Por favor escribe el número de unidades de *${estado.producto_contexto?.nombre ?? 'ese producto'}* que deseas.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  // PRIORIDAD 3.6: submenú "Modificar" — elegir producto del carrito y aplicar la acción pendiente
  if (estado.etapa === 'esperando_indice_cantidad') {
    await seleccionarIndiceCantidad(params, estado, textoUsuario);
    return;
  }
  if (estado.etapa === 'esperando_nueva_cantidad') {
    await aplicarNuevaCantidad(params, estado, textoUsuario);
    return;
  }
  if (estado.etapa === 'esperando_indice_quitar') {
    await quitarDelCarrito(params, estado, textoUsuario);
    return;
  }

  // PRIORIDAD 3.5: recolección de datos de cliente nuevo/incompleto antes de confirmar
  if (estado.etapa === 'esperando_nombre') {
    await capturarNombreCliente(params, estado, textoUsuario);
    return;
  }
  if (estado.etapa === 'esperando_direccion') {
    await capturarDireccionCliente(params, estado, textoUsuario);
    return;
  }
  if (estado.etapa === 'esperando_telefono_confirmacion') {
    await capturarTelefonoCliente(params, estado, textoUsuario);
    return;
  }

  // PRIORIDAD 4: intención de confirmar pedido — se evalúa incondicionalmente y
  // ANTES de la detección de texto libre (4.5) porque frases como "quiero pagar"
  // o "quiero terminar el pedido" empiezan igual que una búsqueda de producto.
  if (intencion === 'confirmar_pedido') {
    if (estado.carrito.length === 0) {
      const msg = 'No tienes productos en tu carrito aún. ¿Quieres ver el catálogo?';
      await enviarTexto(whatsapp, msg);
      await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
      await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
      return;
    }
    if (estado.etapa === 'esperando_confirmacion_final') {
      await registrarPedidoFinal(params, estado);
    } else {
      await confirmarPedido(params, estado);
    }
    return;
  }

  // PRIORIDAD 4.5: detección temprana en texto libre (categoría, ofertas o producto por
  // nombre) — corre ANTES del switch por intención porque el clasificador de regex no
  // reconoce nombres reales de categorías/productos ni frases sueltas de audio transcrito.
  const esIdEstructurado = /^(cat_|add_|addoferta_|btn_|qty_)/.test(textoUsuario);
  if (!esIdEstructurado) {
    const categoriaDetectada = await detectarCategoriaPorTexto(empresa_id, textoUsuario);
    if (categoriaDetectada) {
      await mostrarProductosCategoria(params, estado, `cat_${categoriaDetectada.id}`);
      return;
    }

    if (esTextoOfertas(textoUsuario)) {
      await mostrarOfertas(params);
      return;
    }

    if (BUSQUEDA_PRODUCTO_REGEX.test(textoUsuario)) {
      await iniciarAgregarAlPedido(params, estado);
      return;
    }

    // Nombre de producto "pelado" sin verbo (ej. "Halls", audio transcrito literal).
    // Búsqueda silenciosa: si no hay match no respondemos aquí, seguimos el flujo normal.
    if (textoUsuario.trim().length >= 3) {
      const { data: productosEncontrados } = await consultarStock(empresa_id, textoUsuario.trim());
      if (productosEncontrados && productosEncontrados.length > 0) {
        await presentarProductoParaCantidad(params, estado, productosEncontrados[0]);
        return;
      }
    }
  }

  // PRIORIDAD 5: enrutamiento por intención
  switch (intencion) {
    case 'saludo':
    case 'catalogo':
      await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
      break;

    case 'categoria_seleccionada':
      await mostrarProductosCategoria(params, estado, textoUsuario);
      break;

    case 'ver_ofertas':
      await mostrarOfertas(params);
      break;

    case 'pedido':
    case 'agregar_pedido':
      await iniciarAgregarAlPedido(params, estado);
      break;

    case 'repetir_pedido':
      await repetirUltimoPedido(params, estado);
      break;

    case 'modificar_pedido':
      await mostrarMenuModificar(params, estado);
      break;

    case 'cambiar_cantidad':
      await iniciarCambiarCantidad(params, estado);
      break;

    case 'quitar_producto':
      await iniciarQuitarProducto(params, estado);
      break;

    default:
      await procesarConIA(params);
      break;
  }
}

// ============================================================
// PRIVADO: mostrarCategorias
// ============================================================
async function mostrarCategorias(
  empresa_id: string,
  cliente: Cliente | null,
  whatsapp: string,
  conversacion_id: string
): Promise<void> {
  const { data: categorias, error } = await obtenerCategorias(empresa_id);

  if (error || !categorias || categorias.length === 0) {
    if (error) console.error('[agent-core] mostrarCategorias error Query Card:', error);
    const msg = 'Lo siento, hubo un error técnico.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nombre = cliente?.nombre_negocio ?? cliente?.nombre_contacto;
  let saludo: string;
  if (nombre && cliente?.fecha_ultimo_pedido) {
    const fecha = new Date(cliente.fecha_ultimo_pedido).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    saludo = `¡Hola ${nombre}! 👋 Te reconozco — tu último pedido fue el ${fecha}. ¿Qué categoría te interesa hoy?`;
  } else if (nombre) {
    saludo = `¡Hola ${nombre}! 👋 ¿Qué categoría te interesa hoy?`;
  } else {
    saludo = '¡Hola! 👋 ¿Qué categoría te interesa hoy?';
  }

  const rows = categorias.slice(0, 10).map(c => ({
    id: `cat_${c.id}`,
    title: c.nombre.substring(0, 24),
  }));

  await enviarListMessage(
    whatsapp,
    saludo,
    'Ver categorías',
    [{ title: 'Categorías disponibles', rows }]
  );
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: saludo });
}

// ============================================================
// PRIVADO: obtenerNombreCategoria — lookup puntual por id, para etiquetar
// botones ("Otra de [categoría]") y mensajes de la lista sin imágenes
// ============================================================
async function obtenerNombreCategoria(empresa_id: string, categoria_id: string): Promise<string | null> {
  const rows = await sql`
    SELECT nombre FROM categorias WHERE id = ${categoria_id} AND empresa_id = ${empresa_id} LIMIT 1
  `;
  return rows.length ? (rows[0].nombre as string) : null;
}

// ============================================================
// PRIVADO: enviarListaProductosSinImagenes — list_message con nombre+precio,
// sin imágenes. Usado cuando el cliente ya vio la categoría con fotos, o
// pide explícitamente "Otra de [categoría]" mientras sigue navegándola.
// ============================================================
async function enviarListaProductosSinImagenes(
  params: ProcesarParams,
  estado: EstadoFlujo,
  categoria_id: string,
  categoria_nombre: string,
  productos: Array<{ id: string; nombre: string; precio_lista: number; stock_disponible: number }>
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;

  const rows = productos.slice(0, 10).map(p => ({
    id: p.id,
    title: p.nombre.substring(0, 24),
    description: `$${p.precio_lista.toLocaleString('es-CO')} | Stock: ${p.stock_disponible}`,
  }));

  await enviarListMessage(
    whatsapp,
    `Productos de ${categoria_nombre}:`,
    'Seleccionar',
    [{ title: categoria_nombre.substring(0, 24), rows }]
  );
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: `Lista de productos de ${categoria_nombre} (sin imágenes)` });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_producto',
    last_categoria_id: categoria_id,
    last_categoria_nombre: categoria_nombre,
  });
}

// ============================================================
// PRIVADO: mostrarProductosCategoria — primera vez que el cliente entra a
// una categoría: fotos por producto. Si ya la vio antes (categorias_vistas),
// lista de texto sin imágenes para no repetir contenido ya mostrado.
// ============================================================
async function mostrarProductosCategoria(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;
  const categoria_id = textoUsuario.replace(/^cat_/, '');

  const [{ data: productos, error }, categoria_nombre] = await Promise.all([
    productosPorCategoria(empresa_id, categoria_id),
    obtenerNombreCategoria(empresa_id, categoria_id),
  ]);

  if (error || !productos || productos.length === 0) {
    const msg = 'No encontré productos en esa categoría con stock disponible. Te muestro las otras opciones.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const yaVista = (estado.categorias_vistas ?? []).includes(categoria_id);
  const nombre = categoria_nombre ?? 'esta categoría';

  if (yaVista) {
    await enviarListaProductosSinImagenes(params, estado, categoria_id, nombre, productos);
    return;
  }

  for (const p of productos) {
    await enviarProductoConBoton(whatsapp, p);
  }

  const nuevoEstado: EstadoFlujo = {
    ...estado,
    last_categoria_id: categoria_id,
    last_categoria_nombre: nombre,
    categorias_vistas: [...(estado.categorias_vistas ?? []), categoria_id],
  };
  await setEstadoFlujo(empresa_id, conversacion_id, nuevoEstado);

  await enviarReplyButtons(whatsapp, '¿Qué más deseas hacer?', [
    { id: 'btn_ver_cat',  title: 'Ver otra categoría' },
    { id: 'btn_ofertas',  title: 'Ver ofertas' },
    { id: 'btn_confirmar', title: 'Confirmar pedido' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: `Productos de categoría mostrados (${productos.length} items)` });
}

// ============================================================
// PRIVADO: mostrarOfertas
// ============================================================
async function mostrarOfertas(
  params: ProcesarParams
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;
  const { data: ofertas, error } = await ofertasParaMostrar(empresa_id);

  if (error || !ofertas || ofertas.length === 0) {
    const msg = 'No hay ofertas disponibles en este momento. ¿Te muestro el catálogo?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  for (const o of ofertas) {
    await enviarOfertaConBoton(whatsapp, o);
  }

  await enviarReplyButtons(whatsapp, '¿Qué más deseas hacer?', [
    { id: 'btn_ver_cat',   title: 'Ver categorías' },
    { id: 'btn_confirmar', title: 'Confirmar pedido' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: `Ofertas mostradas (${ofertas.length})` });
}

// ============================================================
// PRIVADO: mostrarListaDeUltimaCategoria — lista sin imágenes de
// estado.last_categoria_id. Usada por "Otra de [categoría]" y por el
// fallback interno cuando una selección de producto no se pudo resolver.
// ============================================================
async function mostrarListaDeUltimaCategoria(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  if (!estado.last_categoria_id) {
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const { data: productos, error } = await productosPorCategoria(empresa_id, estado.last_categoria_id);
  if (error || !productos || productos.length === 0) {
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  await enviarListaProductosSinImagenes(
    params,
    estado,
    estado.last_categoria_id,
    estado.last_categoria_nombre ?? 'esta categoría',
    productos
  );
}

// ============================================================
// PRIVADO: iniciarAgregarAlPedido
// ============================================================
async function iniciarAgregarAlPedido(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente, textoUsuario } = params;

  // Botón "Agregar" pegado a un producto específico: add_{uuid}
  if (textoUsuario.startsWith('add_')) {
    const productoId = textoUsuario.replace(/^add_/, '');
    await seleccionarProducto(params, estado, productoId);
    return;
  }

  // Botón "Agregar" pegado a una oferta/combo específico: addoferta_{uuid}
  if (textoUsuario.startsWith('addoferta_')) {
    const ofertaId = textoUsuario.replace(/^addoferta_/, '');
    await seleccionarOferta(params, estado, ofertaId);
    return;
  }

  // "Agregar más" tras agregar un producto: muestra el menú de 3 opciones
  // (más del mismo, otra de la misma categoría, otra categoría) en vez de
  // saltar directo a la lista de la última categoría.
  if (textoUsuario === 'btn_agregar_mas') {
    await mostrarMenuAgregarMas(params, estado);
    return;
  }

  // "Más [producto]": agrega 1 unidad más del último producto agregado, sin pedir cantidad
  if (textoUsuario === 'btn_mas_ultimo') {
    await agregarUnidadRapida(params, estado);
    return;
  }

  // "Otra de [categoría]" y el fallback interno tras una selección inválida
  // (ver seleccionarProducto) comparten el mismo comportamiento: lista de
  // texto sin imágenes de la última categoría vista.
  if (textoUsuario === 'btn_otra_de_cat' || textoUsuario === 'btn_agregar') {
    await mostrarListaDeUltimaCategoria(params, estado);
    return;
  }

  // "Otra categoría": menú completo de categorías, igual que el saludo inicial.
  // El carrito no se toca — mostrarCategorias nunca modifica el estado.
  if (textoUsuario === 'btn_otra_categoria') {
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  // Viene de texto libre ("quiero X", "tiene X", "busco X") — buscar por nombre
  const textoBusqueda = textoUsuario.replace(BUSQUEDA_PRODUCTO_REGEX, '').trim();

  if (!textoBusqueda) {
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const { data: productos, error } = await consultarStock(empresa_id, textoBusqueda);

  if (error || !productos || productos.length === 0) {
    const msg = 'No encontré ese producto. ¿Quieres ver todas las categorías?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  await presentarProductoParaCantidad(params, estado, productos[0]);
}

// ============================================================
// PRIVADO: presentarProductoParaCantidad — producto encontrado, pide cantidad
// ============================================================
async function presentarProductoParaCantidad(
  params: ProcesarParams,
  estado: EstadoFlujo,
  p: { id: string; nombre: string; precio_lista: number; stock_disponible: number }
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;

  if (p.stock_disponible === 0) {
    const msg = `Lo siento, *${p.nombre}* está agotado en este momento.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const precioStr = p.precio_lista.toLocaleString('es-CO');
  const msgCant = `¿Cuántas unidades de *${p.nombre}*?\n💰 $${precioStr} c/u`;
  await enviarReplyButtons(whatsapp, msgCant, [
    { id: 'qty_1', title: '1 unidad' },
    { id: 'qty_2', title: '2 unidades' },
    { id: 'qty_3', title: '3 unidades' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msgCant });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_cantidad',
    producto_contexto: {
      tipo: 'producto',
      id: p.id,
      nombre: p.nombre,
      precio: p.precio_lista,
      stock: p.stock_disponible,
    },
  });
}

// ============================================================
// PRIVADO: seleccionarProducto — cuando etapa === 'esperando_producto'
// ============================================================
async function seleccionarProducto(
  params: ProcesarParams,
  estado: EstadoFlujo,
  productoId: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  const rows = await sql`
    SELECT id, nombre, precio_lista, stock_disponible
    FROM productos
    WHERE id = ${productoId}
      AND empresa_id = ${empresa_id}
    LIMIT 1
  `;

  if (!rows.length) {
    const msg = 'No pude identificar ese producto. Vuelve a seleccionar:';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await iniciarAgregarAlPedido({ ...params, textoUsuario: 'btn_agregar' }, estado);
    return;
  }

  const p = rows[0] as { id: string; nombre: string; precio_lista: number; stock_disponible: number };

  if (p.stock_disponible === 0) {
    const msg = `Lo siento, *${p.nombre}* está agotado.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const precio = p.precio_lista.toLocaleString('es-CO');
  const msg = `¿Cuántas unidades de *${p.nombre}*?\n💰 $${precio} c/u`;
  await enviarReplyButtons(whatsapp, msg, [
    { id: 'qty_1', title: '1 unidad' },
    { id: 'qty_2', title: '2 unidades' },
    { id: 'qty_3', title: '3 unidades' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_cantidad',
    producto_contexto: {
      tipo: 'producto',
      id: p.id,
      nombre: p.nombre,
      precio: p.precio_lista,
      stock: p.stock_disponible,
    },
  });
}

// ============================================================
// PRIVADO: seleccionarOferta — cuando el cliente pulsa "Agregar" en una oferta/combo
// ============================================================
async function seleccionarOferta(
  params: ProcesarParams,
  estado: EstadoFlujo,
  ofertaId: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  const { data: oferta, error } = await obtenerOferta(empresa_id, ofertaId);

  if (error || !oferta) {
    const msg = 'No pude identificar esa oferta. Te muestro las disponibles:';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarOfertas(params);
    return;
  }

  const stockCombos = oferta.componentes.length > 0
    ? Math.min(...oferta.componentes.map(c => Math.floor(c.stock_disponible / c.cantidad)))
    : 0;

  if (stockCombos <= 0) {
    const msg = `Lo siento, *${oferta.nombre}* está agotada en este momento.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const precio = oferta.precio_combo.toLocaleString('es-CO');
  const msg = `¿Cuántas unidades de *${oferta.nombre}*?\n💰 $${precio} c/u`;
  await enviarReplyButtons(whatsapp, msg, [
    { id: 'qty_1', title: '1 unidad' },
    { id: 'qty_2', title: '2 unidades' },
    { id: 'qty_3', title: '3 unidades' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_cantidad',
    producto_contexto: {
      tipo: 'oferta',
      id: oferta.id,
      nombre: oferta.nombre,
      precio: oferta.precio_combo,
      stock: stockCombos,
    },
  });
}

// ============================================================
// PRIVADO: manejarCantidad
// ============================================================
async function manejarCantidad(
  params: ProcesarParams,
  estado: EstadoFlujo,
  cantidad: number
): Promise<void> {
  const { whatsapp, conversacion_id } = params;
  const p = estado.producto_contexto!;

  if (cantidad > p.stock) {
    const msg = `Solo tenemos *${p.stock}* unidades de *${p.nombre}* disponibles. ¿Cuántas deseas?`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nuevoItem: CartItem = p.tipo === 'oferta'
    ? { tipo: 'oferta', oferta_id: p.id, nombre: p.nombre, cantidad, precio_unitario: p.precio }
    : { tipo: 'producto', producto_id: p.id, nombre: p.nombre, cantidad, precio_unitario: p.precio };

  await confirmarItemAgregado(params, estado, [...estado.carrito, nuevoItem], p);
}

// ============================================================
// PRIVADO: confirmarItemAgregado — cola común tras agregar un item al
// carrito (desde cantidad manual o desde "Más [producto]"): mensaje de
// confirmación, botones y persistencia del estado, guardando también
// ultimo_producto para que el próximo "Más X" sepa qué repetir.
// ============================================================
async function confirmarItemAgregado(
  params: ProcesarParams,
  estado: EstadoFlujo,
  nuevoCarrito: CartItem[],
  ultimoProducto: ProductoContexto
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;
  const { texto, total } = resumenCarrito(nuevoCarrito);

  const msg = `✅ Agregado. Carrito actual:\n\n${texto}\n\n*Total: $${total.toLocaleString('es-CO')}*`;

  await enviarReplyButtons(whatsapp, msg, [
    { id: 'btn_agregar_mas', title: 'Agregar más' },
    { id: 'btn_confirmar',   title: 'Confirmar pedido' },
    { id: 'btn_cancelar',    title: 'Cancelar' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_confirmacion',
    carrito: nuevoCarrito,
    producto_contexto: undefined,
    ultimo_producto: ultimoProducto,
  });
}

// ============================================================
// PRIVADO: mostrarMenuAgregarMas — menú tras "Agregar más": repetir el
// último producto, ver otra unidad de la misma categoría, o cambiar de
// categoría. El carrito nunca se toca aquí.
// ============================================================
async function mostrarMenuAgregarMas(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  const botones: Array<{ id: string; title: string }> = [];

  if (estado.ultimo_producto) {
    botones.push({ id: 'btn_mas_ultimo', title: `Más ${estado.ultimo_producto.nombre.substring(0, 15)}` });
  }
  if (estado.last_categoria_id && estado.last_categoria_nombre) {
    botones.push({ id: 'btn_otra_de_cat', title: `Otra de ${estado.last_categoria_nombre.substring(0, 15)}` });
  }
  botones.push({ id: 'btn_otra_categoria', title: 'Otra categoría' });

  // Sin producto/categoría previa en el estado (ej. carrito armado al repetir
  // un pedido anterior): no hay nada que "repetir", vamos directo al menú completo.
  if (botones.length === 1) {
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  await enviarReplyButtons(whatsapp, '¿Qué deseas agregar?', botones.slice(0, 3));
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: 'Menú de agregar más' });
}

// ============================================================
// PRIVADO: agregarUnidadRapida — botón "Más [producto]": agrega 1 unidad
// más del último producto/oferta agregado, sin volver a preguntar cantidad.
// ============================================================
async function agregarUnidadRapida(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { whatsapp, conversacion_id } = params;
  const p = estado.ultimo_producto;

  if (!p) {
    await mostrarMenuAgregarMas(params, estado);
    return;
  }

  const yaEnCarrito = estado.carrito
    .filter(i => (p.tipo === 'oferta' ? i.oferta_id === p.id : i.producto_id === p.id))
    .reduce((acc, i) => acc + i.cantidad, 0);

  if (yaEnCarrito + 1 > p.stock) {
    const msg = `Solo tenemos *${p.stock}* unidades de *${p.nombre}* disponibles y ya tienes ${yaEnCarrito} en tu carrito.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nuevoItem: CartItem = p.tipo === 'oferta'
    ? { tipo: 'oferta', oferta_id: p.id, nombre: p.nombre, cantidad: 1, precio_unitario: p.precio }
    : { tipo: 'producto', producto_id: p.id, nombre: p.nombre, cantidad: 1, precio_unitario: p.precio };

  await confirmarItemAgregado(params, estado, [...estado.carrito, nuevoItem], p);
}

// ============================================================
// PRIVADO: resumenCarrito — texto formateado + total, reutilizado por el
// menú de modificar y por las confirmaciones de cambiar/quitar
// ============================================================
function resumenCarrito(carrito: CartItem[]): { texto: string; total: number } {
  const total = carrito.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);
  const texto = carrito
    .map(i => `• ${i.nombre} x${i.cantidad} = $${(i.cantidad * i.precio_unitario).toLocaleString('es-CO')}`)
    .join('\n');
  return { texto, total };
}

// ============================================================
// PRIVADO: mostrarMenuModificar — punto de entrada al presionar "Modificar"
// en el resumen de confirmación. Nunca vacía el carrito; el estado vuelve
// a 'inicio' para que el flujo normal (agregar/confirmar) siga funcionando.
// ============================================================
async function mostrarMenuModificar(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  if (estado.carrito.length === 0) {
    const msg = 'Tu carrito está vacío. ¿Qué deseas pedir?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'inicio' });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const { texto, total } = resumenCarrito(estado.carrito);
  const msg = `Tu pedido actual:\n\n${texto}\n\n*Total: $${total.toLocaleString('es-CO')}*`;

  await enviarReplyButtons(whatsapp, msg, [
    { id: 'btn_agregar_mas',      title: 'Agregar más' },
    { id: 'btn_cambiar_cantidad', title: 'Cambiar cantidad' },
    { id: 'btn_quitar_producto',  title: 'Quitar un producto' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  // Vuelve a 'inicio' con el carrito intacto: al agregar más o confirmar de
  // nuevo, el flujo recalcula todo desde el carrito actual, no desde cero.
  await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'inicio' });
}

// ============================================================
// PRIVADO: iniciarCambiarCantidad — muestra el carrito como lista para elegir
// cuál producto cambiar de cantidad
// ============================================================
async function iniciarCambiarCantidad(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;

  if (estado.carrito.length === 0) {
    const msg = 'Tu carrito está vacío. ¿Qué deseas pedir?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const rows = estado.carrito
    .map((item, i) => ({
      id: `cartidx_${i}`,
      title: item.nombre.substring(0, 24),
      description: `x${item.cantidad} = $${(item.cantidad * item.precio_unitario).toLocaleString('es-CO')}`,
    }))
    .slice(0, 10);

  await enviarListMessage(
    whatsapp,
    '¿Cuál producto quieres cambiar de cantidad?',
    'Seleccionar',
    [{ title: 'Tu pedido', rows }]
  );
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: 'Lista de carrito para cambiar cantidad' });

  await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'esperando_indice_cantidad' });
}

// ============================================================
// PRIVADO: seleccionarIndiceCantidad — etapa "esperando_indice_cantidad"
// ============================================================
async function seleccionarIndiceCantidad(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;

  const match = textoUsuario.match(/^cartidx_(\d+)$/);
  const indice = match ? parseInt(match[1], 10) : NaN;

  if (isNaN(indice) || !estado.carrito[indice]) {
    const msg = 'No reconocí ese producto. Por favor selecciónalo de la lista.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const item = estado.carrito[indice];
  const msg = `¿Cuántas unidades de *${item.nombre}* deseas ahora? (actual: ${item.cantidad})`;
  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_nueva_cantidad',
    modificar_indice: indice,
  });
}

// ============================================================
// PRIVADO: aplicarNuevaCantidad — etapa "esperando_nueva_cantidad"
// ============================================================
async function aplicarNuevaCantidad(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;
  const indice = estado.modificar_indice;

  const cantidad = parseInt(textoUsuario.trim(), 10);

  if (indice === undefined || !estado.carrito[indice]) {
    await mostrarMenuModificar(params, estado);
    return;
  }

  if (isNaN(cantidad) || cantidad <= 0) {
    const msg = 'Por favor escribe un número válido de unidades.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nuevoCarrito = estado.carrito.map((item, i) =>
    i === indice ? { ...item, cantidad } : item
  );
  const { texto, total } = resumenCarrito(nuevoCarrito);
  const msg = `✅ Actualizado. Tu pedido:\n\n${texto}\n\n*Total: $${total.toLocaleString('es-CO')}*`;

  await enviarReplyButtons(whatsapp, msg, [
    { id: 'btn_agregar_mas', title: 'Agregar más' },
    { id: 'btn_confirmar',   title: 'Confirmar pedido' },
    { id: 'btn_cancelar',    title: 'Cancelar' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'inicio',
    carrito: nuevoCarrito,
    modificar_indice: undefined,
  });
}

// ============================================================
// PRIVADO: iniciarQuitarProducto — muestra el carrito como lista para elegir
// cuál producto quitar
// ============================================================
async function iniciarQuitarProducto(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;

  if (estado.carrito.length === 0) {
    const msg = 'Tu carrito está vacío. ¿Qué deseas pedir?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const rows = estado.carrito
    .map((item, i) => ({
      id: `cartidx_${i}`,
      title: item.nombre.substring(0, 24),
      description: `x${item.cantidad} = $${(item.cantidad * item.precio_unitario).toLocaleString('es-CO')}`,
    }))
    .slice(0, 10);

  await enviarListMessage(
    whatsapp,
    '¿Cuál producto quieres quitar del pedido?',
    'Seleccionar',
    [{ title: 'Tu pedido', rows }]
  );
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: 'Lista de carrito para quitar producto' });

  await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'esperando_indice_quitar' });
}

// ============================================================
// PRIVADO: quitarDelCarrito — etapa "esperando_indice_quitar"
// ============================================================
async function quitarDelCarrito(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  const match = textoUsuario.match(/^cartidx_(\d+)$/);
  const indice = match ? parseInt(match[1], 10) : NaN;

  if (isNaN(indice) || !estado.carrito[indice]) {
    const msg = 'No reconocí ese producto. Por favor selecciónalo de la lista.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const eliminado = estado.carrito[indice];
  const nuevoCarrito = estado.carrito.filter((_, i) => i !== indice);

  if (nuevoCarrito.length === 0) {
    const msg = `Quitado *${eliminado.nombre}*. Tu carrito quedó vacío. ¿Qué deseas pedir?`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'inicio', carrito: [] });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const { texto, total } = resumenCarrito(nuevoCarrito);
  const msg = `✅ Quitado *${eliminado.nombre}*. Tu pedido:\n\n${texto}\n\n*Total: $${total.toLocaleString('es-CO')}*`;

  await enviarReplyButtons(whatsapp, msg, [
    { id: 'btn_agregar_mas', title: 'Agregar más' },
    { id: 'btn_confirmar',   title: 'Confirmar pedido' },
    { id: 'btn_cancelar',    title: 'Cancelar' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'inicio',
    carrito: nuevoCarrito,
  });
}

// ============================================================
// PRIVADO: esClienteIncompleto — placeholder creado por crearClienteTemporal
// o sin dirección registrada, necesita datos antes de poder confirmar un pedido
// ============================================================
function esClienteIncompleto(cliente: Cliente): boolean {
  return !cliente.nombre_contacto || cliente.nombre_contacto === 'Cliente nuevo' || !cliente.direccion;
}

// ============================================================
// PRIVADO: confirmarPedido — punto de entrada al presionar "Confirmar pedido"
// ============================================================
async function confirmarPedido(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  if (estado.carrito.length === 0) {
    const msg = 'No tienes productos en el carrito. ¿Qué deseas pedir?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  if (!cliente) {
    const msg = 'Para confirmar un pedido necesito tus datos. Un asesor te contactará pronto.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  // PASO A: cliente nuevo/incompleto — recolectar nombre, dirección y teléfono antes de registrar
  if (esClienteIncompleto(cliente)) {
    const msg = '¿Cuál es tu nombre completo?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'esperando_nombre' });
    return;
  }

  // PASO B: cliente ya registrado — confirmar directamente con resumen del pedido
  await mostrarResumenConfirmacion(params, estado);
}

// ============================================================
// PRIVADO: capturarNombreCliente — etapa "esperando_nombre"
// ============================================================
async function capturarNombreCliente(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;
  const nombre = textoUsuario.trim();

  const palabras = nombre.split(/\s+/).filter(Boolean);
  if (palabras.length < 2) {
    const msg = 'Por favor ingresa un dato válido. ¿Cuál es tu nombre completo?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const msg = '¿Cuál es tu dirección de entrega? (calle, número, barrio)';
  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_direccion',
    datos_cliente_temp: { ...estado.datos_cliente_temp, nombre },
  });
}

// ============================================================
// PRIVADO: capturarDireccionCliente — etapa "esperando_direccion"
// ============================================================
async function capturarDireccionCliente(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;
  const direccion = textoUsuario.trim();

  if (direccion.length < 5) {
    const msg = 'Por favor ingresa un dato válido. ¿Cuál es tu dirección de entrega? (calle, número, barrio)';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const msg = `¿Tu número de contacto es ${whatsapp}? Responde Sí o escribe otro número`;
  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_telefono_confirmacion',
    datos_cliente_temp: { ...estado.datos_cliente_temp, direccion },
  });
}

// ============================================================
// PRIVADO: capturarTelefonoCliente — etapa "esperando_telefono_confirmacion"
// Al confirmar, actualiza clientes y registra el pedido directamente (PASO C)
// ============================================================
async function capturarTelefonoCliente(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  if (!cliente) {
    await mostrarCategorias(empresa_id, null, whatsapp, conversacion_id);
    return;
  }

  const esSi = /^s[ií]\b/i.test(textoUsuario.trim());
  const telefono = esSi ? whatsapp.replace(/^\+/, '') : textoUsuario.replace(/\D/g, '');

  if (!esSi && telefono.length < 7) {
    const msg = 'Ese número no parece válido. Escríbelo de nuevo o responde Sí para usar tu número de WhatsApp.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nombre = estado.datos_cliente_temp?.nombre ?? cliente.nombre_contacto ?? '';
  const direccion = estado.datos_cliente_temp?.direccion ?? '';

  await actualizarDatosCliente(cliente.id, { nombre_contacto: nombre, direccion, telefono });

  const clienteActualizado: Cliente = { ...cliente, nombre_contacto: nombre, direccion, telefono };
  const nuevoEstado: EstadoFlujo = { ...estado, etapa: 'inicio', datos_cliente_temp: undefined };
  await setEstadoFlujo(empresa_id, conversacion_id, nuevoEstado);

  await registrarPedidoFinal({ ...params, cliente: clienteActualizado }, nuevoEstado, true);
}

// ============================================================
// PRIVADO: mostrarResumenConfirmacion — PASO B, cliente ya completo
// ============================================================
async function mostrarResumenConfirmacion(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id } = params;

  const itemsStr = estado.carrito.map(i => `${i.nombre} x${i.cantidad}`).join(', ');
  const total = estado.carrito.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);
  const msg = `¿Confirmas tu pedido de ${itemsStr} por $${total.toLocaleString('es-CO')}? Se entrega en un plazo de 48 horas desde la confirmación.`;

  await enviarReplyButtons(whatsapp, msg, [
    { id: 'btn_confirmar_final', title: 'Sí, confirmar' },
    { id: 'btn_modificar',       title: 'Modificar' },
    { id: 'btn_cancelar',        title: 'Cancelar' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'esperando_confirmacion_final' });
}

// ============================================================
// PRIVADO: registrarPedidoFinal — PASO C, INSERTs + descuento de stock + notificación
// ============================================================
async function registrarPedidoFinal(
  params: ProcesarParams,
  estado: EstadoFlujo,
  esPrimeraVez: boolean = false
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  if (!cliente) {
    const msg = 'Para confirmar un pedido necesito tus datos. Un asesor te contactará pronto.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  if (estado.carrito.length === 0) {
    const msg = 'No tienes productos en el carrito. ¿Qué deseas pedir?';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const items: ItemPedido[] = estado.carrito.map(i => ({
    tipo: i.tipo,
    producto_id: i.producto_id,
    oferta_id: i.oferta_id,
    nombre: i.nombre,
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario,
  }));

  const { data: resultado, error } = await registrarPedido(
    empresa_id,
    cliente.id,
    conversacion_id,
    items,
    undefined,
    cliente.ruta_id ?? null
  );

  if (error || !resultado) {
    const msg = 'Hubo un error al registrar tu pedido. Un asesor lo confirmará manualmente.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    console.error('[agent-core] registrarPedidoFinal error:', error);

    if (process.env.ASESOR_EMAIL) {
      const clienteNombre = cliente.nombre_negocio ?? cliente.nombre_contacto ?? whatsapp;
      await notificarPedidoFallido({
        asesor_email: process.env.ASESOR_EMAIL,
        cliente_nombre: clienteNombre,
        whatsapp,
        error: error ?? 'Error desconocido',
        items: estado.carrito.map(i => ({
          nombre: i.nombre,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
        })),
      }).catch(e => console.error('[agent-core] notificarPedidoFallido error:', e));
    }

    return;
  }

  await actualizarUltimoPedido(cliente.id);
  await setEstadoFlujo(empresa_id, conversacion_id, { etapa: 'inicio', carrito: [] });

  // Pedido confirmado = conversación resuelta: calcula el ISA Score y marca
  // la conversación como 'completada'. No se espera (no bloquea la respuesta
  // al cliente) — igual que las notificaciones por email de más abajo.
  calcularIsaScore(conversacion_id).catch(e => console.error('[agent-core] calcularIsaScore error:', e));

  const idCorto = resultado.pedido_id.substring(0, 8).toUpperCase();
  const msg = esPrimeraVez
    ? `✅ Pedido #${idCorto} registrado. Lo recibirás en un plazo de 48 horas. ¡Gracias!\n\nA partir de ahora te reconoceremos cada vez que escribas desde este número. ¡Bienvenido a Distrisanty!`
    : `✅ Pedido #${idCorto} registrado. Lo recibirás en un plazo de 48 horas. ¡Gracias!`;

  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  if (process.env.ASESOR_EMAIL) {
    const clienteNombre = cliente.nombre_negocio ?? cliente.nombre_contacto ?? whatsapp;
    notificarPedidoNuevo({
      asesor_email: process.env.ASESOR_EMAIL,
      cliente_nombre: clienteNombre,
      pedido_id: resultado.pedido_id,
      total: resultado.total,
      items: estado.carrito.map(i => ({
        nombre: i.nombre,
        cantidad: i.cantidad,
        subtotal: i.cantidad * i.precio_unitario,
      })),
    }).catch(e => console.error('[agent-core] notificarPedidoNuevo error:', e));
  }
}

// ============================================================
// PRIVADO: repetirUltimoPedido
// ============================================================
async function repetirUltimoPedido(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  if (!cliente) {
    await mostrarCategorias(empresa_id, null, whatsapp, conversacion_id);
    return;
  }

  const { data, error } = await ultimoPedido(empresa_id, cliente.id);

  if (error || !data || !data.items.length) {
    const msg = 'Aún no tienes pedidos anteriores. Te muestro el catálogo.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const carritoRepetir: CartItem[] = (data.items as PedidoItemConNombre[]).map(i => ({
    tipo: i.tipo,
    producto_id: i.producto_id,
    oferta_id: i.oferta_id,
    nombre: i.producto_nombre ?? i.nombre_snapshot ?? 'Producto',
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario,
  }));

  const total = carritoRepetir.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);
  const resumenLines = carritoRepetir
    .map(i => `• ${i.nombre} x${i.cantidad} = $${(i.cantidad * i.precio_unitario).toLocaleString('es-CO')}`)
    .join('\n');

  const msg = `Tu último pedido fue:\n\n${resumenLines}\n\n*Total: $${total.toLocaleString('es-CO')}*\n\n¿Confirmas el mismo pedido?`;

  await enviarReplyButtons(whatsapp, msg, [
    { id: 'btn_confirmar_igual', title: 'Confirmar igual' },
    { id: 'btn_modificar',       title: 'Modificar' },
    { id: 'btn_cancelar',        title: 'Cancelar' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_confirm_repetir',
    carrito: carritoRepetir,
  });
}

// ============================================================
// PRIVADO: cancelarFlujo
// ============================================================
async function cancelarFlujo(params: ProcesarParams): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;

  await setEstadoFlujo(empresa_id, conversacion_id, { etapa: 'inicio', carrito: [] });

  const msg = 'Pedido cancelado. ¿Necesitas algo más?';
  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
}

// ============================================================
// PRIVADO: procesarConIA — Claude solo para casos complejos
// ============================================================
async function procesarConIA(
  params: ProcesarParams
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente, intencion, textoUsuario, historial } = params;

  const cacheKey = textoUsuario.toLowerCase().substring(0, 100);
  const cached = await getCached(empresa_id, intencion, cacheKey);
  if (cached) {
    await enviarTexto(whatsapp, cached);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: cached });
    return;
  }

  let contextoSQL = '';

  if (intencion === 'historial' && cliente) {
    const { data } = await historialCliente(empresa_id, cliente.id);
    contextoSQL = data ? JSON.stringify(data) : 'Sin historial de compras.';
  } else if (intencion === 'consulta_stock') {
    const { data } = await consultarStock(empresa_id, textoUsuario);
    contextoSQL = data?.length
      ? JSON.stringify(data)
      : 'Producto no encontrado en inventario.';
  } else if (intencion === 'consulta_pedido' && cliente) {
    const { data } = await ultimoPedido(empresa_id, cliente.id);
    contextoSQL = data ? JSON.stringify(data.pedido) : 'No se encontraron pedidos.';
  } else {
    const [cats, ofs] = await Promise.all([
      obtenerCategorias(empresa_id),
      ofertasParaMostrar(empresa_id),
    ]);
    contextoSQL = JSON.stringify({
      categorias: cats.data ?? [],
      ofertas: ofs.data ?? [],
    });
  }

  const empresaRows = await sql`SELECT nombre FROM empresas WHERE id = ${empresa_id} LIMIT 1`;
  const empresa_nombre = (empresaRows[0]?.nombre as string) ?? 'Distrisanty';

  const systemPrompt = buildSystemPrompt({
    empresa_nombre,
    cliente_nombre: cliente?.nombre_negocio ?? cliente?.nombre_contacto,
    fecha_hoy: new Date().toLocaleDateString('es-CO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  });

  const respuesta = await completarConClaude(systemPrompt, historial, contextoSQL, textoUsuario);

  await enviarTexto(whatsapp, respuesta);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: respuesta });

  if (intencion === 'consulta_stock' || intencion === 'historial') {
    await setCached(empresa_id, intencion, cacheKey, respuesta, 300);
  }
}
