import { CatalogCache } from '../../models/catalog-cache.model.js';
import { logger as defaultLogger } from '../../utils/logger.js';

export const NODES_CACHE_SOURCE = 'GAAP_UNITY';
export const NODES_CACHE_KEY = 'nodes';

/**
 * @typedef {object} StoredNodes
 * @property {import('../gaap/nodes.adapter.js').GaapNode[]} nodes
 * @property {import('../gaap/nodes.adapter.js').MalformedNode[]} malformed
 * @property {number} rawCount
 * @property {number|null} upstreamTotal
 * @property {boolean} complete
 * @property {string} fetchedAt ISO 8601 instant GAAP was called.
 * @property {string} expiresAt ISO 8601 instant after which the data is labelled stale.
 * @property {'fresh'|'stale'|'incomplete'} freshness
 */

/**
 * MongoDB store for the normalized nodes (catalogCache, source GAAP_UNITY, key "nodes").
 * Only normalized fields are stored, never the raw GAAP payload: raw node records can
 * contain integration credentials.
 *
 * @param {object} options
 * @param {number} options.ttlMs Age after which stored nodes are labelled stale.
 * @param {typeof CatalogCache} [options.model]
 * @param {() => Date} [options.now]
 * @param {{ warn: Function }} [options.logger]
 */
export function createNodesCacheRepository({
  ttlMs,
  model = CatalogCache,
  now = () => new Date(),
  logger = defaultLogger,
}) {
  /** @returns {Promise<StoredNodes|null>} null when nothing usable is stored. */
  async function find() {
    const doc = await model.findOne({ source: NODES_CACHE_SOURCE, key: NODES_CACHE_KEY }).lean();
    if (doc === null) {
      return null;
    }
    if (!isValidPayload(doc.payload)) {
      // Database content is untrusted too: ignore it so the caller refetches.
      logger.warn('Stored nodes payload is invalid and was ignored');
      return null;
    }
    return toStored(doc, now());
  }

  /**
   * Replaces the stored nodes (one document per source and key).
   * @param {import('../gaap/nodes.adapter.js').NodesResult} result
   * @returns {Promise<StoredNodes>}
   */
  async function save(result) {
    const fetchedAt = new Date(result.fetchedAt);
    const payload = {
      nodes: result.nodes,
      malformed: result.malformed,
      rawCount: result.rawCount,
      upstreamTotal: result.upstreamTotal,
      complete: result.complete,
    };
    const doc = await model
      .findOneAndUpdate(
        { source: NODES_CACHE_SOURCE, key: NODES_CACHE_KEY },
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
  let freshness = 'stale';
  if (doc.freshness === 'incomplete' || payload.complete === false) {
    freshness = 'incomplete';
  } else if (doc.expiresAt > at) {
    freshness = 'fresh';
  }
  return {
    nodes: payload.nodes,
    malformed: payload.malformed,
    rawCount: payload.rawCount,
    upstreamTotal: payload.upstreamTotal,
    complete: payload.complete,
    fetchedAt: doc.fetchedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    freshness,
  };
}

function isValidPayload(payload) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    Array.isArray(payload.nodes) &&
    payload.nodes.every(isStoredNode) &&
    Array.isArray(payload.malformed) &&
    Number.isInteger(payload.rawCount) &&
    (payload.upstreamTotal === null || Number.isInteger(payload.upstreamTotal)) &&
    typeof payload.complete === 'boolean'
  );
}

function isStoredNode(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    typeof node.id === 'string' &&
    node.id !== '' &&
    (node.name === null || typeof node.name === 'string') &&
    Array.isArray(node.warnings)
  );
}
