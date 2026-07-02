import { enviarTexto } from '@/lib/kapso';

export async function sendMessage(to: string, text: string): Promise<void> {
  await enviarTexto(to, text);
}
