const DEFAULT_PORT = 4000;
const DEFAULT_CORS_ORIGINS = ['http://localhost:5173'];
const DEFAULT_JSON_BODY_LIMIT = '100kb';
const VALID_NODE_ENVS = ['development', 'test', 'production'];
const BODY_LIMIT_PATTERN = /^\d+(b|kb|mb)$/i;

/**
 * @typedef {object} AppConfig
 * @property {'development'|'test'|'production'} nodeEnv
 * @property {number} port
 * @property {string[]} corsOrigins Exact browser origins allowed by CORS.
 * @property {string} jsonBodyLimit Max JSON request body size, e.g. "100kb".
 */

/**
 * Reads and validates environment configuration. Throws on invalid values so
 * the server fails fast at startup instead of running misconfigured.
 * @param {NodeJS.ProcessEnv} env
 * @returns {AppConfig}
 */
export function loadConfig(env = process.env) {
  const errors = [];

  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  if (!VALID_NODE_ENVS.includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of ${VALID_NODE_ENVS.join(', ')}`);
  }

  const port = parsePort(env.PORT, errors);

  const corsOrigins = parseOrigins(env.CORS_ORIGIN, errors);
  if (corsOrigins === null && nodeEnv === 'production') {
    errors.push('CORS_ORIGIN is required in production');
  }

  const jsonBodyLimit = env.JSON_BODY_LIMIT?.trim() || DEFAULT_JSON_BODY_LIMIT;
  if (!BODY_LIMIT_PATTERN.test(jsonBodyLimit)) {
    errors.push('JSON_BODY_LIMIT must look like "100kb", "1mb" or "512b"');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }

  return Object.freeze({
    nodeEnv,
    port,
    corsOrigins: Object.freeze(corsOrigins ?? DEFAULT_CORS_ORIGINS),
    jsonBodyLimit,
  });
}

function parsePort(raw, errors) {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errors.push('PORT must be an integer between 0 and 65535');
    return DEFAULT_PORT;
  }
  return port;
}

/** Returns null when unset, so callers can tell "unset" apart from "invalid". */
function parseOrigins(raw, errors) {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  for (const origin of origins) {
    if (!isValidOrigin(origin)) {
      errors.push(`CORS_ORIGIN entry "${origin}" must be an http(s) origin with no path`);
    }
  }
  return origins;
}

function isValidOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}
