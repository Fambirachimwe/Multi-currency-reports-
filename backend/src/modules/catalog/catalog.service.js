import { createReadThroughCache } from '../cache/read-through-cache.js';
import { logger as defaultLogger } from '../../utils/logger.js';
import { SelectionError } from './node-filters.js';

export const CATALOG_MAX_LIMIT = 1000;
export const CATALOG_DEFAULT_LIMIT = 100;
/** Malformed lines listed in `meta`; the full count is always reported. */
export const CATALOG_MALFORMED_PREVIEW_LIMIT = 50;

/**
 * Catalog service: departments and products derived from sales (see catalog.adapter.js).
 *
 * Reads are served from MongoDB; GAAP is called only when nothing is stored or on an explicit
 * `refreshCatalog`. Concurrent GAAP fetches are merged. A failed refresh keeps the old data.
 * The catalog is always labelled incomplete (`meta.complete === false`).
 *
 * @param {object} options
 * @param {{ fetchCatalog: Function }} options.catalogAdapter
 * @param {{ find: Function, save: Function }} options.repository
 * @param {{ warn: Function, error: Function }} [options.logger]
 */
export function createCatalogService({
  catalogAdapter,
  repository,
  logger = defaultLogger,
  refreshPolicy = 'manual',
  retryCooldownMs,
  now,
}) {
  const cache = createReadThroughCache({
    source: 'GAAP_UNITY',
    key: 'catalog',
    fetch: ({ requestId }) => catalogAdapter.fetchCatalog({ requestId }),
    repository,
    refreshPolicy,
    retryCooldownMs,
    now,
    logger,
  });

  const currentState = (requestId) => cache.read({ requestId });

  /** @param {{ limit: number, offset: number, requestId?: string }} query */
  async function listDepartments({ limit, offset, requestId }) {
    const state = await currentState(requestId);
    return page(state, state.departments, limit, offset);
  }

  /**
   * Products whose observed departments include `departmentId`.
   * @returns {Promise<null | { items: object[], meta: object }>} null when the department is unknown.
   */
  async function listDepartmentProducts({ departmentId, limit, offset, requestId }) {
    const state = await currentState(requestId);
    const department = state.departments.find((d) => d.id === departmentId);
    if (department === undefined) return null;
    const products = state.products.filter((p) => p.departmentIds.includes(departmentId));
    const result = page(state, products, limit, offset);
    result.meta.department = {
      id: department.id,
      name: department.name,
      groupId: department.groupId,
      groupName: department.groupName,
    };
    return result;
  }

  /** Products with no known department. Membership is never guessed. */
  async function listUnmappedProducts({ limit, offset, requestId }) {
    const state = await currentState(requestId);
    return page(
      state,
      state.products.filter((p) => !p.mapped),
      limit,
      offset,
    );
  }

  /**
   * Checks a product selection against the current catalog. Ids that are not selectable
   * products (unknown, or inactive/deleted and so excluded) are an error, never dropped.
   * @returns {Promise<{ items: { productIds: string[] }, meta: object }>} unique ids, sorted.
   * @throws {SelectionError} UNKNOWN_PRODUCT (ids in `unknownIds`) or NO_PRODUCTS
   */
  async function validateProductIds({ productIds, requestId }) {
    const state = await currentState(requestId);
    const known = new Set(state.products.map((p) => p.id));
    const wanted = [...new Set(productIds)].sort(compareIds);
    if (wanted.length === 0) {
      throw new SelectionError('NO_PRODUCTS', 'The selection contains no products.');
    }
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new SelectionError(
        'UNKNOWN_PRODUCT',
        'A selected product is not in the current product list.',
        unknown,
      );
    }
    const { meta } = page(state, wanted, wanted.length, 0);
    return { items: { productIds: wanted }, meta };
  }

  /** Calls GAAP now and replaces the stored catalog. Returns the first departments page. */
  async function refreshCatalog({ limit, offset, requestId }) {
    const state = await cache.refresh({ requestId });
    return page(state, state.departments, limit, offset);
  }

  return Object.freeze({
    listDepartments,
    listDepartmentProducts,
    listUnmappedProducts,
    validateProductIds,
    refreshCatalog,
    cacheStats: cache.stats,
  });
}

function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function page(state, list, limit, offset) {
  const items = list.slice(offset, offset + limit);
  return {
    items,
    meta: {
      source: 'GAAP_UNITY',
      derivation: 'PRODUCTS_ENDPOINT',
      origin: state.origin,
      persisted: state.persisted,
      fetchedAt: state.fetchedAt,
      cacheFreshness: state.freshness,
      cacheExpiresAt: state.expiresAt,
      expired: state.expired,
      // Hit/miss, source, timestamps, policy and any stale fallback reason.
      cache: state.cache,
      // False only when the page cap truncated the product list.
      complete: state.complete,
      incompleteReasons: state.incompleteReasons,
      scan: state.scan,
      total: list.length,
      limit,
      offset,
      returned: items.length,
      departmentCount: state.departments.length,
      productCount: state.products.length,
      unmappedProductCount: state.products.filter((p) => !p.mapped).length,
      malformedCount: state.malformed.length,
      malformed: state.malformed.slice(0, CATALOG_MALFORMED_PREVIEW_LIMIT),
    },
  };
}
