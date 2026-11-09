import cors from 'cors';
import { ApiError } from '../utils/api-error.js';

/**
 * CORS restricted to an explicit allowlist of browser origins.
 * Requests without an Origin header (same-origin, curl, health checks) pass.
 * @param {readonly string[]} allowedOrigins
 */
export function corsAllowlist(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin(origin, callback) {
      if (origin === undefined || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new ApiError(403, 'CORS_ORIGIN_NOT_ALLOWED', 'Origin is not allowed.'));
    },
  });
}
