import { NextRequest, NextResponse } from 'next/server';
import { completarConClaude } from '@/lib/claude';
import { buildSystemPrompt } from '@/lib/agent-prompt';
import { identificarCliente } from '@/lib/query-cards';
import { getCached, setCached } from '@/lib/cache';
import { nombreClienteVisible } from '@/lib/cliente-nombre';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// Endpoint de testing: enviar un mensaje al agente directamente (sin webhook)
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as {
    empresa_id?: string;
    whatsapp: string;
    mensaje: string;
    historial?: Array<{ rol: 'user' | 'assistant'; contenido: string }>;
    contexto_sql?: string;
  };

  const empresa_id = body.empresa_id ?? EMPRESA_ID;

  const clienteResult = await identificarCliente(empresa_id, body.whatsapp);
  const cliente = clienteResult.data;

  const cached = await getCached(empresa_id, 'agente_test', body.mensaje.toLowerCase());
  if (cached) {
    return NextResponse.json({ data: { respuesta: cached, cached: true } });
  }

  const systemPrompt = buildSystemPrompt({
    empresa_nombre: 'Distrisanty',
    cliente_nombre: nombreClienteVisible(cliente) ?? undefined,
    fecha_hoy: new Date().toLocaleDateString('es-CO'),
  });

  try {
    const respuesta = await completarConClaude(
      systemPrompt,
      body.historial ?? [],
      body.contexto_sql ?? '',
      body.mensaje
    );

    await setCached(empresa_id, 'agente_test', body.mensaje.toLowerCase(), respuesta, 60);

    return NextResponse.json({ data: { respuesta, cached: false } });
  } catch (error) {
    console.error('[agent POST]', error);
    return NextResponse.json({ error: 'Error en el agente' }, { status: 500 });
  }
}
