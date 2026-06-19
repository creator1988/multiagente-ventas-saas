import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida');
}

export const sql = neon(process.env.DATABASE_URL);

// Helper tipado para queries con empresa_id obligatorio
export async function queryWithCompany<T>(
  query: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const result = await sql(query, ...values);
  return result as T[];
}
