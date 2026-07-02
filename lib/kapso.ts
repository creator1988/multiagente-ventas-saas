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
  console.log('[kapso] Enviando a URL:', url);

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

export async function descargarMedia(mediaId: string): Promise<Buffer> {
  const { apiKey, phoneNumberId } = getCredentials();

  const urlResp = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v24.0/${phoneNumberId}/media/${mediaId}`,
    { headers: { 'X-API-Key': apiKey } }
  );

  if (!urlResp.ok) throw new Error(`No se pudo obtener URL del media: ${mediaId}`);

  const { url } = (await urlResp.json()) as { url: string };

  const mediaResp = await fetch(url, { headers: { 'X-API-Key': apiKey } });

  if (!mediaResp.ok) throw new Error(`No se pudo descargar el media: ${mediaId}`);

  return Buffer.from(await mediaResp.arrayBuffer());
}
