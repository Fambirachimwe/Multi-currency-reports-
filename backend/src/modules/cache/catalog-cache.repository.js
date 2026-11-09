import { CatalogCache } from '../../models/catalog-cache.model.js';
import { logger as defaultLogger } from '../../utils/logger.js';

export const CATALOG_CACHE_SOURCE = 'GAAP_UNITY';
export const CATALOG_CACHE_KEY = 'catalog';

/**
 * MongoDB store for the sales-derived catalog (catalogCache, source GAAP_UNITY, key "catalog").
 * Only normalized fields are stored, never raw sales (they hold commercial data). The derived
 * catalog is fresh or stale by age (incomplete only when the page cap truncated it);
 * `expiresAt` records when a refresh should be suggested.
 *
 * @param {object} options
 * @param {number} options.ttlMs
 * @param {typeof CatalogCache} [options.model]
 * @param {() => Date} [options.now]
 * @param {{ warn: Function }} [options.logger]
 */
export function createCatalogCacheRepository({
  ttlMs,
  model = CatalogCache,
  now = () => new Date(),
  logger = defaultLogger,
}) {
  async function find() {
    const doc = await model
      .findOne({ source: CATALOG_CACHE_SOURCE, key: CATALOG_CACHE_KEY })
      .lean();
    if (doc === null) return null;
    if (!isValidPayload(doc.payload)) {
      logger.warn('Stored catalog payload is invalid and was ignored');
      return null;
    }
    return toStored(doc, now());
  }

  /** @param {import('../gaap/catalog.adapter.js').CatalogResult} result */
  async function save(result) {
    const fetchedAt = new Date(result.fetchedAt);
    const payload = {
      departments: result.departments,
      products: result.products,
      malformed: result.malformed,
      scan: result.scan,
      complete: result.complete,
      incompleteReasons: result.incompleteReasons,
    };
    const doc = await model
      .findOneAndUpdate(
        { source: CATALOG_CACHE_SOURCE, key: CATALOG_CACHE_KEY },
        {
          $set: {
            payload,
            fetchedAt,
            expiresAt: new Date(fetchedAt.getTime() + ttlMs),
            freshness: result.complete ? 'fresh' : 'incomplete',
          },
        },
        { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
      )
      .lean();
    return toStored(doc, now());
  }

  return Object.freeze({ find, save });
}

function toStored(doc, at) {
  const { payload } = doc;
  return {
    departments: payload.departments,
    products: payload.products,
    malformed: payload.malformed,
    scan: payload.scan,
    complete: payload.complete,
    incompleteReasons: payload.incompleteReasons,
    fetchedAt: doc.fetchedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    freshness:
      doc.freshness === 'incomplete' || payload.complete === false
        ? 'incomplete'
        : doc.expiresAt > at
          ? 'fresh'
          : 'stale',
    expired: doc.expiresAt <= at,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidPayload(payload) {
  return (
    isObject(payload) &&
    Array.isArray(payload.departments) &&
    payload.departments.every(
      (d) => isObject(d) && typeof d.id === 'string' && d.id !== '' && Array.isArray(d.warnings),
    ) &&
    Array.isArray(payload.products) &&
    payload.products.every(
      (p) =>
        isObject(p) &&
        typeof p.id === 'string' &&
        p.id !== '' &&
        Array.isArray(p.departmentIds) &&
        typeof p.mapped === 'boolean' &&
        Array.isArray(p.warnings),
    ) &&
    Array.isArray(payload.malformed) &&
    isObject(payload.scan) &&
    payload.scan.source === 'products' &&
    typeof payload.scan.departmentGroup === 'string' &&
    typeof payload.complete === 'boolean' &&
    Array.isArray(payload.incompleteReasons)
  );
}
