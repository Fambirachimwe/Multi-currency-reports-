const DEFAULTS = Object.freeze({
  timeoutMs: 30_000,
  maxConcurrency: 3,
  maxRetries: 2,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 5_000,
  maxResponseBytes: 50 * 1024 * 1024,
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @typedef {object} GaapConfig
 * @property {string} baseUrl GAAP base URL, no trailing slash. Not a secret.
 * @property {string} apiKey Server-side secret. Non-enumerable so serializing
 *   or logging the config cannot print it.
 * @property {number} timeoutMs Per-attempt timeout.
 * @property {number} maxConcurrency Maximum in-flight GAAP requests.
 * @property {number} maxRetries Retries after the first attempt (transient failures only).
 * @property {number} retryBaseDelayMs First backoff delay; doubles per retry.
 * @property {number} retryMaxDelayMs Cap for any single backoff wait.
 * @property {number} maxResponseBytes Largest accepted response body.
 */

/**
 * Reads and validates GAAP configuration. Error messages never contain the key.
 * @param {NodeJS.ProcessEnv} env
 * @returns {GaapConfig}
 */
export function loadGaapConfig(env = process.env) {
  const errors = [];

  const apiKey = env.GAAP_API_KEY?.trim();
  if (!apiKey) {
    errors.push('GAAP_API_KEY is required');
  }

  const baseUrl = parseBaseUrl(env.GAAP_API_BASE_URL, errors);

  const timeoutMs = parseInteger(env, 'GAAP_TIMEOUT_MS', DEFAULTS.timeoutMs, 100, 300_000, errors);
  const maxConcurrency = parseInteger(
    env,
    'GAAP_MAX_CONCURRENCY',
    DEFAULTS.maxConcurrency,
    1,
    20,
    errors,
  );
  const maxRetries = parseInteger(env, 'GAAP_MAX_RETRIES', DEFAULTS.maxRetries, 0, 5, errors);
  const retryBaseDelayMs = parseInteger(
    env,
    'GAAP_RETRY_BASE_DELAY_MS',
    DEFAULTS.retryBaseDelayMs,
    0,
    60_000,
    errors,
  );

  if (errors.length > 0) {
    throw new Error(`Invalid GAAP configuration:\n- ${errors.join('\n- ')}`);
  }

  const config = {
    baseUrl,
    timeoutMs,
    maxConcurrency,
    maxRetries,
    retryBaseDelayMs,
    retryMaxDelayMs: DEFAULTS.retryMaxDelayMs,
    maxResponseBytes: DEFAULTS.maxResponseBytes,
  };
  Object.defineProperty(config, 'apiKey', { value: apiKey, enumerable: false });
  return Object.freeze(config);
}

function parseBaseUrl(raw, errors) {
  const value = raw?.trim();
  if (!value) {
    errors.push('GAAP_API_BASE_URL is required');
    return '';
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push('GAAP_API_BASE_URL must be an absolute URL');
    return '';
  }
  const isHttps = url.protocol === 'https:';
  const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!isHttps && !isLoopbackHttp) {
    errors.push('GAAP_API_BASE_URL must use https (http is allowed only for localhost)');
    return '';
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    errors.push('GAAP_API_BASE_URL must not contain credentials, a query string or a fragment');
    return '';
  }
  return value.replace(/\/+$/, '');
}

function parseInteger(env, name, fallback, min, max, errors) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}
