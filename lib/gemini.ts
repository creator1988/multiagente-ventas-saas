import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-2.0-flash';

let _genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está definida');
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

export async function transcribirAudio(
  audioBase64: string,
  mimeType: string = 'audio/ogg'
): Promise<string> {
  const model = getClient().getGenerativeModel({ model: GEMINI_MODEL });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
    'Transcribe exactamente lo que dice este audio de WhatsApp. Solo devuelve el texto transcrito, sin explicaciones adicionales.',
  ]);

  return result.response.text().trim();
}
