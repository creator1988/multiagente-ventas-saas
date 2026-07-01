const KAPSO_PLATFORM_URL = 'https://api.kapso.ai/platform/v1';

export async function sendMessage(to: string, text: string): Promise<void> {
  const apiKey = process.env.KAPSO_API_KEY;
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;

  if (!apiKey) throw new Error('KAPSO_API_KEY no está definida');
  if (!phoneNumberId) throw new Error('KAPSO_PHONE_NUMBER_ID no está definida');

  const response = await fetch(
    `${KAPSO_PLATFORM_URL}/whatsapp/phone_numbers/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        type: 'text',
        to,
        text: { body: text },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kapso sendMessage error ${response.status}: ${error}`);
  }
}
