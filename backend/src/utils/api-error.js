/**
 * An error that is safe to show to API clients. Its code and message are
 * returned verbatim; any other thrown error is reported as a generic 500.
 */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {string} code Stable UPPER_SNAKE_CASE error code.
   * @param {string} message Human-readable, client-safe message.
   * @param {Record<string, unknown>} [details] Optional client-safe data (e.g. offending ids).
   */
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
