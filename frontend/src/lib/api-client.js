/**
 * Browser client for the application's own Express API (/api/v1).
 *
 * The browser never talks to GAAP Unity or MongoDB directly, and no secret is
 * ever read here: VITE_* variables are bundled into the browser and public.
 *
 * Success envelope: { data, meta }.
 * Error envelope:   { error: { code, message, requestId } }.
 */

export const DEFAULT_API_BASE_URL = '/api/v1';
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Error thrown for every failed API call, with a stable machine-readable code. */
export class ApiClientError extends Error {
  /**
   * @param {object} params
   * @param {string} params.code - Server error code or a client-side code
   *   (NETWORK_ERROR, TIMEOUT, INVALID_RESPONSE, HTTP_ERROR).
   * @param {string} params.message - Safe, user-displayable message.
   * @param {number|null} [params.status] - HTTP status, or null if no response.
   * @param {string|null} [params.requestId] - Server request ID for support.
   * @param {Record<string, unknown>|null} [params.details] - Client-safe extra data (e.g. ids).
   */
  constructor({ code, message, status = null, requestId = null, details = null }) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

function joinUrl(baseUrl, path) {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Returns parsed JSON, null for an empty body, or undefined when unparseable. */
async function readJson(response) {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Create an API client bound to a base URL.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl] - Injected for tests.
 */
export function createApiClient({
  baseUrl = DEFAULT_API_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  /**
   * @param {string} path - Path relative to the base URL, e.g. "/health".
   * @param {object} [options]
   * @param {string} [options.method]
   * @param {unknown} [options.body] - Serialized as JSON when defined.
   * @param {AbortSignal} [options.signal] - Caller cancellation.
   * @returns {Promise<{ data: unknown, meta: object }>}
   */
  async function request(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });

    let response;
    try {
      response = await fetchImpl(joinUrl(baseUrl, path), {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiClientError({
          code: 'TIMEOUT',
          message: 'The server took too long to respond.',
        });
      }
      if (signal?.aborted) throw error;
      throw new ApiClientError({ code: 'NETWORK_ERROR', message: 'Unable to reach the server.' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }

    const payload = await readJson(response);
    const headerRequestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const apiError = payload?.error;
      throw new ApiClientError({
        code: typeof apiError?.code === 'string' ? apiError.code : 'HTTP_ERROR',
        message:
          typeof apiError?.message === 'string'
            ? apiError.message
            : `Request failed with status ${response.status}.`,
        status: response.status,
        requestId: apiError?.requestId ?? headerRequestId,
        details:
          apiError?.details !== null && typeof apiError?.details === 'object'
            ? apiError.details
            : null,
      });
    }

    if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
      throw new ApiClientError({
        code: 'INVALID_RESPONSE',
        message: 'The server returned an unexpected response.',
        status: response.status,
        requestId: headerRequestId,
      });
    }

    return { data: payload.data, meta: payload.meta ?? {} };
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}

/** Shared client configured from the public VITE_API_BASE_URL. */
export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
});
