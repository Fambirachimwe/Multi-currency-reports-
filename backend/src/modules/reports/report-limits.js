/**
 * Workload caps for one report request. ALL DEFAULTS ARE PROVISIONAL: no approved values exist yet
 * (architecture.md lists the maximum date range as an open decision). Override with environment
 * variables; invalid values abort startup so a typo cannot silently lift a cap.
 *
 * The product and node id caps are also bounded by JSON_BODY_LIMIT (default 100kb): about 2000
 * 24-character product ids plus 1000 node ids fit; raise the body limit before raising these.
 */
export const DEFAULT_REPORT_LIMITS = Object.freeze({
  maxRangeDays: 92,
  maxProducts: 2000,
  maxNodes: 1000,
  /** Resolved nodes x inclusive days: a proxy for how much GAAP data one request may pull. */
  maxNodeDays: 50_000,
});

const ENV_NAMES = Object.freeze({
  maxRangeDays: 'REPORT_MAX_RANGE_DAYS',
  maxProducts: 'REPORT_MAX_PRODUCTS',
  maxNodes: 'REPORT_MAX_NODES',
  maxNodeDays: 'REPORT_MAX_NODE_DAYS',
});

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Readonly<typeof DEFAULT_REPORT_LIMITS>}
 * @throws {Error} naming the variable, never its value
 */
export function loadReportLimits(env = process.env) {
  const limits = { ...DEFAULT_REPORT_LIMITS };
  const errors = [];
  for (const [key, name] of Object.entries(ENV_NAMES)) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') continue;
    const trimmed = raw.trim();
    const value = Number(trimmed);
    if (!/^\d{1,9}$/.test(trimmed) || !Number.isSafeInteger(value) || value < 1) {
      errors.push(`${name} must be a whole number of at least 1`);
    } else {
      limits[key] = value;
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid report limits:\n- ${errors.join('\n- ')}`);
  }
  return Object.freeze(limits);
}
