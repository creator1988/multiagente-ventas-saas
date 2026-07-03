import { sql } from './db';

// Cache L1: en memoria RAM (se reinicia con cada deploy en Vercel)
const cacheL1 = new Map<string, { valor: string; expira: number }>();

const TTL_DEFAULT = 300; // 5 minutos en segundos

function buildKey(empresa_id: string, intencion: string, parametros: string): string {
  return `${empresa_id}:${intencion}:${parametros}`;
}

export async function getCached(
  empresa_id: string,
  intencion: string,
  parametros: string
): Promise<string | null> {
  const key = buildKey(empresa_id, intencion, parametros);

  // L1: RAM
  const l1 = cacheL1.get(key);
  if (l1 && l1.expira > Date.now()) {
    return l1.valor;
  }
  cacheL1.delete(key);

  // L2: Neon DB
  try {
    const rows = await sql`
      SELECT respuesta FROM cache_respuestas
      WHERE empresa_id = ${empresa_id}
        AND clave = ${key}
        AND expira_at > NOW()
      LIMIT 1
    `;

    if (rows.length > 0) {
      const valor = rows[0].respuesta as string;
      cacheL1.set(key, { valor, expira: Date.now() + TTL_DEFAULT * 1000 });
      return valor;
    }
  } catch (e) {
    console.error('[cache] L2 getCached error:', e);
  }

  return null;
}

export async function setCached(
  empresa_id: string,
  intencion: string,
  parametros: string,
  respuesta: string,
  ttlSeconds: number = TTL_DEFAULT
): Promise<void> {
  const key = buildKey(empresa_id, intencion, parametros);

  // Guardar en L1 siempre
  cacheL1.set(key, { valor: respuesta, expira: Date.now() + ttlSeconds * 1000 });

  // L2: fire-and-forget — no bloquea la respuesta al usuario
  sql`
    INSERT INTO cache_respuestas (empresa_id, clave, respuesta, expira_at)
    VALUES (
      ${empresa_id},
      ${key},
      ${respuesta},
      NOW() + (${ttlSeconds} * INTERVAL '1 second')
    )
    ON CONFLICT (empresa_id, clave)
    DO UPDATE SET
      respuesta = EXCLUDED.respuesta,
      expira_at = EXCLUDED.expira_at,
      hits      = cache_respuestas.hits + 1,
      creado_at = NOW()
  `.catch(e => console.error('[cache] L2 setCached error:', e));
}

export async function invalidarCache(empresa_id: string, patron?: string): Promise<void> {
  // Limpiar L1
  for (const key of Array.from(cacheL1.keys())) {
    if (key.startsWith(empresa_id) && (!patron || key.includes(patron))) {
      cacheL1.delete(key);
    }
  }

  // L2: fire-and-forget
  const query = patron
    ? sql`DELETE FROM cache_respuestas WHERE empresa_id = ${empresa_id} AND clave LIKE ${'%' + patron + '%'}`
    : sql`DELETE FROM cache_respuestas WHERE empresa_id = ${empresa_id}`;

  query.catch(e => console.error('[cache] L2 invalidarCache error:', e));
}
