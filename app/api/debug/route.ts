import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sql = getSql();
  const tablas = ['categorias', 'ofertas', 'productos'];
  const result: Record<string, string[]> = {};

  for (const tabla of tablas) {
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tabla}
      ORDER BY ordinal_position
    `;
    result[tabla] = cols.map((c) => `${c.column_name} (${c.data_type})`);
  }

  return NextResponse.json(result);
}
