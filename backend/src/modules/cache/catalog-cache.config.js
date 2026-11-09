import { loadCachePolicy } from './cache-policy.js';

/**
 * Reads CATALOG_CACHE_TTL_HOURS (1-720, default 24), CATALOG_CACHE_REFRESH_POLICY (`manual`
 * default or `on_expiry`) and CATALOG_CACHE_RETRY_COOLDOWN_SECONDS. See `loadCachePolicy`.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ttlMs: number, refreshPolicy: 'manual'|'on_expiry', retryCooldownMs: number }}
 */
export function loadCatalogCacheConfig(env = process.env) {
  return loadCachePolicy('CATALOG', env);
}
