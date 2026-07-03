import type { Cliente, Intencion, EstadoFlujo, CartItem, PedidoItemConNombre } from '@/types';
import type { ItemPedido } from './query-cards';
import {
  obtenerCategorias,
  productosPorCategoria,
  ofertasParaMostrar,
  consultarStock,
  historialCliente,
  ultimoPedido,
  registrarPedido,
  actualizarUltimoPedido,
  guardarMensaje,
  getEstadoFlujo,
  setEstadoFlujo,
} from './query-cards';
import { completarConClaude } from './claude';
import { buildSystemPrompt } from './agent-prompt';
import { getCached, setCached } from './cache';
import { enviarTexto, enviarListMessage, enviarReplyButtons, enviarImagen } from './kapso';
import { notificarPedidoNuevo } from './resend';
import { sql } from './db';

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

  // PRIORIDAD 2: estado "esperando_producto" — captura cualquier UUID que venga del list_reply
  if (estado.etapa === 'esperando_producto') {
    await seleccionarProducto(params, estado, textoUsuario);
    return;
  }

  // PRIORIDAD 3: estado "esperando_cantidad" — captura texto numérico
  if (estado.etapa === 'esperando_cantidad') {
    const num = parseInt(textoUsuario.trim(), 10);
    if (!isNaN(num) && num > 0) {
      await manejarCantidad(params, estado, num);
      return;
    }
    const msg = `Por favor escribe solo el número de unidades de *${estado.producto_contexto?.nombre ?? 'ese producto'}* que deseas.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  // PRIORIDAD 4: confirmación cuando hay carrito activo
  if (
    intencion === 'confirmar_pedido' &&
    (estado.etapa === 'esperando_confirmacion' || estado.etapa === 'esperando_confirm_repetir')
  ) {
    await confirmarPedido(params, estado);
    return;
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
      await mostrarOfertas(params, estado);
      break;

    case 'pedido':
    case 'agregar_pedido':
      await iniciarAgregarAlPedido(params, estado);
      break;

    case 'confirmar_pedido':
      if (estado.carrito.length > 0) {
        await confirmarPedido(params, estado);
      } else {
        const msg = 'No tienes productos en el carrito. ¿Qué te gustaría pedir?';
        await enviarTexto(whatsapp, msg);
        await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
        await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
      }
      break;

    case 'repetir_pedido':
      await repetirUltimoPedido(params, estado);
      break;

    default:
      await procesarConIA(params, estado);
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
    const msg = 'Por el momento no tenemos el catálogo disponible. Un asesor te atenderá pronto. 🙏';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nombre = cliente?.nombre_negocio ?? cliente?.nombre_contacto;
  const saludo = nombre
    ? `¡Hola ${nombre}! 👋 ¿Qué categoría te interesa hoy?`
    : '¡Hola! 👋 ¿Qué categoría te interesa hoy?';

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
// PRIVADO: mostrarProductosCategoria
// ============================================================
async function mostrarProductosCategoria(
  params: ProcesarParams,
  estado: EstadoFlujo,
  textoUsuario: string
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente } = params;
  const categoria_id = textoUsuario.replace(/^cat_/, '');

  const { data: productos, error } = await productosPorCategoria(empresa_id, categoria_id);

  if (error || !productos || productos.length === 0) {
    const msg = 'No encontré productos en esa categoría con stock disponible. Te muestro las otras opciones.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  for (const p of productos) {
    const precio = p.precio_lista.toLocaleString('es-CO');
    const caption = `*${p.nombre}*\nPrecio: $${precio} / ${p.unidad_medida}\nStock: ${p.stock_disponible} und`;
    if (p.url_imagen) {
      await enviarImagen(whatsapp, p.url_imagen, caption);
    } else {
      await enviarTexto(whatsapp, caption);
    }
  }

  const nuevoEstado: EstadoFlujo = { ...estado, last_categoria_id: categoria_id };
  await setEstadoFlujo(empresa_id, conversacion_id, nuevoEstado);

  await enviarReplyButtons(whatsapp, '¿Qué deseas hacer?', [
    { id: 'btn_agregar',  title: 'Agregar al pedido' },
    { id: 'btn_ver_cat', title: 'Ver otra categoría' },
    { id: 'btn_ofertas', title: 'Ver ofertas' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: `Productos de categoría mostrados (${productos.length} items)` });
}

// ============================================================
// PRIVADO: mostrarOfertas
// ============================================================
async function mostrarOfertas(
  params: ProcesarParams,
  _estado: EstadoFlujo
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
    const precioStr = o.precio_combo ? `\n💰 Precio combo: $${o.precio_combo.toLocaleString('es-CO')}` : '';
    const caption = `*${o.nombre}*${o.descripcion ? `\n${o.descripcion}` : ''}${precioStr}`;
    if (o.url_imagen) {
      await enviarImagen(whatsapp, o.url_imagen, caption);
    } else {
      await enviarTexto(whatsapp, caption);
    }
  }

  await enviarReplyButtons(whatsapp, '¿Qué deseas hacer?', [
    { id: 'btn_agregar', title: 'Agregar al pedido' },
    { id: 'btn_ver_cat', title: 'Ver categorías' },
  ]);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: 'Ofertas mostradas' });
}

// ============================================================
// PRIVADO: iniciarAgregarAlPedido
// ============================================================
async function iniciarAgregarAlPedido(
  params: ProcesarParams,
  estado: EstadoFlujo
): Promise<void> {
  const { empresa_id, whatsapp, conversacion_id, cliente, textoUsuario } = params;

  const esBtnAgregar = textoUsuario === 'btn_agregar' || textoUsuario === 'btn_agregar_mas';

  if (esBtnAgregar) {
    if (!estado.last_categoria_id) {
      const msg = '¿De qué categoría quieres agregar productos?';
      await enviarTexto(whatsapp, msg);
      await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
      await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
      return;
    }

    const { data: productos, error } = await productosPorCategoria(empresa_id, estado.last_categoria_id);
    if (error || !productos || productos.length === 0) {
      await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
      return;
    }

    const rows = productos.slice(0, 10).map(p => ({
      id: p.id,
      title: p.nombre.substring(0, 24),
      description: `$${p.precio_lista.toLocaleString('es-CO')} | Stock: ${p.stock_disponible}`,
    }));

    await enviarListMessage(
      whatsapp,
      '¿Cuál producto deseas agregar?',
      'Seleccionar',
      [{ title: 'Productos disponibles', rows }]
    );
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: 'Lista de selección de productos' });

    await setEstadoFlujo(empresa_id, conversacion_id, { ...estado, etapa: 'esperando_producto' });
    return;
  }

  // Viene de texto "quiero X" — buscar por nombre
  const textoBusqueda = textoUsuario
    .replace(/^(quiero|necesito|me\s*das?|dame|pídeme|ponme|comprar?\s+|llevar?\s+)\s*/i, '')
    .trim();

  if (!textoBusqueda) {
    await mostrarCategorias(empresa_id, cliente, whatsapp, conversacion_id);
    return;
  }

  const { data: productos, error } = await consultarStock(empresa_id, textoBusqueda);

  if (error || !productos || productos.length === 0) {
    const msg = `No encontré "${textoBusqueda}". ¿Puedes describir mejor el producto?`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const p = productos[0];
  if (p.stock_disponible === 0) {
    const msg = `Lo siento, *${p.nombre}* está agotado en este momento.`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const msg = `¿Cuántas unidades de *${p.nombre}* ($${p.precio_lista.toLocaleString('es-CO')} c/u) deseas?`;
  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_cantidad',
    producto_contexto: {
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

  const msg = `¿Cuántas unidades de *${p.nombre}* ($${p.precio_lista.toLocaleString('es-CO')} c/u) deseas?`;
  await enviarTexto(whatsapp, msg);
  await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });

  await setEstadoFlujo(empresa_id, conversacion_id, {
    ...estado,
    etapa: 'esperando_cantidad',
    producto_contexto: {
      id: p.id,
      nombre: p.nombre,
      precio: p.precio_lista,
      stock: p.stock_disponible,
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
  const { empresa_id, whatsapp, conversacion_id } = params;
  const p = estado.producto_contexto!;

  if (cantidad > p.stock) {
    const msg = `Solo tenemos *${p.stock}* unidades de *${p.nombre}* disponibles. ¿Cuántas deseas?`;
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    return;
  }

  const nuevoItem: CartItem = {
    producto_id: p.id,
    nombre: p.nombre,
    cantidad,
    precio_unitario: p.precio,
  };

  const nuevoCarrito = [...estado.carrito, nuevoItem];
  const total = nuevoCarrito.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);

  const resumenLines = nuevoCarrito
    .map(i => `• ${i.nombre} x${i.cantidad} = $${(i.cantidad * i.precio_unitario).toLocaleString('es-CO')}`)
    .join('\n');

  const msg = `✅ Agregado. Carrito actual:\n\n${resumenLines}\n\n*Total: $${total.toLocaleString('es-CO')}*`;

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
  });
}

// ============================================================
// PRIVADO: confirmarPedido
// ============================================================
async function confirmarPedido(
  params: ProcesarParams,
  estado: EstadoFlujo
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
    producto_id: i.producto_id,
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario,
  }));

  const { data: resultado, error } = await registrarPedido(
    empresa_id,
    cliente.id,
    conversacion_id,
    items
  );

  if (error || !resultado) {
    const msg = 'Hubo un error al registrar tu pedido. Un asesor lo confirmará manualmente.';
    await enviarTexto(whatsapp, msg);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: msg });
    console.error('[agent-core] confirmarPedido error:', error);
    return;
  }

  await actualizarUltimoPedido(cliente.id);
  await setEstadoFlujo(empresa_id, conversacion_id, { etapa: 'inicio', carrito: [] });

  const idCorto = resultado.pedido_id.substring(0, 8).toUpperCase();
  const totalStr = resultado.total.toLocaleString('es-CO');
  const msg = `✅ Pedido #${idCorto} confirmado por $${totalStr}. Tu asesor coordinará la entrega. ¡Gracias! 🙌`;

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
    producto_id: i.producto_id,
    nombre: i.producto_nombre ?? 'Producto',
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
  params: ProcesarParams,
  _estado: EstadoFlujo
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
