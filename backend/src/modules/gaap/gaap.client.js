import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import { logger as defaultLogger } from '../../utils/logger.js';
import { GAAP_ERROR_CODES as CODES, GaapError } from './gaap.errors.js';

/** Methods that are safe to repeat. Anything else needs an explicit `idempotent: true`. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED_PARAM = 'apikey';
const TIMEOUT_AXIOS_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

/**
 * @typedef {object} GaapRequest
 * @property {string} path Endpoint path starting with "/". No query string, no scheme.
 * @property {string} [method] HTTP method. Defaults to GET.
 * @property {Record<string, string|number|boolean|undefined>} [params] Query parameters.
 *   The API key is added by the client and may not be supplied here.
 * @property {unknown} [data] JSON request body.
 * @property {boolean} [idempotent] Declare a non-GET request safe to retry. Default false.
 * @property {AbortSignal} [signal] Cancels the request, including waiting and retries.
 * @property {string} [requestId] Correlation ID copied into log lines.
 *
 * @typedef {object} GaapResponse
 * @property {unknown} data Parsed JSON body (object or array). Untrusted: callers must validate it.
 * @property {number} status
 * @property {number} attempts Attempts used, including the successful one.
 * @property {number} durationMs Total time including retries and backoff.
 */

/**
 * Creates the only object in the backend allowed to talk to GAAP. It is
 * endpoint-agnostic: it knows nothing about nodes, sales or catalogues.
 *
 * Security notes: GAAP takes the key as a query parameter, so URLs are never
 * logged or attached to errors, redirects are not followed (a redirect would
 * forward the key to another host), and absolute URLs in `path` are rejected.
 *
 * @param {object} options
 * @param {import('./gaap.config.js').GaapConfig} options.config
 * @param {{info: Function, warn: Function, error: Function}} [options.logger]
 * @param {Function} [options.adapter] Axios adapter override. Test seam for fixtures.
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep] Backoff wait. Test seam.
 * @param {() => number} [options.random] Jitter source in [0, 1). Test seam.
 */
export function createGaapClient({
  config,
  logger = defaultLogger,
  adapter,
  sleep = abortableSleep,
  random = Math.random,
}) {
  const instance = axios.create({
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRedirects: 0,
    maxContentLength: config.maxResponseBytes,
    maxBodyLength: config.maxResponseBytes,
    headers: { Accept: 'application/json' },
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: config.maxConcurrency }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: config.maxConcurrency }),
    ...(adapter ? { adapter } : {}),
  });
  const gate = createSemaphore(config.maxConcurrency);

  /**
   * Sends one request, retrying transient failures a bounded number of times.
   * @param {GaapRequest} request
   * @returns {Promise<GaapResponse>}
   * @throws {GaapError} Always a GaapError; never an Axios error.
   */
  async function request(req) {
    const method = (req.method ?? 'GET').toUpperCase();
    const { path, requestId, signal } = req;
    const context = { method, path: safePath(path), requestId };

    validateRequest(req, method, context);

    const mayRetry = IDEMPOTENT_METHODS.has(method) || req.idempotent === true;
    const maxAttempts = mayRetry ? config.maxRetries + 1 : 1;
    const startedAt = Date.now();

    for (let attempt = 1; ; attempt += 1) {
      let failure;
      try {
        const response = await sendOnce(req, method, signal);
        const result = {
          data: validateBody(response, context, attempt),
          status: response.status,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
        logger.info('GAAP request succeeded', {
          ...context,
          status: result.status,
          attempts: attempt,
          durationMs: result.durationMs,
        });
        return result;
      } catch (error) {
        failure = toGaapError(error, context, attempt);
      }

      if (!failure.retryable || attempt >= maxAttempts) {
        logger.error('GAAP request failed', {
          ...context,
          code: failure.code,
          status: failure.status,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        });
        throw failure;
      }

      const delayMs = computeDelayMs(attempt, failure, config, random);
      logger.warn('GAAP request will be retried', {
        ...context,
        code: failure.code,
        status: failure.status,
        attempt,
        delayMs,
      });
      try {
        await sleep(delayMs, signal);
      } catch {
        throw abortedError(context, attempt);
      }
    }
  }

  async function sendOnce(req, method, signal) {
    if (signal?.aborted) {
      throw abortedError({ method, path: safePath(req.path) }, 0);
    }
    const release = await gate.acquire();
    try {
      return await instance.request({
        method,
        url: req.path,
        params: { ...cleanParams(req.params), [RESERVED_PARAM]: config.apiKey },
        data: req.data,
        signal,
        responseType: 'json',
      });
    } finally {
      release();
    }
  }

  return Object.freeze({
    request,
    /** Convenience wrapper for GET requests. */
    get: (path, params, options = {}) => request({ ...options, method: 'GET', path, params }),
  });
}

function validateRequest(req, method, context) {
  const reject = (message) =>
    new GaapError({ code: CODES.INVALID_REQUEST, message, ...context, attempts: 0 });

  if (!ALLOWED_METHODS.has(method)) {
    throw reject('Unsupported HTTP method');
  }
  if (!isSafePath(req.path)) {
    throw reject('Path must start with "/" and contain no scheme, host, query string or "..".');
  }
  if (req.params !== undefined) {
    if (typeof req.params !== 'object' || req.params === null || Array.isArray(req.params)) {
      throw reject('Params must be a plain object');
    }
    for (const [key, value] of Object.entries(req.params)) {
      if (key.toLowerCase() === RESERVED_PARAM) {
        throw reject('The API key is added by the client and cannot be passed as a parameter');
      }
      if (value !== undefined && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw reject(`Param "${key}" must be a string, number, boolean or undefined`);
      }
    }
  }
}

