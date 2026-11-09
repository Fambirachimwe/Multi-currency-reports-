import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Assigns a request ID for log correlation. A well-formed incoming
 * X-Request-Id is reused; anything else is replaced with a new UUID.
 */
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.set('X-Request-Id', id);
  next();
}
