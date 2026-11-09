import { CATALOG_DEFAULT_LIMIT, CATALOG_MAX_LIMIT } from '../modules/catalog/catalog.service.js';
import { SelectionError } from '../modules/catalog/node-filters.js';
import { ApiError } from '../utils/api-error.js';
import { toApiError } from '../utils/gaap-api-error.js';
import { sendSuccess } from '../utils/http-response.js';

const ALLOWED_PARAMS = new Set(['limit', 'offset']);
const MAX_ID_LENGTH = 200;

/**
 * Validates `?limit=&offset=`. Strict: unknown, repeated or non-integer values are rejected.
 * @param {Record<string, unknown>} query
 * @returns {{ limit: number, offset: number }}
 * @throws {ApiError} 400 INVALID_QUERY
 */
export function parseCatalogQuery(query) {
  for (const name of Object.keys(query)) {
    if (!ALLOWED_PARAMS.has(name)) {
      throw invalid(`Unknown query parameter "${name.slice(0, 40)}".`);
    }
  }
  return {
    limit: parseInteger(query.limit, 'limit', CATALOG_DEFAULT_LIMIT, 1, CATALOG_MAX_LIMIT),
    offset: parseInteger(query.offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** @throws {ApiError} 400 INVALID_DEPARTMENT_ID */
export function parseDepartmentId(raw) {
  if (
    typeof raw !== 'string' ||
    raw.trim() === '' ||
    raw.length > MAX_ID_LENGTH ||
    [...raw].some((char) => char.charCodeAt(0) < 0x20)
  ) {
    throw new ApiError(400, 'INVALID_DEPARTMENT_ID', 'The department id is not valid.');
  }
  return raw;
}

const MAX_SELECTED_PRODUCTS = 5000;

/**
 * Strict body validation for `POST /products/validate`: `{ productIds: string[] }`, non-empty.
 * @returns {string[]}
 * @throws {ApiError} 400 INVALID_SELECTION
 */
export function parseProductSelectionBody(body) {
  const bad = (message) => new ApiError(400, 'INVALID_SELECTION', message);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw bad('A JSON object body is required.');
  }
  for (const key of Object.keys(body)) {
    if (key !== 'productIds') throw bad(`Unknown field "${key.slice(0, 40)}".`);
  }
  const ids = body.productIds;
  if (!Array.isArray(ids) || ids.length > MAX_SELECTED_PRODUCTS) {
    throw bad(`"productIds" must be an array of at most ${MAX_SELECTED_PRODUCTS} ids.`);
  }
  if (ids.length === 0) throw bad('Select at least one product.');
  for (const id of ids) {
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      id.length > MAX_ID_LENGTH ||
      [...id].some((char) => char.charCodeAt(0) < 0x20)
    ) {
      throw bad('"productIds" contains an invalid id.');
    }
  }
  return ids;
}

function parseInteger(raw, name, fallback, min, max) {
  if (raw === undefined) return fallback;
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

/** Wraps a service call that returns `{ items, meta }`, mapping GAAP failures to API errors. */
function handler(run) {
  return async (req, res) => {
    const paging = parseCatalogQuery(req.query);
    try {
      const result = await run({ ...paging, requestId: res.locals.requestId }, req);
      sendSuccess(res, result.items, { meta: result.meta });
    } catch (error) {
      throw toApiError(error);
    }
  };
}

/** @param {{ listDepartments: Function, refreshCatalog: Function, listDepartmentProducts: Function, listUnmappedProducts: Function }} service */
export function createCatalogHandlers(service) {
  return {
    listDepartments: handler((q) => service.listDepartments(q)),
    refresh: handler((q) => service.refreshCatalog(q)),
    listUnmappedProducts: handler((q) => service.listUnmappedProducts(q)),
    validateProducts: async (req, res) => {
      const [first] = Object.keys(req.query);
      if (first !== undefined) throw invalid(`Unknown query parameter "${first.slice(0, 40)}".`);
      const productIds = parseProductSelectionBody(req.body);
      try {
        const result = await service.validateProductIds({
          productIds,
          requestId: res.locals.requestId,
        });
        sendSuccess(res, result.items, { meta: result.meta });
      } catch (error) {
        if (error instanceof SelectionError) {
          throw new ApiError(422, error.code, error.message, { unknownIds: error.unknownIds });
        }
        throw toApiError(error);
      }
    },
    listDepartmentProducts: async (req, res) => {
      const departmentId = parseDepartmentId(req.params.departmentId);
      const paging = parseCatalogQuery(req.query);
      try {
        const result = await service.listDepartmentProducts({
          departmentId,
          ...paging,
          requestId: res.locals.requestId,
        });
        if (result === null) {
          throw new ApiError(404, 'DEPARTMENT_NOT_FOUND', 'No department with that id was found.');
        }
        sendSuccess(res, result.items, { meta: result.meta });
      } catch (error) {
        throw toApiError(error);
      }
    },
  };
}
