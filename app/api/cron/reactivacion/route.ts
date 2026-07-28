import { NextRequest, NextResponse } from 'next/server';
import { conversacionesParaReactivar } from '@/lib/query-cards';
import { reactivarConversacion } from '@/lib/reactivacion';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// Disparado por un workflow externo (GitHub Actions) cada ~10 min, no por
// Vercel Cron: Vercel Hobby solo permite crons diarios y ya hay 2 en uso.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // Soporta tanto el header Authorization (GitHub Actions, curl) como un
  // query param ?secret= (varios servicios de cron gratuitos no permiten
  // configurar headers personalizados en su plan free).
  const authHeader = request.headers.get('authorization');
  const secretParam = searchParams.get('secret');
  const autorizado =
    authHeader === `Bearer ${process.env.CRON_SECRET}` || secretParam === process.env.CRON_SECRET;

  if (!autorizado) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  if (!empresa_id) {
    return NextResponse.json({ error: 'empresa_id no configurado' }, { status: 500 });
  }

  try {
    const conversaciones = await conversacionesParaReactivar(empresa_id);
    const resultados = await Promise.all(conversaciones.map(reactivarConversacion));

    const enviadas = resultados.filter(r => r.enviado).length;
    const errores = resultados.filter(r => !r.enviado);

    return NextResponse.json({
      procesadas: resultados.length,
      enviadas,
      errores,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Error procesando reactivaciones', detalle: String(err) }, { status: 500 });
  }
}
