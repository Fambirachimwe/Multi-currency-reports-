/** Read-through cache tests: FIXTURE fetcher and in-memory repository (no GAAP, no MongoDB). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadCachePolicy } from './cache-policy.js';
import { createReadThroughCache } from './read-through-cache.js';
import { loadSalesCachePolicy } from './sales-cache.policy.js';

const quiet = { warn() {}, error() {} };
const HOUR = 3_600_000;

function clock(start = Date.parse('2026-11-08T08:00:00.000Z')) {
  const c = { t: start, now: () => c.t, advance: (ms) => (c.t += ms) };
  return c;
}

/** Repository double that computes freshness from the shared clock, like the real one. */
function repo(c, { ttlMs = HOUR, failFind = false, failSave = false } = {}) {
  const state = { stored: null, saves: 0 };
  return {
    state,
    async find() {
      if (failFind) throw new Error('db down');
      if (state.stored === null) return null;
      const s = state.stored;
      const fresh = Date.parse(s.expiresAt) > c.now();
      return { ...s, freshness: !s.complete ? 'incomplete' : fresh ? 'fresh' : 'stale' };
    },
    async save(result) {
      state.saves += 1;
      if (failSave) throw new Error('db down');
      state.stored = {
        items: result.items,
        complete: result.complete,
        fetchedAt: result.fetchedAt,
        expiresAt: new Date(Date.parse(result.fetchedAt) + ttlMs).toISOString(),
      };
      return { ...state.stored, freshness: result.complete ? 'fresh' : 'incomplete' };
    },
  };
}

function upstream(c, { items = ['a'], complete = true } = {}) {
  const u = {
    calls: 0,
    fail: null,
    delayMs: 0,
    items,
    async fetch() {
      u.calls += 1;
      if (u.delayMs) await new Promise((resolve) => setTimeout(resolve, u.delayMs));
      if (u.fail) throw u.fail;
      return { items: [...u.items], complete, fetchedAt: new Date(c.now()).toISOString() };
    },
  };
  return u;
}

function build(c, u, r, options = {}) {
  return createReadThroughCache({
    source: 'GAAP_UNITY',
    key: 'test',
    fetch: () => u.fetch(),
    repository: r,
    now: c.now,
    logger: quiet,
    ...options,
  });
}

