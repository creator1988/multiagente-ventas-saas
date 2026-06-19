// ============================================================
// ENTIDADES DE BASE DE DATOS
// ============================================================

export interface Empresa {
  id: string;
  nombre: string;
  nit: string;
  whatsapp_numero: string;
  kapso_token: string;
  activa: boolean;
  created_at: Date;
}

export interface Cliente {
  id: string;
  empresa_id: string;
  nombre: string;
  whatsapp: string;
  email?: string;
  ruta_id?: string;
  credito_disponible: number;
  activo: boolean;
  created_at: Date;
}

export interface Categoria {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion?: string;
  imagen_url?: string;
  activa: boolean;
}

export interface Producto {
  id: string;
  empresa_id: string;
  categoria_id: string;
  nombre: string;
  descripcion?: string;
  precio_base: number;
  unidad: string;
  stock_disponible: number;
  imagen_url?: string;
  activo: boolean;
}

export interface Oferta {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion?: string;
  descuento_porcentaje: number;
  fecha_inicio: Date;
  fecha_fin: Date;
  activa: boolean;
}

export interface Pedido {
  id: string;
  empresa_id: string;
  cliente_id: string;
  conversacion_id?: string;
  estado: 'pendiente' | 'confirmado' | 'en_preparacion' | 'despachado' | 'entregado' | 'cancelado';
  total: number;
  notas?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Conversacion {
  id: string;
  empresa_id: string;
  cliente_id?: string;
  whatsapp_numero: string;
  estado: 'activa' | 'completada' | 'escalada';
  isa_score?: number;
  iniciada_at: Date;
  finalizada_at?: Date;
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  empresa_id: string;
  rol: 'user' | 'assistant' | 'system';
  contenido: string;
  tipo: 'text' | 'audio' | 'image' | 'list' | 'buttons' | 'product';
  kapso_message_id?: string;
  created_at: Date;
}

export interface CacheRespuesta {
  id: string;
  empresa_id: string;
  cache_key: string;
  respuesta: string;
  ttl_seconds: number;
  created_at: Date;
  expires_at: Date;
}

// ============================================================
// VISTAS (Views de Neon DB)
// ============================================================

export interface VPedidoHoy {
  pedido_id: string;
  cliente_nombre: string;
  whatsapp: string;
  estado: string;
  total: number;
  items_count: number;
  created_at: Date;
}

export interface VClienteInactivo {
  cliente_id: string;
  nombre: string;
  whatsapp: string;
  ultimo_pedido: Date;
  dias_sin_comprar: number;
}

export interface VTopProductoCliente {
  cliente_id: string;
  producto_id: string;
  producto_nombre: string;
  categoria_nombre: string;
  total_pedidos: number;
  ultima_compra: Date;
}

export interface VOfertaActiva {
  oferta_id: string;
  nombre: string;
  descripcion?: string;
  descuento_porcentaje: number;
  productos: Array<{
    producto_id: string;
    nombre: string;
    precio_base: number;
    precio_oferta: number;
  }>;
  fecha_fin: Date;
}

// ============================================================
// KAPSO / WHATSAPP
// ============================================================

export interface KapsoWebhookPayload {
  event: 'message' | 'status' | 'read';
  empresa_id?: string;
  message?: {
    id: string;
    from: string;
    type: 'text' | 'audio' | 'image' | 'interactive' | 'button';
    timestamp: number;
    text?: { body: string };
    audio?: { id: string; mime_type: string };
    image?: { id: string; caption?: string };
    interactive?: {
      type: 'list_reply' | 'button_reply';
      list_reply?: { id: string; title: string };
      button_reply?: { id: string; title: string };
    };
  };
  status?: {
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    recipient_id: string;
  };
}

export interface KapsoTextMessage {
  type: 'text';
  to: string;
  text: { body: string };
}

export interface KapsoListMessage {
  type: 'interactive';
  to: string;
  interactive: {
    type: 'list';
    header?: { type: 'text'; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
}

export interface KapsoReplyButtons {
  type: 'interactive';
  to: string;
  interactive: {
    type: 'button';
    body: { text: string };
    action: {
      buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
    };
  };
}

export type KapsoMessage = KapsoTextMessage | KapsoListMessage | KapsoReplyButtons;

// ============================================================
// AGENTE
// ============================================================

export type Intencion =
  | 'saludo'
  | 'catalogo'
  | 'historial'
  | 'pedido'
  | 'consulta_stock'
  | 'consulta_pedido'
  | 'audio'
  | 'desconocido';

export interface ContextoCliente {
  cliente: Cliente | null;
  conversacion_id: string;
  empresa_id: string;
  whatsapp: string;
  historial_mensajes: Array<{ rol: 'user' | 'assistant'; contenido: string }>;
}

export interface QueryCardResult<T = unknown> {
  data: T | null;
  error: string | null;
  cached: boolean;
}

export interface AgentResponse {
  mensaje: KapsoMessage;
  intencion: Intencion;
  pedido_creado?: string;
  isa_score?: number;
  escalado: boolean;
}

export interface ISAScoreResult {
  conversacion_id: string;
  score: number;
  criterios: {
    saludo_apropiado: boolean;
    productos_ofrecidos: boolean;
    pedido_completado: boolean;
    tiempo_respuesta_ok: boolean;
    cliente_satisfecho: boolean;
  };
  observaciones: string;
}
