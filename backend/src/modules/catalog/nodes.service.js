import { createReadThroughCache } from '../cache/read-through-cache.js';
import { logger as defaultLogger } from '../../utils/logger.js';

/** Largest page a caller may request from `GET /api/v1/nodes`. */
export const NODES_MAX_LIMIT = 1000;
export const NODES_DEFAULT_LIMIT = 500;
/** Malformed records listed in `meta`; the full count is always reported. */
export const MALFORMED_PREVIEW_LIMIT = 50;

/**
 * Catalog service for nodes.
 *
 * Reads are served from MongoDB. GAAP is called only when nothing is stored yet or when
 * `refreshNodes` is called explicitly, so a page reload never triggers a GAAP request.
 * Stale data is still served and labelled (`meta.cacheFreshness`). Concurrent GAAP fetches
 * are merged into one. If a refresh fails, the previously stored nodes are left untouched.
 *
 * @param {object} options
 * @param {{ fetchNodes: Function }} options.nodesAdapter
 * @param {{ find: Function, save: Function }} options.repository
 * @param {{ warn: Function, error: Function }} [options.logger]
 */
export function createNodesService({
  nodesAdapter,
  repository,
  logger = defaultLogger,
  refreshPolicy = 'manual',
  retryCooldownMs,
  now,
}) {
  const cache = createReadThroughCache({
    source: 'GAAP_UNITY',
    key: 'nodes',
    fetch: ({ requestId }) => nodesAdapter.fetchNodes({ requestId }),
    repository,
    refreshPolicy,
    retryCooldownMs,
    now,
    logger,
  });

  /** @param {{ limit: number, offset: number, requestId?: string }} query */
  async function listNodes({ limit, offset, requestId }) {
    return present(await cache.read({ requestId }), limit, offset);
  }

  /** Calls GAAP now and replaces the stored nodes. Same output as `listNodes`. */
  async function refreshNodes({ limit, offset, requestId }) {
    return present(await cache.refresh({ requestId }), limit, offset);
  }

  /** Every stored node (no paging) plus meta, for server-side filter building. */
  async function listAllNodes({ requestId } = {}) {
    const state = await cache.read({ requestId });
    return { nodes: state.nodes, meta: present(state, 1, 0).meta };
  }

  return Object.freeze({ listNodes, refreshNodes, listAllNodes, cacheStats: cache.stats });
}

function present(state, limit, offset) {
  const page = state.nodes.slice(offset, offset + limit);
  return {
    nodes: page,
    meta: {
      source: 'GAAP_UNITY',
      // 'database' = served from stored data with no GAAP call; 'gaap' = fetched just now.
      origin: state.origin,
      persisted: state.persisted,
      fetchedAt: state.fetchedAt,
      cacheFreshness: state.freshness,
      cacheExpiresAt: state.expiresAt,
      // Hit/miss, source, timestamps, policy and any stale fallback reason.
      cache: state.cache,
      // False means the list may be missing nodes; callers must not treat it as full.
      complete: state.complete,
      total: state.nodes.length,
      limit,
      offset,
      returned: page.length,
      upstreamTotal: state.upstreamTotal,
      malformedCount: state.malformed.length,
      malformed: state.malformed.slice(0, MALFORMED_PREVIEW_LIMIT),
      warningCount: state.nodes.filter((node) => node.warnings.length > 0).length,
    },
  };
}
