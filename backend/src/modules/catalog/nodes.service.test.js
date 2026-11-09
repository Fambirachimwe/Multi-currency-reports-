/** Nodes service tests with a fake adapter and in-memory repository (no GAAP, no MongoDB). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAAP_ERROR_CODES, GaapError } from '../gaap/gaap.errors.js';
import { FIXTURE_ID, MIXED_NODES, fixtureStore } from '../gaap/fixtures/nodes.fixture.js';
import { normalizeNodes } from '../gaap/nodes.adapter.js';
import { createNodesService } from './nodes.service.js';
import { memoryRepository } from './support/memory-repository.js';

const quiet = { warn() {}, error() {} };

function fakeAdapter(records = MIXED_NODES, { fail = null, delayMs = 0 } = {}) {
  const adapter = {
    calls: 0,
    async fetchNodes() {
      adapter.calls += 1;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) throw fail;
      const { nodes, malformed } = normalizeNodes(records);
      return {
        nodes,
        malformed,
        rawCount: records.length,
        upstreamTotal: records.length,
        complete: true,
        fetchedAt: new Date().toISOString(),
      };
    },
  };
  return adapter;
}

const build = (adapter, repository) =>
  createNodesService({ nodesAdapter: adapter, repository, logger: quiet });
const query = { limit: 100, offset: 0 };

describe('nodes service (FIXTURE adapter, in-memory repository)', () => {
  it('first read fetches from GAAP and stores; later reads come from the database only', async () => {
    const adapter = fakeAdapter();
    const repo = memoryRepository();
    const service = build(adapter, repo);

    const first = await service.listNodes(query);
    assert.equal(first.meta.origin, 'gaap');
    assert.equal(first.meta.persisted, true);
    assert.equal(adapter.calls, 1);
    assert.equal(repo.state.saves, 1);

    for (let i = 0; i < 3; i += 1) {
      const again = await service.listNodes(query);
      assert.equal(again.meta.origin, 'database');
      assert.deepEqual(again.nodes, first.nodes);
      assert.equal(again.meta.fetchedAt, first.meta.fetchedAt);
    }
    assert.equal(adapter.calls, 1, 'no further GAAP request on reload');
  });

  it('serves stale stored data without calling GAAP, labelled stale', async () => {
    const adapter = fakeAdapter();
    const service = build(adapter, memoryRepository({ ttlMs: -1000 }));
    await service.listNodes(query);
    const again = await service.listNodes(query);

    assert.equal(again.meta.origin, 'database');
    assert.equal(again.meta.cacheFreshness, 'stale');
    assert.equal(adapter.calls, 1);
  });

  it('refresh calls GAAP and replaces the stored nodes', async () => {
    const records = [fixtureStore(10)];
    const adapter = fakeAdapter(records);
    const service = build(adapter, memoryRepository());
    await service.listNodes(query);

    records.push(fixtureStore(11));
    const refreshed = await service.refreshNodes(query);
    assert.equal(refreshed.meta.origin, 'gaap');
    assert.equal(refreshed.nodes.length, 2);
    assert.equal(adapter.calls, 2);

    const after = await service.listNodes(query);
    assert.equal(after.meta.origin, 'database');
    assert.equal(after.nodes.length, 2);
  });

  it('a failed refresh keeps the previously stored nodes', async () => {
    const records = [fixtureStore(10)];
    const repo = memoryRepository();
    await build(fakeAdapter(records), repo).listNodes(query);

    const failing = fakeAdapter(records, {
      fail: new GaapError({ code: GAAP_ERROR_CODES.TIMEOUT, message: 'timed out' }),
    });
    const brokenService = build(failing, repo);
    await assert.rejects(brokenService.refreshNodes(query), { code: GAAP_ERROR_CODES.TIMEOUT });

    const still = await brokenService.listNodes(query);
    assert.equal(still.meta.origin, 'database');
    assert.equal(still.nodes.length, 1);
    assert.equal(failing.calls, 1, 'only the refresh called GAAP');
  });

  it('propagates GAAP errors when nothing is stored, and stores nothing', async () => {
    const failure = new GaapError({ code: GAAP_ERROR_CODES.UNAVAILABLE, message: 'down' });
    const repo = memoryRepository();
    const service = build(fakeAdapter(MIXED_NODES, { fail: failure }), repo);
    await assert.rejects(service.listNodes(query), (error) => error === failure);
    assert.equal(repo.state.saves, 0);
    assert.equal(repo.state.stored, null);
  });

  it('merges concurrent first requests into one GAAP call', async () => {
    const adapter = fakeAdapter(MIXED_NODES, { delayMs: 20 });
    const service = build(adapter, memoryRepository());
    const results = await Promise.all([1, 2, 3, 4].map(() => service.listNodes(query)));
    assert.equal(adapter.calls, 1);
    assert.ok(results.every((r) => r.nodes.length === 4));
  });

  it('returns fetched data, flagged not persisted, when the save fails', async () => {
    const adapter = fakeAdapter();
    const service = build(adapter, memoryRepository({ failSave: true }));
    const res = await service.listNodes(query);
    assert.equal(res.meta.persisted, false);
    assert.equal(res.nodes.length, 4);
    // Nothing was stored, so the next read fetches again rather than pretending it saved.
    await service.listNodes(query);
    assert.equal(adapter.calls, 2);
  });

  it('falls back to GAAP when the database read fails', async () => {
    const service = build(fakeAdapter(), memoryRepository({ failFind: true }));
    const res = await service.listNodes(query);
    assert.equal(res.meta.origin, 'gaap');
    assert.equal(res.nodes.length, 4);
  });

  it('pages the stored list', async () => {
    const service = build(fakeAdapter(), memoryRepository());
    const page = await service.listNodes({ limit: 2, offset: 1 });
    assert.equal(page.nodes.length, 2);
    assert.equal(page.meta.total, 4);
    assert.equal(page.nodes[0].id, FIXTURE_ID(10));
  });

  it('keeps an incomplete result labelled incomplete when served from the database', async () => {
    const adapter = fakeAdapter();
    const base = adapter.fetchNodes;
    adapter.fetchNodes = async (options) => ({ ...(await base(options)), complete: false });
    const service = build(adapter, memoryRepository());
    await service.listNodes(query);
    const again = await service.listNodes(query);
    assert.equal(again.meta.origin, 'database');
    assert.equal(again.meta.complete, false);
    assert.equal(again.meta.cacheFreshness, 'incomplete');
  });
});
