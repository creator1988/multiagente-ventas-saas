import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

// Endpoint de diagnóstico — ELIMINAR antes de producción real
export async function GET(): Promise<NextResponse> {
  const info: Record<string, unknown> = {
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? '✓ configurada' : '✗ FALTA',
      EMPRESA_ID_DEFAULT: process.env.EMPRESA_ID_DEFAULT
        ? `✓ "${process.env.EMPRESA_ID_DEFAULT}"`
        : '✗ FALTA (vacía)',
    },
    blob_vars: Object.keys(process.env).filter((k) => k.includes('BLOB')),
  };

  try {
    const sql = getSql();

    // 1. Conexión básica
    const ping = await sql`SELECT 1 AS ok`;
    info.conexion = ping[0]?.ok === 1 ? '✓ OK' : '✗ falló';

    // 2. ¿Existe la tabla productos?
    const tablas = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('productos','categorias','ofertas','oferta_productos','categorias')
      ORDER BY table_name
    `;
    info.tablas_existentes = tablas.map((r) => r.table_name);

    // 3. Columnas de productos
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'productos'
      ORDER BY ordinal_position
    `;
    info.columnas_productos = cols.map((c) => `${c.column_name} (${c.data_type})`);

    // 4. Empresas disponibles (para saber qué UUID usar en EMPRESA_ID_DEFAULT)
    try {
      const empresas = await sql`SELECT id, nombre FROM empresas LIMIT 10`;
      info.empresas = empresas.map((e) => `${e.id} — ${e.nombre}`);
    } catch {
      info.empresas = 'tabla empresas no encontrada o sin columnas id/nombre';
    }

    // 5. Conteo de productos
    const empresa_id = process.env.EMPRESA_ID_DEFAULT ?? '';
    if (empresa_id) {
      const conteo = await sql`
        SELECT COUNT(*) AS total FROM productos WHERE empresa_id = ${empresa_id}
      `;
      info.productos_en_empresa = conteo[0]?.total;
    } else {
      const conteo = await sql`SELECT COUNT(*) AS total FROM productos`;
      info.productos_total_sin_filtro = conteo[0]?.total;
    }
  } catch (err) {
    info.error_db = String(err);
  }

  return NextResponse.json(info, { status: 200 });
}
