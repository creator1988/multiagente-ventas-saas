import type { KapsoListMessage } from '@/types';

function getCredentials(): { apiKey: string; phoneNumberId: string } {
  const apiKey = process.env.KAPSO_API_KEY;
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;
  if (!apiKey) throw new Error('KAPSO_API_KEY no está definida');
  if (!phoneNumberId) throw new Error('KAPSO_PHONE_NUMBER_ID no está definida');
  return { apiKey, phoneNumberId };
}

async function kapsoRequest(body: unknown): Promise<unknown> {
  const { apiKey, phoneNumberId } = getCredentials();
  const url = `https://api.kapso.ai/meta/whatsapp/v24.0/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kapso API error ${response.status}: ${error}`);
  }

  return response.json();
}

export async function enviarTexto(to: string, texto: string): Promise<void> {
  await kapsoRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: texto },
  });
}

export async function enviarListMessage(
  to: string,
  body: string,
  botonTexto: string,
  secciones: KapsoListMessage['interactive']['action']['sections'],
  header?: string,
  footer?: string
): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: botonTexto, sections: secciones },
      ...(header && { header: { type: 'text', text: header } }),
      ...(footer && { footer: { text: footer } }),
    },
  };
  await kapsoRequest(payload);
}

export async function enviarReplyButtons(
  to: string,
  body: string,
  botones: Array<{ id: string; title: string }>
): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: botones.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };
  await kapsoRequest(payload);
}

export async function enviarProductoConBoton(
  to: string,
  producto: {
    id: string;
    nombre: string;
    precio_lista: number;
    unidad_medida: string;
    stock_disponible: number;
    url_imagen?: string | null;
  }
): Promise<void> {
  const precio = producto.precio_lista.toLocaleString('es-CO');
  const bodyText = `*${producto.nombre}*\n💰 $${precio} / ${producto.unidad_medida}\n📦 Stock: ${producto.stock_disponible} und`;
  const boton = { type: 'reply', reply: { id: `add_${producto.id}`, title: 'Agregar' } };

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText.substring(0, 1024) },
    action: { buttons: [boton] },
  };

  if (producto.url_imagen) {
    interactive.header = { type: 'image', image: { link: producto.url_imagen } };
  }

  await kapsoRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  });
}

export async function enviarOfertaConBoton(
  to: string,
  oferta: {
    id: string;
    nombre: string;
    descripcion?: string | null;
    precio_combo?: number | null;
    url_imagen?: string | null;
  }
): Promise<void> {
  const precioStr = oferta.precio_combo ? `\n💰 $${oferta.precio_combo.toLocaleString('es-CO')}` : '';
  const bodyText = `*${oferta.nombre}*${oferta.descripcion ? `\n${oferta.descripcion}` : ''}${precioStr}`;
  const boton = { type: 'reply', reply: { id: `addoferta_${oferta.id}`, title: 'Agregar' } };

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText.substring(0, 1024) },
    action: { buttons: [boton] },
  };

  if (oferta.url_imagen) {
    interactive.header = { type: 'image', image: { link: oferta.url_imagen } };
  }

  await kapsoRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  });
}

export async function enviarImagen(
  to: string,
  url: string,
  caption?: string
): Promise<void> {
  await kapsoRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: {
      link: url,
      ...(caption ? { caption: caption.substring(0, 1024) } : {}),
    },
  });
}

// ============================================================
// BROADCASTS (Platform API) — distinta de la Meta Proxy API de arriba:
// otra base URL, mismo header X-API-Key. Referencia: docs.kapso.ai/api/platform/v1/broadcasts
// ============================================================
async function kapsoBroadcastRequest(path: string, method: string, body?: unknown): Promise<unknown> {
  const { apiKey } = getCredentials();
  const url = `https://api.kapso.ai/platform/v1/whatsapp/broadcasts${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kapso Broadcast API error ${response.status}: ${error}`);
  }

  return response.json();
}

export async function crearBroadcast(nombre: string, whatsappTemplateId: string): Promise<{ id: string }> {
  const { phoneNumberId } = getCredentials();
  const json = (await kapsoBroadcastRequest('', 'POST', {
    whatsapp_broadcast: {
      name: nombre,
      phone_number_id: phoneNumberId,
      whatsapp_template_id: whatsappTemplateId,
    },
  })) as { data: { id: string } };
  return { id: json.data.id };
}

// Cada destinatario lleva sus 7 valores en el mismo orden que las variables
// {{1}}..{{7}} de la plantilla. parameter_name se asume posicional ("1".."7")
// porque la plantilla fue creada con placeholders numerados de Meta, no con
// nombres personalizados — si en Kapso la plantilla usa parameter_name
// distintos, ajustar aquí.
export async function agregarDestinatariosBroadcast(
  broadcastId: string,
  destinatarios: Array<{ phone_number: string; parametros: string[] }>
): Promise<{ added: number; duplicates: number; errors: string[] }> {
  const json = (await kapsoBroadcastRequest(`/${broadcastId}/recipients`, 'POST', {
    whatsapp_broadcast: {
      recipients: destinatarios.map((d) => ({
        phone_number: d.phone_number,
        components: [
          {
            type: 'body',
            parameters: d.parametros.map((valor, i) => ({
              type: 'text',
              parameter_name: String(i + 1),
              text: valor,
            })),
          },
        ],
      })),
    },
  })) as { data: { added: number; duplicates: number; errors: string[] } };
  return json.data;
}

export async function enviarBroadcast(broadcastId: string): Promise<{ status: string }> {
  const json = (await kapsoBroadcastRequest(`/${broadcastId}/send`, 'POST')) as { data: { status: string } };
  return { status: json.data.status };
}

export async function descargarMedia(mediaId: string, phoneNumberIdOverride?: string): Promise<Buffer> {
  const { apiKey, phoneNumberId: phoneNumberIdDefault } = getCredentials();
  const phoneNumberId = phoneNumberIdOverride ?? phoneNumberIdDefault;

  const getUrlEndpoint = `https://api.kapso.ai/meta/whatsapp/v24.0/${mediaId}?phone_number_id=${phoneNumberId}`;
  const urlResp = await fetch(getUrlEndpoint, { headers: { 'X-API-Key': apiKey } });

  if (!urlResp.ok) {
    const errBody = await urlResp.text();
    throw new Error(`No se pudo obtener URL del media ${mediaId} (${urlResp.status}): ${errBody}`);
  }

  const { download_url } = (await urlResp.json()) as { download_url: string };

  // download_url es el proxy de Kapso con el token embebido: sin headers.
  const mediaResp = await fetch(download_url);

  if (!mediaResp.ok) {
    const errBody = await mediaResp.text();
    throw new Error(`No se pudo descargar el media ${mediaId} (${mediaResp.status}): ${errBody}`);
  }

  return Buffer.from(await mediaResp.arrayBuffer());
}
