import { SELECTION_MODES, SelectionError } from '../modules/catalog/node-filters.js';
import { ApiError } from '../utils/api-error.js';
import { toApiError } from '../utils/gaap-api-error.js';
import { sendSuccess } from '../utils/http-response.js';

const MAX_IDS = 1000;
const MAX_ID_LENGTH = 200;
const ALLOWED_KEYS = new Set(['mode', 'brandIds', 'nodeIds']);

function invalid(message) {
  return new ApiError(400, 'INVALID_SELECTION', message);
}

function parseIds(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IDS) {
    throw invalid(`"${name}" must be an array of at most ${MAX_IDS} ids.`);
  }
  for (const id of value) {
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      id.length > MAX_ID_LENGTH ||
      [...id].some((char) => char.charCodeAt(0) < 0x20)
    ) {
      throw invalid(`"${name}" contains an invalid id.`);
    }
  }
  return value;
}

/**
 * Strict body validation for `POST /filters/nodes/resolve`.
 * all: no ids allowed. brands: brandIds required, nodeIds not allowed. nodes: the reverse.
 * @returns {{mode: string, brandIds: string[], nodeIds: string[]}}
 * @throws {ApiError} 400 INVALID_SELECTION
 */
export function parseSelectionBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('A JSON object body is required.');
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw invalid(`Unknown field "${key.slice(0, 40)}".`);
  }
  if (!SELECTION_MODES.includes(body.mode)) {
    throw invalid(`"mode" must be one of: ${SELECTION_MODES.join(', ')}.`);
  }
  const brandIds = parseIds(body.brandIds, 'brandIds');
  const nodeIds = parseIds(body.nodeIds, 'nodeIds');
  if (body.mode !== 'brands' && brandIds.length > 0) {
    throw invalid('"brandIds" is only allowed with mode "brands".');
  }
  if (body.mode !== 'nodes' && nodeIds.length > 0) {
    throw invalid('"nodeIds" is only allowed with mode "nodes".');
  }
  if (body.mode === 'brands' && brandIds.length === 0) throw invalid('Select at least one brand.');
  if (body.mode === 'nodes' && nodeIds.length === 0) throw invalid('Select at least one node.');
  return { mode: body.mode, brandIds, nodeIds };
}

function rejectQuery(query) {
  const [first] = Object.keys(query);
  if (first !== undefined) {
    throw new ApiError(400, 'INVALID_QUERY', `Unknown query parameter "${first.slice(0, 40)}".`);
  }
}

/** @param {{ getOptions: Function, resolveSelection: Function }} service */
export function createNodeFiltersHandlers(service) {
  return {
    getOptions: async (req, res) => {
      rejectQuery(req.query);
      try {
        const { options, meta } = await service.getOptions({ requestId: res.locals.requestId });
        sendSuccess(res, options, { meta });
      } catch (error) {
        throw toApiError(error);
      }
    },
    resolve: async (req, res) => {
      rejectQuery(req.query);
      const selection = parseSelectionBody(req.body);
      try {
        const result = await service.resolveSelection({
          selection,
          requestId: res.locals.requestId,
        });
        sendSuccess(res, result.selection, { meta: result.meta });
      } catch (error) {
        if (error instanceof SelectionError) {
          // Stale or empty selections are the caller's to fix; offending ids are echoed (ids only).
          throw new ApiError(422, error.code, error.message, { unknownIds: error.unknownIds });
        }
        throw toApiError(error);
      }
    },
  };
}
