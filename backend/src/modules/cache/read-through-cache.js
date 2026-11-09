import { logger as defaultLogger } from '../../utils/logger.js';

/**
 * Read-through cache over a MongoDB repository and a GAAP fetch.
 *
 * `read()` returns the stored entry when there is one (a hit) and calls `fetch` only on a miss
 * or, under the `on_expiry` policy, when the entry has expired. Under `manual` (default) expired
 * data is served and labelled stale; only `refresh()` calls GAAP. Concurrent fetches are merged
 * into one (per process). A failed refetch never replaces stored data: the stored copy is served
 * labelled stale, with `cache.fallback` naming why, and further reads do not call GAAP again
 * until the retry cooldown passes. With nothing stored, a failed fetch throws (nothing is invented).
 *
 * Every returned state has a `cache` block: status, hit, source, key, fetchedAt, expiresAt,
 * freshness, refreshPolicy, fallback, persisted. Freshness is never upgraded: data older than
 * `expiresAt` is never `fresh`.
 *
 * @param {object} options
 * @param {string} options.source e.g. "GAAP_UNITY"
 * @param {string} options.key e.g. "nodes"
 * @param {(ctx: { requestId?: string }) => Promise<object>} options.fetch resolves a result with `complete` and `fetchedAt`
 * @param {{ find: Function, save: Function }} options.repository
 * @param {'manual'|'on_expiry'} [options.refreshPolicy]
 * @param {number} [options.retryCooldownMs]
 * @param {() => number} [options.now] epoch ms
 * @param {{ warn: Function, error: Function }} [options.logger]
 */
export function createReadThroughCache({
  source,
  key,
  fetch,
  repository,
  refreshPolicy = 'manual',
  retryCooldownMs = 30_000,
  now = Date.now,
  logger = defaultLogger,
}) {
  let inflight = null;
  let lastFailureAt = null;
  const counters = { hits: 0, misses: 0, refreshes: 0, fallbacks: 0, fetchFailures: 0 };

  function describe(state, { status, fallback = null }) {
    return {
      ...state,
      cache: {
        status,
        hit: status === 'hit' || status === 'stale_fallback',
        source,
        key,
        origin: state.origin,
        fetchedAt: state.fetchedAt,
        expiresAt: state.expiresAt,
        freshness: state.freshness,
        refreshPolicy,
        fallback,
        persisted: state.persisted,
      },
    };
  }

  /** Fetch from GAAP and store. A failed save does not lose the fetched data. */
  function fetchAndStore(requestId) {
    inflight ??= (async () => {
      try {
        const result = await fetch({ requestId });
        try {
          const stored = await repository.save(result);
          return { ...stored, origin: 'gaap', persisted: true };
        } catch (error) {
          logger.error('Could not store fetched cache entry', {
            cache: key,
            errorName: error?.name,
            requestId,
          });
          return {
            ...result,
            expiresAt: null,
            freshness: result.complete ? 'fresh' : 'incomplete',
            expired: false,
            origin: 'gaap',
            persisted: false,
          };
        }
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function loadStored(requestId) {
    try {
      return await repository.find();
    } catch (error) {
      logger.warn('Could not read stored cache entry; falling back to GAAP', {
        cache: key,
        errorName: error?.name,
        requestId,
      });
      return null;
    }
  }

  function isExpired(stored) {
    const expiresAt = Date.parse(stored.expiresAt);
    // An entry without a readable expiry cannot be called current.
    return Number.isNaN(expiresAt) || expiresAt <= now();
  }

  function asStored(stored) {
    // `freshness` from the repository is by age at read time; recompute so a stale entry is
    // never presented as fresh by a repository that did not check.
    const expired = isExpired(stored);
    let freshness = stored.freshness;
    if (freshness === 'fresh' && expired) freshness = 'stale';
    return { ...stored, freshness, expired, origin: 'database', persisted: true };
  }

  /**
   * @param {{ requestId?: string }} [options]
   * @returns {Promise<object>} the entry plus its `cache` block
   * @throws whatever `fetch` throws when nothing is stored (or the stored copy is unusable)
   */
  async function read({ requestId } = {}) {
    const stored = await loadStored(requestId);
    if (stored === null) {
      counters.misses += 1;
      const fetched = await fetchOrThrow(requestId);
      return describe(fetched, { status: 'miss' });
    }

    const state = asStored(stored);
    const shouldRefetch = refreshPolicy === 'on_expiry' && state.expired;
    if (!shouldRefetch) {
      counters.hits += 1;
      return describe(state, { status: 'hit' });
    }

    if (lastFailureAt !== null && now() - lastFailureAt < retryCooldownMs) {
      counters.fallbacks += 1;
      return describe(markStale(state), {
        status: 'stale_fallback',
        fallback: 'UPSTREAM_RETRY_COOLDOWN',
      });
    }

    try {
      const fetched = await fetchOrThrow(requestId);
      counters.refreshes += 1;
      return describe(fetched, { status: 'refresh' });
    } catch (error) {
      counters.fallbacks += 1;
      logger.warn('Refresh failed; serving stored data labelled stale', {
        cache: key,
        errorName: error?.name,
        errorCode: error?.code,
        requestId,
      });
      return describe(markStale(state), {
        status: 'stale_fallback',
        fallback: 'UPSTREAM_UNAVAILABLE',
      });
    }
  }

  /** Calls GAAP now and replaces the stored entry. A failure throws and leaves the old entry. */
  async function refresh({ requestId } = {}) {
    const fetched = await fetchOrThrow(requestId);
    counters.refreshes += 1;
    return describe(fetched, { status: 'refresh' });
  }

  async function fetchOrThrow(requestId) {
    try {
      const state = await fetchAndStore(requestId);
      lastFailureAt = null;
      return state;
    } catch (error) {
      counters.fetchFailures += 1;
      lastFailureAt = now();
      throw error;
    }
  }

  /** Counters since process start (per process, not persisted). */
  function stats() {
    return { ...counters };
  }

  return Object.freeze({ read, refresh, stats });
}

function markStale(state) {
  // Incomplete stays incomplete; anything else past its expiry is stale.
  return { ...state, freshness: state.freshness === 'incomplete' ? 'incomplete' : 'stale' };
}
