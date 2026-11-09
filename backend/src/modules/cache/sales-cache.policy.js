export const SALES_CACHE_BLOCKER =
  'Sales caching is disabled until completeness, invalidation and reconciliation rules are approved by the owner.';

/**
 * Sales cache policy. Sales data is never cached in v1: the rules that would make a cached
 * sales page safe to reuse (completeness, invalidation, reconciliation) are not approved.
 * Setting SALES_CACHE_ENABLED to anything but empty/"false" aborts startup rather than
 * silently enabling an unapproved cache.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ enabled: false, reason: string }}
 */
export function loadSalesCachePolicy(env = process.env) {
  const raw = env.SALES_CACHE_ENABLED;
  if (raw !== undefined && raw.trim() !== '' && raw.trim().toLowerCase() !== 'false') {
    throw new Error(
      `Invalid cache configuration:\n- SALES_CACHE_ENABLED is not allowed. ${SALES_CACHE_BLOCKER}`,
    );
  }
  return Object.freeze({ enabled: false, reason: SALES_CACHE_BLOCKER });
}
