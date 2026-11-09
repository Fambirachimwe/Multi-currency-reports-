import { GAAP_ERROR_CODES as CODES, GaapError } from '../modules/gaap/gaap.errors.js';
import { ApiError } from './api-error.js';

/**
 * Maps a GAAP failure to a client-safe ApiError. GAAP authentication failures are
 * reported as a bad gateway, never as 401/403, because the app has no user auth and
 * the problem is server-side configuration. Other errors pass through unchanged.
 * @param {unknown} error
 * @returns {unknown}
 */
export function toApiError(error) {
  if (!(error instanceof GaapError)) {
    return error;
  }
  switch (error.code) {
    case CODES.TIMEOUT:
      return new ApiError(504, 'GAAP_TIMEOUT', 'The sales data service did not respond in time.');
    case CODES.NETWORK:
    case CODES.UNAVAILABLE:
    case CODES.RATE_LIMITED:
      return new ApiError(503, 'GAAP_UNAVAILABLE', 'The sales data service is unavailable.');
    default:
      return new ApiError(502, 'GAAP_UPSTREAM_ERROR', 'The sales data service returned an error.');
  }
}
