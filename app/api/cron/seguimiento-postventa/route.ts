import { NextRequest, NextResponse } from 'next/server';
import {
  clientesParaSeguimientoDia1,
  clientesParaSeguimientoReposicion,
  enviarSeguimientoPostventa,
} from '@/lib/seguimiento-postventa';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

// Disparado por un workflow externo (cron-job.org, 1 vez al día), igual que
// /api/cron/reactivacion — Vercel Hobby ya tiene sus 2 crons diarios en uso
// (ver vercel.json).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

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
    const [dia1, reposicion] = await Promise.all([
      clientesParaSeguimientoDia1(empresa_id),
      clientesParaSeguimientoReposicion(empresa_id),
    ]);

    const resultados = await Promise.all([
      ...dia1.map(c => enviarSeguimientoPostventa(empresa_id, c, 'satisfaccion')),
      ...reposicion.map(c => enviarSeguimientoPostventa(empresa_id, c, 'reposicion')),
    ]);

    const enviados = resultados.filter(r => r.enviado).length;
    const errores = resultados.filter(r => !r.enviado);

    return NextResponse.json({
      procesados: resultados.length,
      enviados,
      errores,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Error procesando seguimientos post-venta', detalle: String(err) },
      { status: 500 }
    );
  }
}
