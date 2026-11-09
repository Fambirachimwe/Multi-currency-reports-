import { ApiError } from '../utils/api-error.js';
import { sendError } from '../utils/http-response.js';
import { logger } from '../utils/logger.js';

/** Client-safe responses for errors raised by express.json() (body-parser). */
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': [400, 'INVALID_JSON', 'Request body is not valid JSON.'],
  'entity.too.large': [413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'],
  'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING', 'Request body encoding is not supported.'],
  'charset.unsupported': [415, 'UNSUPPORTED_ENCODING', 'Request body encoding is not supported.'],
};

/**
 * Centralized error handler. Returns the standard error envelope and never
 * exposes stack traces or internal error messages to clients.
 * Express recognizes error handlers by their four-argument signature.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }

  const known = BODY_PARSER_ERRORS[err?.type];
  if (known !== undefined) {
    const [status, code, message] = known;
    sendError(res, status, code, message);
    return;
  }

  logger.error('Unhandled request error', {
    requestId: res.locals.requestId,
    method: req.method,
    path: req.path,
    errorName: err?.name,
    errorMessage: err?.message,
    stack: err?.stack,
  });
  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}