describe('read-through cache (FIXTURE upstream, in-memory repository)', () => {
  it('miss fetches and stores; later reads are hits with fetchedAt, expiresAt and source', async () => {
    const c = clock();
    const u = upstream(c);
    const r = repo(c);
    const cache = build(c, u, r);

    const first = await cache.read();
    assert.equal(first.cache.status, 'miss');
    assert.equal(first.cache.hit, false);
    assert.equal(first.cache.source, 'GAAP_UNITY');
    assert.equal(first.cache.fetchedAt, '2026-11-08T08:00:00.000Z');
    assert.equal(first.cache.expiresAt, '2026-11-08T09:00:00.000Z');
    assert.equal(first.cache.freshness, 'fresh');

    c.advance(10 * 60_000);
    const second = await cache.read();
    assert.equal(second.cache.status, 'hit');
    assert.equal(second.cache.hit, true);
    assert.equal(second.cache.origin, 'database');
    assert.equal(second.cache.fetchedAt, first.cache.fetchedAt);
    assert.equal(u.calls, 1);
    assert.deepEqual(cache.stats(), {
      hits: 1,
      misses: 1,
      refreshes: 0,
      fallbacks: 0,
      fetchFailures: 0,
    });
  });

  it('manual policy: an expired entry is served labelled stale and GAAP is not called', async () => {
    const c = clock();
    const u = upstream(c);
    const cache = build(c, u, repo(c), { refreshPolicy: 'manual' });
    await cache.read();
    c.advance(2 * HOUR);

    const again = await cache.read();
    assert.equal(again.cache.status, 'hit');
    assert.equal(again.cache.freshness, 'stale');
    assert.equal(again.expired, true);
    assert.equal(u.calls, 1);
  });

  it('on_expiry policy: an expired entry is refetched and replaced', async () => {
    const c = clock();
    const u = upstream(c);
    const r = repo(c);
    const cache = build(c, u, r, { refreshPolicy: 'on_expiry' });
    await cache.read();
    u.items = ['a', 'b'];
    c.advance(2 * HOUR);

    const again = await cache.read();
    assert.equal(again.cache.status, 'refresh');
    assert.equal(again.cache.freshness, 'fresh');
    assert.deepEqual(again.items, ['a', 'b']);
    assert.equal(again.cache.fetchedAt, '2026-11-08T10:00:00.000Z');
    assert.equal(u.calls, 2);
    // Not expired any more: next read is a plain hit.
    assert.equal((await cache.read()).cache.status, 'hit');
    assert.equal(u.calls, 2);
  });

  it('on_expiry policy: an entry that is not yet expired is not refetched', async () => {
    const c = clock();
    const u = upstream(c);
    const cache = build(c, u, repo(c), { refreshPolicy: 'on_expiry' });
    await cache.read();
    c.advance(HOUR - 1);
    assert.equal((await cache.read()).cache.status, 'hit');
    assert.equal(u.calls, 1);
  });

  it('upstream unavailable on refetch: serves the stored copy labelled stale with a reason', async () => {
    const c = clock();
    const u = upstream(c);
    const r = repo(c);
    const cache = build(c, u, r, { refreshPolicy: 'on_expiry', retryCooldownMs: 30_000 });
    await cache.read();
    const before = structuredClone(r.state.stored);
    c.advance(2 * HOUR);
    u.fail = Object.assign(new Error('boom'), { code: 'GAAP_TIMEOUT' });

    const result = await cache.read();
    assert.equal(result.cache.status, 'stale_fallback');
    assert.equal(result.cache.fallback, 'UPSTREAM_UNAVAILABLE');
    assert.equal(result.cache.freshness, 'stale');
    assert.equal(result.cache.fetchedAt, '2026-11-08T08:00:00.000Z', 'old fetchedAt, not renewed');
    assert.deepEqual(result.items, ['a']);
    assert.deepEqual(r.state.stored, before, 'stored entry untouched by a failed refetch');
    assert.equal(u.calls, 2);

    // Within the cooldown GAAP is not called again.
    c.advance(10_000);
    const cooled = await cache.read();
    assert.equal(cooled.cache.fallback, 'UPSTREAM_RETRY_COOLDOWN');
    assert.equal(cooled.cache.freshness, 'stale');
    assert.equal(u.calls, 2);

    // After the cooldown it retries, and recovers when upstream is back.
    c.advance(30_000);
    u.fail = null;
    u.items = ['z'];
    const recovered = await cache.read();
    assert.equal(recovered.cache.status, 'refresh');
    assert.deepEqual(recovered.items, ['z']);
    assert.equal(cache.stats().fallbacks, 2);
    assert.equal(cache.stats().fetchFailures, 1);
  });

  it('upstream unavailable with nothing stored: throws, stores nothing, invents nothing', async () => {
    const c = clock();
    const u = upstream(c);
    u.fail = new Error('boom');
    const r = repo(c);
    const cache = build(c, u, r);

    await assert.rejects(() => cache.read(), /boom/);
    assert.equal(r.state.stored, null);
    assert.equal(r.state.saves, 0);
    assert.equal(cache.stats().hits, 0);
  });

  it('explicit refresh failure throws and leaves the stored entry unchanged', async () => {
    const c = clock();
    const u = upstream(c);
    const r = repo(c);
    const cache = build(c, u, r);
    await cache.read();
    const before = structuredClone(r.state.stored);
    u.fail = new Error('boom');

    await assert.rejects(() => cache.refresh(), /boom/);
    assert.deepEqual(r.state.stored, before);
  });

  it('concurrent reads on a miss share one upstream call', async () => {
    const c = clock();
    const u = upstream(c);
    u.delayMs = 20;
    const r = repo(c);
    const cache = build(c, u, r);

    const results = await Promise.all([cache.read(), cache.read(), cache.read(), cache.read()]);
    assert.equal(u.calls, 1);
    assert.equal(r.state.saves, 1);
    for (const result of results) assert.deepEqual(result.items, ['a']);
  });

  it('concurrent reads of an expired entry (on_expiry) and a manual refresh share one call', async () => {
    const c = clock();
    const u = upstream(c);
    const r = repo(c);
    const cache = build(c, u, r, { refreshPolicy: 'on_expiry' });
    await cache.read();
    c.advance(2 * HOUR);
    u.delayMs = 20;
    u.items = ['n'];

    const results = await Promise.all([cache.read(), cache.read(), cache.refresh(), cache.read()]);
    assert.equal(u.calls, 2, 'one initial fetch plus exactly one shared refetch');
    assert.equal(r.state.saves, 2);
    for (const result of results) assert.deepEqual(result.items, ['n']);
  });

  it('concurrent reads when the refetch fails all fall back to the stored copy', async () => {
    const c = clock();
    const u = upstream(c);
    const cache = build(c, u, repo(c), { refreshPolicy: 'on_expiry' });
    await cache.read();
    c.advance(2 * HOUR);
    u.delayMs = 20;
    u.fail = new Error('boom');

    const results = await Promise.all([cache.read(), cache.read(), cache.read()]);
    assert.equal(u.calls, 2);
    for (const result of results) {
      assert.equal(result.cache.status, 'stale_fallback');
      assert.equal(result.cache.freshness, 'stale');
    }
  });

  it('a repository that reports fresh for an expired entry is not believed', async () => {
    const c = clock();
    const u = upstream(c);
    const liar = {
      async find() {
        return {
          items: ['a'],
          complete: true,
          fetchedAt: '2026-11-08T08:00:00.000Z',
          expiresAt: '2026-11-08T09:00:00.000Z',
          freshness: 'fresh',
        };
      },
      async save() {
        throw new Error('unused');
      },
    };
    c.advance(5 * HOUR);
    const result = await build(c, u, liar).read();
    assert.equal(result.cache.freshness, 'stale');
  });

  it('an unreadable expiry is treated as expired, never fresh', async () => {
    const c = clock();
    const u = upstream(c);
    const odd = {
      async find() {
        return { items: [], complete: true, fetchedAt: 'x', expiresAt: 'nope', freshness: 'fresh' };
      },
      async save() {
        throw new Error('unused');
      },
    };
    const result = await build(c, u, odd).read();
    assert.equal(result.cache.freshness, 'stale');
  });

  it('incomplete data stays labelled incomplete, including as a fallback', async () => {
    const c = clock();
    const u = upstream(c, { complete: false });
    const cache = build(c, u, repo(c), { refreshPolicy: 'on_expiry' });
    const first = await cache.read();
    assert.equal(first.cache.freshness, 'incomplete');
    c.advance(2 * HOUR);
    u.fail = new Error('boom');
    const fallback = await cache.read();
    assert.equal(fallback.cache.status, 'stale_fallback');
    assert.equal(fallback.cache.freshness, 'incomplete');
  });

  it('save failure returns the fetched data flagged not persisted, with no expiry', async () => {
    const c = clock();
    const cache = build(c, upstream(c), repo(c, { failSave: true }));
    const result = await cache.read();
    assert.equal(result.cache.persisted, false);
    assert.equal(result.cache.expiresAt, null);
    assert.equal(result.cache.status, 'miss');
  });

  it('database read failure falls back to upstream', async () => {
    const c = clock();
    const u = upstream(c);
    const result = await build(c, u, repo(c, { failFind: true })).read();
    assert.equal(result.cache.status, 'miss');
    assert.equal(u.calls, 1);
  });
});

