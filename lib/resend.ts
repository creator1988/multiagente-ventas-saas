import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY no está definida');
}

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'noreply@distrisanty.com';

export async function notificarEscalado(params: {
  asesor_email: string;
  cliente_nombre: string;
  whatsapp: string;
  motivo: string;
  conversacion_id: string;
}): Promise<void> {
  await resend.emails.send({
    from: FROM_EMAIL,
    to: params.asesor_email,
    subject: `[Distrisanty] Conversación escalada — ${params.cliente_nombre}`,
    html: `
      <h2>Conversación Escalada</h2>
      <p><strong>Cliente:</strong> ${params.cliente_nombre}</p>
      <p><strong>WhatsApp:</strong> ${params.whatsapp}</p>
      <p><strong>Motivo:</strong> ${params.motivo}</p>
      <p><strong>ID Conversación:</strong> ${params.conversacion_id}</p>
      <p>Por favor atiende al cliente lo antes posible.</p>
    `,
  });
}

export async function notificarPedidoNuevo(params: {
  asesor_email: string;
  cliente_nombre: string;
  pedido_id: string;
  total: number;
  items: Array<{ nombre: string; cantidad: number; subtotal: number }>;
}): Promise<void> {
  const itemsHtml = params.items
    .map(
      (i) =>
        `<tr>
          <td>${i.nombre}</td>
          <td>${i.cantidad}</td>
          <td>$${i.subtotal.toLocaleString('es-CO')}</td>
        </tr>`
    )
    .join('');

  await resend.emails.send({
    from: FROM_EMAIL,
    to: params.asesor_email,
    subject: `[Distrisanty] Nuevo pedido — ${params.cliente_nombre}`,
    html: `
      <h2>Nuevo Pedido #${params.pedido_id}</h2>
      <p><strong>Cliente:</strong> ${params.cliente_nombre}</p>
      <table border="1" cellpadding="6">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p><strong>Total: $${params.total.toLocaleString('es-CO')}</strong></p>
    `,
  });
}
