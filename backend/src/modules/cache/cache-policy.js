export const REFRESH_POLICIES = Object.freeze(['manual', 'on_expiry']);
export const DEFAULT_REFRESH_POLICY = 'manual';
export const DEFAULT_RETRY_COOLDOWN_SECONDS = 30;

/**
 * Reads the TTL and refresh policy for one cache from the environment.
 *
 * - `<PREFIX>_CACHE_TTL_HOURS` integer 1-720, default 24: when stored data counts as expired.
 * - `<PREFIX>_CACHE_REFRESH_POLICY`: `manual` (default; expired data is still served and only an
 *   explicit refresh calls GAAP) or `on_expiry` (a read of expired data refetches, and falls
 *   back to the stored copy, labelled stale, if GAAP fails).
 * - `<PREFIX>_CACHE_RETRY_COOLDOWN_SECONDS` integer 0-3600, default 30: after a failed
 *   `on_expiry` refetch, reads serve the stored copy without calling GAAP again until it passes.
 *
 * Error messages name the variable only, never its value.
 * @param {string} prefix e.g. "NODES"
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [defaultTtlHours]
 * @returns {{ ttlMs: number, refreshPolicy: 'manual'|'on_expiry', retryCooldownMs: number }}
 */
export function loadCachePolicy(prefix, env = process.env, defaultTtlHours = 24) {
  const problems = [];
  const ttlName = `${prefix}_CACHE_TTL_HOURS`;
  const policyName = `${prefix}_CACHE_REFRESH_POLICY`;
  const cooldownName = `${prefix}_CACHE_RETRY_COOLDOWN_SECONDS`;

  let hours = defaultTtlHours;
  if (isSet(env[ttlName])) {
    hours = Number(env[ttlName]);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      problems.push(`${ttlName} must be an integer between 1 and 720`);
    }
  }

  let refreshPolicy = DEFAULT_REFRESH_POLICY;
  if (isSet(env[policyName])) {
    refreshPolicy = env[policyName].trim();
    if (!REFRESH_POLICIES.includes(refreshPolicy)) {
      problems.push(`${policyName} must be one of: ${REFRESH_POLICIES.join(', ')}`);
    }
  }

  let cooldownSeconds = DEFAULT_RETRY_COOLDOWN_SECONDS;
  if (isSet(env[cooldownName])) {
    cooldownSeconds = Number(env[cooldownName]);
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 3600) {
      problems.push(`${cooldownName} must be an integer between 0 and 3600`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid cache configuration:\n- ${problems.join('\n- ')}`);
  }
  return {
    ttlMs: hours * 3_600_000,
    refreshPolicy,
    retryCooldownMs: cooldownSeconds * 1000,
  };
}

function isSet(value) {
  return value !== undefined && value.trim() !== '';
}