describe('cache policy configuration', () => {
  it('has defaults: 24 h, manual refresh, 30 s cooldown', () => {
    assert.deepEqual(loadCachePolicy('NODES', {}), {
      ttlMs: 24 * HOUR,
      refreshPolicy: 'manual',
      retryCooldownMs: 30_000,
    });
  });

  it('reads valid overrides', () => {
    const policy = loadCachePolicy('CATALOG', {
      CATALOG_CACHE_TTL_HOURS: '6',
      CATALOG_CACHE_REFRESH_POLICY: 'on_expiry',
      CATALOG_CACHE_RETRY_COOLDOWN_SECONDS: '0',
    });
    assert.deepEqual(policy, { ttlMs: 6 * HOUR, refreshPolicy: 'on_expiry', retryCooldownMs: 0 });
  });

  it('rejects invalid values naming the variable but not the value', () => {
    for (const env of [
      { NODES_CACHE_TTL_HOURS: '0' },
      { NODES_CACHE_TTL_HOURS: '721' },
      { NODES_CACHE_TTL_HOURS: '1.5' },
      { NODES_CACHE_REFRESH_POLICY: 'always' },
      { NODES_CACHE_RETRY_COOLDOWN_SECONDS: '-1' },
      { NODES_CACHE_RETRY_COOLDOWN_SECONDS: '3601' },
    ]) {
      assert.throws(
        () => loadCachePolicy('NODES', env),
        (error) => {
          const [name, value] = Object.entries(env)[0];
          return error.message.includes(name) && !error.message.includes(`=${value}`);
        },
      );
    }
  });
});

describe('sales cache policy', () => {
  it('is disabled by default and when set to false/empty', () => {
    assert.equal(loadSalesCachePolicy({}).enabled, false);
    assert.equal(loadSalesCachePolicy({ SALES_CACHE_ENABLED: '' }).enabled, false);
    assert.equal(loadSalesCachePolicy({ SALES_CACHE_ENABLED: 'false' }).enabled, false);
  });

  it('refuses to be enabled until the rules are approved', () => {
    for (const value of ['true', '1', 'yes', 'on']) {
      assert.throws(
        () => loadSalesCachePolicy({ SALES_CACHE_ENABLED: value }),
        /SALES_CACHE_ENABLED/,
      );
    }
  });
});
