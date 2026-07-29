import { NextRequest, NextResponse } from 'next/server';
import { listarBroadcasts } from '@/lib/kapso';

// ---------------------------------------------------------------------------
// GET /api/broadcasts/history — transmisiones pasadas (Kapso Platform API),
// para la sección de historial en /dashboard/broadcasts
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') ?? '1');
  const per_page = Number(searchParams.get('per_page') ?? '50');

  try {
    const { data, meta } = await listarBroadcasts({ page, per_page });
    return NextResponse.json({ data, meta });
  } catch (error) {
    console.error('[broadcasts/history GET]', error);
    return NextResponse.json({ error: 'Error consultando historial de transmisiones', detalle: String(error) }, { status: 500 });
  }
}
