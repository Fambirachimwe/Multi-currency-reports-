/**
 * Sends the standard success envelope: { data, meta }.
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {{ status?: number, meta?: Record<string, unknown> }} [options]
 */
export function sendSuccess(res, data, { status = 200, meta = {} } = {}) {
  res.status(status).json({ data, meta });
}

/**
 * Sends the standard error envelope: { error: { code, message, requestId } }.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details] Optional client-safe extra data.
 */
export function sendError(res, status, code, message, details = undefined) {
  res.status(status).json({
    error: {
      code,
      message,
      requestId: res.locals.requestId ?? null,
      ...(details !== undefined ? { details } : {}),
    },
  });
}
