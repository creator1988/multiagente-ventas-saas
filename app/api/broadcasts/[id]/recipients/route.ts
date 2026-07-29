import { NextRequest, NextResponse } from 'next/server';
import { listarDestinatariosBroadcast, obtenerBroadcast, type KapsoDestinatario } from '@/lib/kapso';

function aCsv(destinatarios: KapsoDestinatario[]): string {
  const encabezados = ['telefono', 'estado', 'enviado_at', 'entregado_at', 'leido_at', 'fallido_at', 'error'];
  const escapar = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const filas = destinatarios.map((d) =>
    [
      d.phone_number,
      d.status,
      d.sent_at ?? '',
      d.delivered_at ?? '',
      d.read_at ?? '',
      d.failed_at ?? '',
      d.error_message ?? '',
    ]
      .map((v) => escapar(String(v)))
      .join(',')
  );
  return [encabezados.join(','), ...filas].join('\n');
}

// ---------------------------------------------------------------------------
// GET /api/broadcasts/[id]/recipients — destinatarios de una transmisión con
// su estado individual. ?status=failed filtra, ?format=csv exporta.
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const format = searchParams.get('format');
  const broadcastId = params.id;

  try {
    const [broadcast, todos] = await Promise.all([
      obtenerBroadcast(broadcastId),
      listarDestinatariosBroadcast(broadcastId),
    ]);

    const destinatarios = status && status !== 'all' ? todos.filter((d) => d.status === status) : todos;

    if (format === 'csv') {
      const csv = aCsv(destinatarios);
      const nombreArchivo = `destinatarios_${broadcast.name.replace(/[^a-zA-Z0-9]/g, '_')}${status ? `_${status}` : ''}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
        },
      });
    }

    return NextResponse.json({ data: destinatarios, broadcast, total: destinatarios.length });
  } catch (error) {
    console.error('[broadcasts/[id]/recipients GET]', error);
    return NextResponse.json({ error: 'Error consultando destinatarios', detalle: String(error) }, { status: 500 });
  }
}
