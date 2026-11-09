import { sendError } from '../utils/http-response.js';

/** Normalized 404 for any route that no router handled. */
export function notFound(req, res) {
  sendError(res, 404, 'NOT_FOUND', 'The requested resource was not found.');
}
