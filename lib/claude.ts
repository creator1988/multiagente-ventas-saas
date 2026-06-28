import Anthropic from '@anthropic-ai/sdk';

let _anthropic: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no está definida');
  }
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

export const CLAUDE_MODEL = 'claude-sonnet-4-6';
export const MAX_TOKENS = 1024;

export interface ClaudeMessage {
  rol: 'user' | 'assistant';
  contenido: string;
}

export async function completarConClaude(
  systemPrompt: string,
  historial: ClaudeMessage[],
  contextoSQL: string,
  userMessage: string
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...historial.map((m) => ({
      role: m.rol as 'user' | 'assistant',
      content: m.contenido,
    })),
    {
      role: 'user',
      content: `CONTEXTO DE BASE DE DATOS:\n${contextoSQL}\n\nMENSAJE DEL CLIENTE:\n${userMessage}`,
    },
  ];

  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

  const bloque = response.content[0];
  if (bloque.type !== 'text') throw new Error('Respuesta inesperada de Claude');
  return bloque.text;
}
