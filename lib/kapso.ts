import type { KapsoListMessage, KapsoReplyButtons } from '@/types';

const KAPSO_BASE_URL = 'https://api.kapso.io/v1';

async function kapsoRequest(endpoint: string, body: unknown): Promise<unknown> {
  if (!process.env.KAPSO_API_KEY) {
    throw new Error('KAPSO_API_KEY no está definida');
  }

  const response = await fetch(`${KAPSO_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.KAPSO_API_KEY}`,
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
  await kapsoRequest('/messages', {
    type: 'text',
    to,
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
  const payload: KapsoListMessage = {
    type: 'interactive',
    to,
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: botonTexto, sections: secciones },
      ...(header && { header: { type: 'text', text: header } }),
      ...(footer && { footer: { text: footer } }),
    },
  };
  await kapsoRequest('/messages', payload);
}

export async function enviarReplyButtons(
  to: string,
  body: string,
  botones: Array<{ id: string; title: string }>
): Promise<void> {
  const payload: KapsoReplyButtons = {
    type: 'interactive',
    to,
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
  await kapsoRequest('/messages', payload);
}

export async function descargarMedia(mediaId: string): Promise<Buffer> {
  if (!process.env.KAPSO_API_KEY) {
    throw new Error('KAPSO_API_KEY no está definida');
  }

  const urlResp = await fetch(`${KAPSO_BASE_URL}/media/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.KAPSO_API_KEY}` },
  });

  if (!urlResp.ok) throw new Error(`No se pudo obtener URL del media: ${mediaId}`);

  const { url } = (await urlResp.json()) as { url: string };

  const mediaResp = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KAPSO_API_KEY}` },
  });

  if (!mediaResp.ok) throw new Error(`No se pudo descargar el media: ${mediaId}`);

  const arrayBuffer = await mediaResp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
