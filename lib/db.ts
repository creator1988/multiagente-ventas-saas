import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

let _sql: ReturnType<typeof neon> | null = null;

function getSql(): ReturnType<typeof neon> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida');
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  getSql()(strings, ...values)) as ReturnType<typeof neon>;

export async function queryWithCompany<T>(
  query: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const result = await getSql()(query, ...values);
  return result as T[];
}
