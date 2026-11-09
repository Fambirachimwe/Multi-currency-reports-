import { NODES_DEFAULT_LIMIT, NODES_MAX_LIMIT } from '../modules/catalog/nodes.service.js';
import { ApiError } from '../utils/api-error.js';
import { toApiError } from '../utils/gaap-api-error.js';
import { sendSuccess } from '../utils/http-response.js';

const ALLOWED_PARAMS = new Set(['limit', 'offset']);

/**
 * Validates `?limit=&offset=`. Strict: unknown, repeated or non-integer values are rejected.
 * @param {Record<string, unknown>} query
 * @returns {{ limit: number, offset: number }}
 * @throws {ApiError} 400 INVALID_QUERY
 */
export function parseNodesQuery(query) {
  for (const name of Object.keys(query)) {
    if (!ALLOWED_PARAMS.has(name)) {
      throw invalid(`Unknown query parameter "${name.slice(0, 40)}".`);
    }
  }
  return {
    limit: parseInteger(query.limit, 'limit', NODES_DEFAULT_LIMIT, 1, NODES_MAX_LIMIT),
    offset: parseInteger(query.offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function parseInteger(raw, name, fallback, min, max) {
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw !== 'string' || !/^\d{1,16}$/.test(raw)) {
    throw invalid(`"${name}" must be a whole number.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw invalid(`"${name}" must be between ${min} and ${max}.`);
  }
  return value;
}

function invalid(message) {
  return new ApiError(400, 'INVALID_QUERY', message);
}

/**
 * @param {{ listNodes: Function, refreshNodes: Function }} nodesService
 * @param {{ refresh?: boolean }} [options] refresh=true calls GAAP and replaces the stored nodes.
 * @returns {import('express').RequestHandler}
 */
export function createListNodesHandler(nodesService, { refresh = false } = {}) {
  return async (req, res) => {
    const { limit, offset } = parseNodesQuery(req.query);
    try {
      const run = refresh ? nodesService.refreshNodes : nodesService.listNodes;
      const { nodes, meta } = await run({ limit, offset, requestId: res.locals.requestId });
      sendSuccess(res, nodes, { meta });
    } catch (error) {
      throw toApiError(error);
    }
  };
}