function isSafePath(path) {
  return (
    typeof path === 'string' &&
    /^\/(?!\/)[^\s?#\\]*$/.test(path) &&
    !path.includes('://') &&
    !path.split('/').includes('..')
  );
}

/** Only ever log a path that passed validation shape-wise; otherwise log a placeholder. */
function safePath(path) {
  return typeof path === 'string' && isSafePath(path) ? path : '[invalid path]';
}

function cleanParams(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

function validateBody(response, context, attempt) {
  const status = response.status;
  if (status < 200 || status >= 300) {
    // With redirects disabled a 3xx lands here.
    throw new GaapError({
      code: CODES.INVALID_RESPONSE,
      message: `GAAP returned unexpected status ${status}`,
      status,
      ...context,
      attempts: attempt,
    });
  }
  const { data } = response;
  if (typeof data !== 'object' || data === null) {
    throw new GaapError({
      code: CODES.INVALID_RESPONSE,
      message: 'GAAP response was empty or not valid JSON',
      status,
      ...context,
      attempts: attempt,
    });
  }
  return data;
}

/**
 * Maps any thrown value to a GaapError. The Axios error (which holds the
 * request URL and therefore the key) is deliberately dropped here.
 */
function toGaapError(error, context, attempt) {
  if (error instanceof GaapError) {
    return error;
  }
  const base = { ...context, attempts: attempt };

  if (axios.isCancel(error)) {
    return new GaapError({ code: CODES.ABORTED, message: 'GAAP request was cancelled', ...base });
  }
  if (!axios.isAxiosError(error)) {
    return new GaapError({
      code: CODES.NETWORK,
      message: 'Unexpected error while calling GAAP',
      ...base,
    });
  }
  if (error.response) {
    return fromStatus(error.response, base);
  }
  if (TIMEOUT_AXIOS_CODES.has(error.code)) {
    return new GaapError({
      code: CODES.TIMEOUT,
      message: 'GAAP request timed out',
      retryable: true,
      ...base,
    });
  }
  if (/maxContentLength|maxBodyLength/i.test(error.message ?? '')) {
    return new GaapError({
      code: CODES.RESPONSE_TOO_LARGE,
      message: 'GAAP response exceeded the size limit',
      ...base,
    });
  }
  return new GaapError({
    code: CODES.NETWORK,
    message: 'Could not reach GAAP',
    retryable: true,
    ...base,
  });
}

function fromStatus(response, base) {
  const { status } = response;
  const retryAfterMs = parseRetryAfterMs(response.headers?.['retry-after']);
  const make = (code, message, retryable = false) => {
    const err = new GaapError({ code, message, status, retryable, ...base });
    if (retryAfterMs !== undefined) {
      Object.defineProperty(err, 'retryAfterMs', { value: retryAfterMs, enumerable: false });
    }
    return err;
  };

  if (status === 401 || status === 403) {
    return make(CODES.AUTH, 'GAAP rejected the credentials');
  }
  if (status === 404) {
    return make(CODES.NOT_FOUND, 'GAAP resource was not found');
  }
  if (status === 408) {
    return make(CODES.TIMEOUT, 'GAAP reported a request timeout', true);
  }
  if (status === 429) {
    return make(CODES.RATE_LIMITED, 'GAAP rate limit reached', true);
  }
  if (status === 503) {
    return make(CODES.UNAVAILABLE, 'GAAP is temporarily unavailable', true);
  }
  if (status === 502 || status === 504) {
    return make(CODES.UPSTREAM, `GAAP gateway error (${status})`, true);
  }
  if (status >= 500) {
    return make(CODES.UPSTREAM, `GAAP server error (${status})`);
  }
  if (status >= 400) {
    return make(CODES.BAD_REQUEST, `GAAP rejected the request (${status})`);
  }
  return make(CODES.INVALID_RESPONSE, `GAAP returned unexpected status ${status}`);
}

function abortedError(context, attempts) {
  return new GaapError({
    code: CODES.ABORTED,
    message: 'GAAP request was cancelled',
    method: context.method,
    path: context.path,
    attempts,
  });
}

/** Exponential backoff with jitter, honouring Retry-After, always capped. */
function computeDelayMs(attempt, failure, config, random) {
  const exponential = config.retryBaseDelayMs * 2 ** (attempt - 1);
  const jittered = exponential * (0.5 + random() * 0.5);
  const wanted = Math.max(jittered, failure.retryAfterMs ?? 0);
  return Math.round(Math.min(wanted, config.retryMaxDelayMs));
}

function parseRetryAfterMs(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** FIFO counting semaphore bounding concurrent GAAP attempts. */
function createSemaphore(limit) {
  let active = 0;
  const waiting = [];

  const release = () => {
    const next = waiting.shift();
    if (next) {
      next(release);
    } else {
      active -= 1;
    }
  };

  return {
    acquire() {
      if (active < limit) {
        active += 1;
        return Promise.resolve(release);
      }
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
}
