import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

type SqlFn = NeonQueryFunction<false, false>;

let _sql: SqlFn | null = null;

export function getSql(): SqlFn {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida');
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

export const sql: SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  getSql()(strings, ...values)) as SqlFn;

export async function queryWithCompany<T>(
  query: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const result = await getSql()(query, ...values);
  return result as T[];
}
