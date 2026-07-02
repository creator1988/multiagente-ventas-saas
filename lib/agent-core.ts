import type { Cliente, Intencion } from '@/types';
import {
  catalogoPorCategoria,
  ofertasActivas,
  historialCliente,
  consultarStock,
  ultimoPedido,
  guardarMensaje,
} from './query-cards';
import { getCached, setCached } from './cache';
import { completarConClaude } from './claude';
import { buildSystemPrompt } from './agent-prompt';
import { enviarTexto, enviarListMessage, enviarReplyButtons } from './kapso';
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

export async function procesarConClaude(params: ProcesarParams): Promise<void> {
  const {
    empresa_id,
    whatsapp,
    cliente,
    conversacion_id,
    textoUsuario,
    intencion,
    historial,
  } = params;

  // Verificar cache L1+L2 para intenciones cacheables
  const cacheableIntenciones: Intencion[] = ['catalogo', 'consulta_stock'];
  if (cacheableIntenciones.includes(intencion)) {
    const cached = await getCached(empresa_id, intencion, textoUsuario.toLowerCase());
    if (cached) {
      await enviarTexto(whatsapp, cached);
      await guardarMensaje({
        conversacion_id,
        rol: 'agente',
        contenido: cached,
      });
      return;
    }
  }

  // Ejecutar Query Card según intención
  let contextoSQL = '';

  if (intencion === 'catalogo') {
    const { data } = await catalogoPorCategoria(empresa_id);
    contextoSQL = data ? JSON.stringify(data, null, 2) : 'No hay productos disponibles.';
  }

  if (intencion === 'historial' && cliente) {
    const { data } = await historialCliente(empresa_id, cliente.id);
    contextoSQL = data ? JSON.stringify(data, null, 2) : 'Sin historial de compras.';
  }

  if (intencion === 'consulta_stock') {
    const { data } = await consultarStock(empresa_id, textoUsuario);
    contextoSQL = data ? JSON.stringify(data, null, 2) : 'Producto no encontrado.';
  }

  if (intencion === 'consulta_pedido' && cliente) {
    const { data } = await ultimoPedido(empresa_id, cliente.id);
    contextoSQL = data ? JSON.stringify(data, null, 2) : 'No se encontró el pedido.';
  }

  if (intencion === 'pedido' || intencion === 'desconocido') {
    // Para pedidos y consultas generales, proveer catálogo y ofertas como contexto
    const [catalogo, ofertas] = await Promise.all([
      catalogoPorCategoria(empresa_id),
      ofertasActivas(empresa_id),
    ]);
    contextoSQL = JSON.stringify(
      {
        productos_disponibles: catalogo.data ?? [],
        ofertas_activas: ofertas.data ?? [],
        cliente: cliente ?? 'No registrado',
      },
      null,
      2
    );
  }

  // Obtener nombre de empresa
  const empresaRows = await sql`
    SELECT nombre FROM empresas WHERE id = ${empresa_id} LIMIT 1
  `;
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

  // Llamar a Claude
  const respuestaRaw = await completarConClaude(
    systemPrompt,
    historial,
    contextoSQL,
    textoUsuario
  );

  // Parsear respuesta estructurada de Claude
  let respuestaFinal: string;
  try {
    const parsed = JSON.parse(respuestaRaw) as {
      tipo: string;
      body: string;
      boton?: string;
      secciones?: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
      botones?: Array<{ id: string; title: string }>;
    };

    if (parsed.tipo === 'list' && parsed.secciones && parsed.boton) {
      await enviarListMessage(whatsapp, parsed.body, parsed.boton, parsed.secciones);
      respuestaFinal = parsed.body;
    } else if (parsed.tipo === 'buttons' && parsed.botones) {
      await enviarReplyButtons(whatsapp, parsed.body, parsed.botones);
      respuestaFinal = parsed.body;
    } else {
      await enviarTexto(whatsapp, parsed.body ?? respuestaRaw);
      respuestaFinal = parsed.body ?? respuestaRaw;
    }
  } catch {
    // Si Claude no devuelve JSON válido, enviar como texto plano
    await enviarTexto(whatsapp, respuestaRaw);
    respuestaFinal = respuestaRaw;
  }

  // Guardar respuesta del asistente
  await guardarMensaje({
    conversacion_id,
    rol: 'agente',
    contenido: respuestaFinal,
  });

  // Cachear respuestas de catálogo y stock
  if (cacheableIntenciones.includes(intencion)) {
    await setCached(empresa_id, intencion, textoUsuario.toLowerCase(), respuestaFinal, 300);
  }
}
