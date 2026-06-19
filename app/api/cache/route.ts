import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { invalidarCache } from '@/lib/cache';

const EMPRESA_ID = process.env.EMPRESA_ID_DEFAULT ?? '';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;

  try {
    const rows = await sql`
      SELECT cache_key, ttl_seconds, created_at, expires_at,
             LENGTH(respuesta) AS respuesta_bytes
      FROM cache_respuestas
      WHERE empresa_id = ${empresa_id}
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[cache GET]', error);
    return NextResponse.json({ error: 'Error consultando cache' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id') ?? EMPRESA_ID;
  const patron = searchParams.get('patron') ?? undefined;

  try {
    await invalidarCache(empresa_id, patron);
    return NextResponse.json({ ok: true, mensaje: `Cache limpiado${patron ? ` (patrón: ${patron})` : ''}` });
  } catch (error) {
    console.error('[cache DELETE]', error);
    return NextResponse.json({ error: 'Error limpiando cache' }, { status: 500 });
  }
}
