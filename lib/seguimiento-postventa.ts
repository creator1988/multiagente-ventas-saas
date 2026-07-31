import { getClient, CLAUDE_MODEL } from './claude';
import { sql } from './db';
import { obtenerOCrearConversacion, guardarMensaje } from './query-cards';
import { enviarTexto } from './kapso';

// ============================================================
// SEGUIMIENTO POST-VENTA — a diferencia de conversacionesParaReactivar
// (que reengancha conversaciones abandonadas a medio flujo), este módulo
// contacta proactivamente a clientes que YA compraron, en dos momentos con
// propósito distinto:
//   - día 1 (24-30h después del pedido): confirmar satisfacción/entrega.
//   - día 3-5: ofrecer reposición del mismo pedido.
// Cada pedido dispara su propio ciclo de seguimiento — se trackea en la
// tabla seguimientos_postventa (empresa_id, cliente_id, pedido_id, tipo,
// enviado_at) para no duplicar envíos ni saltarse pasos.
// ============================================================

export type TipoSeguimientoPostventa = 'satisfaccion' | 'reposicion';

export interface ClienteParaSeguimiento {
  cliente_id: string;
  whatsapp: string;
  pedido_id: string;
}

// Ventana de 6h (24-30h / 3-5 días) para tolerar la periodicidad del cron
// externo (cron-job.org, igual que /api/cron/reactivacion) sin depender de
// que corra exactamente a una hora fija.
export async function clientesParaSeguimientoDia1(
  empresa_id: string
): Promise<ClienteParaSeguimiento[]> {
  const rows = await sql`
    SELECT cl.id AS cliente_id, cl.whatsapp, pe.id AS pedido_id
    FROM clientes cl
    JOIN LATERAL (
      SELECT id FROM pedidos
      WHERE cliente_id = cl.id AND empresa_id = cl.empresa_id AND estado != 'cancelado'
      ORDER BY creado_at DESC
      LIMIT 1
    ) pe ON true
    WHERE cl.empresa_id = ${empresa_id}
      AND cl.fecha_ultimo_pedido BETWEEN NOW() - INTERVAL '30 hours' AND NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM seguimientos_postventa sp
        WHERE sp.pedido_id = pe.id AND sp.tipo = 'satisfaccion'
      )
  `;
  return rows as ClienteParaSeguimiento[];
}

export async function clientesParaSeguimientoReposicion(
  empresa_id: string
): Promise<ClienteParaSeguimiento[]> {
  const rows = await sql`
    SELECT cl.id AS cliente_id, cl.whatsapp, pe.id AS pedido_id
    FROM clientes cl
    JOIN LATERAL (
      SELECT id FROM pedidos
      WHERE cliente_id = cl.id AND empresa_id = cl.empresa_id AND estado != 'cancelado'
      ORDER BY creado_at DESC
      LIMIT 1
    ) pe ON true
    WHERE cl.empresa_id = ${empresa_id}
      AND cl.fecha_ultimo_pedido BETWEEN NOW() - INTERVAL '5 days' AND NOW() - INTERVAL '3 days'
      AND EXISTS (
        SELECT 1 FROM seguimientos_postventa sp
        WHERE sp.pedido_id = pe.id AND sp.tipo = 'satisfaccion'
      )
      AND NOT EXISTS (
        SELECT 1 FROM seguimientos_postventa sp2
        WHERE sp2.pedido_id = pe.id AND sp2.tipo = 'reposicion'
      )
  `;
  return rows as ClienteParaSeguimiento[];
}

const PROMPT_SATISFACCION = `Eres un asesor comercial colombiano que hace seguimiento a un cliente que recibió (o está por recibir) su pedido de WhatsApp hace aproximadamente un día.

Con los productos del pedido que se te dan, escribe UN solo mensaje corto (máximo 2 líneas) para:
- Preguntar cómo le fue con el pedido / si llegó todo bien, mencionando el o los productos si ayuda a personalizar.
- Tono cálido y natural, nunca de venta forzada — esto es un check-in, no una oferta.
- Cierra con una pregunta abierta que invite a responder.
- Responde solo con el texto del mensaje, sin comillas ni explicaciones.`;

const PROMPT_REPOSICION = `Eres un asesor comercial colombiano que retoma contacto con un cliente que compró hace unos días (3 a 5 días), para ofrecerle reponer su pedido.

Con los productos del pedido anterior que se te dan, escribe UN solo mensaje corto (máximo 2 líneas) para:
- Sugerir si ya se le están acabando esos productos y le gustaría reponerlos.
- Tono cálido y natural, sin presión ni urgencia artificial.
- Cierra con una pregunta abierta que invite a responder.
- Responde solo con el texto del mensaje, sin comillas ni explicaciones.`;

async function obtenerItemsPedido(pedido_id: string): Promise<string> {
  const items = await sql`
    SELECT nombre_snapshot, cantidad FROM pedido_items WHERE pedido_id = ${pedido_id}
  `;
  return items.map(i => `${i.nombre_snapshot} x${i.cantidad}`).join(', ');
}

async function generarMensajeSeguimiento(
  tipo: TipoSeguimientoPostventa,
  itemsTexto: string
): Promise<string> {
  const systemPrompt = tipo === 'satisfaccion' ? PROMPT_SATISFACCION : PROMPT_REPOSICION;

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Productos del pedido: ${itemsTexto || 'sin detalle'}` }],
  });

  const bloque = response.content[0];
  if (bloque.type !== 'text') throw new Error('Respuesta inesperada de Claude');
  return bloque.text.trim();
}

export interface ResultadoSeguimiento {
  cliente_id: string;
  pedido_id: string;
  tipo: TipoSeguimientoPostventa;
  enviado: boolean;
  error?: string;
}

export async function enviarSeguimientoPostventa(
  empresa_id: string,
  cliente: ClienteParaSeguimiento,
  tipo: TipoSeguimientoPostventa
): Promise<ResultadoSeguimiento> {
  try {
    const itemsTexto = await obtenerItemsPedido(cliente.pedido_id);
    const mensaje = await generarMensajeSeguimiento(tipo, itemsTexto);

    const conversacion_id = await obtenerOCrearConversacion(empresa_id, cliente.cliente_id);

    await enviarTexto(cliente.whatsapp, mensaje);
    await guardarMensaje({ conversacion_id, rol: 'agente', contenido: mensaje });

    await sql`
      INSERT INTO seguimientos_postventa (empresa_id, cliente_id, pedido_id, tipo)
      VALUES (${empresa_id}, ${cliente.cliente_id}, ${cliente.pedido_id}, ${tipo})
    `;

    return { cliente_id: cliente.cliente_id, pedido_id: cliente.pedido_id, tipo, enviado: true };
  } catch (e) {
    return {
      cliente_id: cliente.cliente_id,
      pedido_id: cliente.pedido_id,
      tipo,
      enviado: false,
      error: String(e),
    };
  }
}
