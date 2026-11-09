/** Stable, UPPER_SNAKE_CASE codes for every failure the GAAP client can report. */
export const GAAP_ERROR_CODES = Object.freeze({
  TIMEOUT: 'GAAP_TIMEOUT',
  NETWORK: 'GAAP_NETWORK_ERROR',
  RATE_LIMITED: 'GAAP_RATE_LIMITED',
  UNAVAILABLE: 'GAAP_UNAVAILABLE',
  UPSTREAM: 'GAAP_UPSTREAM_ERROR',
  AUTH: 'GAAP_AUTH_ERROR',
  NOT_FOUND: 'GAAP_NOT_FOUND',
  BAD_REQUEST: 'GAAP_BAD_REQUEST',
  INVALID_RESPONSE: 'GAAP_INVALID_RESPONSE',
  RESPONSE_TOO_LARGE: 'GAAP_RESPONSE_TOO_LARGE',
  ABORTED: 'GAAP_ABORTED',
  INVALID_REQUEST: 'GAAP_INVALID_REQUEST',
});

/**
 * The only error type the GAAP client throws. It carries no request URL, query
 * string, headers, response body or originating Axios error, because the API
 * key travels in the query string and would otherwise leak through them.
 */
export class GaapError extends Error {
  /**
   * @param {object} details
   * @param {string} details.code One of {@link GAAP_ERROR_CODES}.
   * @param {string} details.message Safe, human-readable description.
   * @param {number} [details.status] Upstream HTTP status, when a response arrived.
   * @param {boolean} [details.retryable] Whether the failure is transient.
   * @param {number} [details.attempts] Attempts made before giving up.
   * @param {string} [details.method] HTTP method.
   * @param {string} [details.path] Request path without query string.
   */
  constructor({ code, message, status, retryable = false, attempts = 0, method, path }) {
    super(message);
    this.name = 'GaapError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.attempts = attempts;
    this.method = method;
    this.path = path;
  }
}
