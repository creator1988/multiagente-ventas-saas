import Groq from 'groq-sdk';

let _groq: Groq | null = null;

function getClient(): Groq {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY no está definida');
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const GROQ_MODEL = 'llama-3.1-8b-instant';

export async function responderConGroq(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 512,
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content ?? 'Hola! ¿En qué te puedo ayudar?';
}

// Fallback cuando Claude falla o cuota agotada
export async function fallbackGroq(
  historial: Array<{ rol: 'user' | 'assistant'; contenido: string }>,
  userMessage: string
): Promise<string> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'Eres un asistente de ventas amable. Si no puedes procesar el pedido completo, indícale al cliente que un asesor lo atenderá pronto.',
    },
    ...historial.map((m) => ({
      role: m.rol as 'user' | 'assistant',
      content: m.contenido,
    })),
    { role: 'user', content: userMessage },
  ];

  const completion = await getClient().chat.completions.create({
    model: GROQ_MODEL,
    messages,
    max_tokens: 512,
  });

  return (
    completion.choices[0]?.message?.content ??
    'Gracias por tu mensaje. Un asesor te contactará pronto.'
  );
}
