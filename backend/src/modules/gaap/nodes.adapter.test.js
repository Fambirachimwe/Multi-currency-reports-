/**
 * Nodes adapter tests. FIXTURE data and a fake client: these prove the adapter's mapping and
 * paging logic, not live GAAP behaviour (the live shape is recorded in nodes.adapter.js).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIXTURE_ID,
  MIXED_NODES,
  fixturePage,
  fixtureRoot,
  fixtureStore,
} from './fixtures/nodes.fixture.js';
import { GAAP_ERROR_CODES, GaapError } from './gaap.errors.js';
import { createNodesAdapter, NODE_WARNINGS, normalizeNodes } from './nodes.adapter.js';

const FIXED_NOW = () => new Date('2026-11-07T10:00:00.000Z');

/** Fake client: each call consumes the next scripted body (or throws it if it is an Error). */
function fakeClient(bodies) {
  const calls = [];
  return {
    calls,
    async get(path, params, options) {
      calls.push({ path, params, options });
      const body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
      if (body instanceof Error) throw body;
      return { data: body, status: 200, attempts: 1, durationMs: 1 };
    },
  };
}

function adapterFor(bodies, options = {}) {
  const client = fakeClient(bodies);
  return { client, adapter: createNodesAdapter({ client, now: FIXED_NOW, ...options }) };
}

describe('normalizeNodes (FIXTURE)', () => {
  it('maps the verified fields and keeps the unique _id, not the shared nodeId', () => {
    const { nodes, malformed } = normalizeNodes([fixtureStore(10), fixtureStore(11)]);

    assert.deepEqual(malformed, []);
    assert.equal(nodes.length, 2, 'children sharing a nodeId must not collapse');
    assert.deepEqual(nodes[0], {
      id: FIXTURE_ID(10),
      name: 'Store 010',
      parentId: FIXTURE_ID(1),
      sourceNodeId: FIXTURE_ID(1),
      sourceStatus: '1',
      warnings: [],
    });
  });

  it('exposes no brand, currency or other unverified field', () => {
    const [node] = normalizeNodes([fixtureStore(10, { brand: 'X', brandId: 'Y' })]).nodes;
    assert.deepEqual(Object.keys(node).sort(), [
      'id',
      'name',
      'parentId',
      'sourceNodeId',
      'sourceStatus',
      'warnings',
    ]);
  });

  it('sorts by name then id, independent of input order, with unnamed nodes last', () => {
    const unnamed = fixtureStore(5, { tradingDetails: {} });
    const sameNameA = fixtureStore(21, { tradingDetails: { name: 'Same' } });
    const sameNameB = fixtureStore(20, { tradingDetails: { name: 'Same' } });
    const forward = normalizeNodes([...MIXED_NODES, unnamed, sameNameA, sameNameB]).nodes;
    const reversed = normalizeNodes([
      sameNameB,
      sameNameA,
      unnamed,
      ...[...MIXED_NODES].reverse(),
    ]).nodes;

    assert.deepEqual(
      forward.map((n) => n.id),
      reversed.map((n) => n.id),
    );
    assert.deepEqual(
      forward.map((n) => n.name),
      ['Group 1', 'Same', 'Same', 'Store 010', 'Store 011', 'Store 012', null],
    );
    assert.deepEqual([forward[1].id, forward[2].id], [FIXTURE_ID(20), FIXTURE_ID(21)]);
  });

  it('sorts numbered names naturally (2 before 10)', () => {
    const two = fixtureStore(2, { tradingDetails: { name: 'Store 2' } });
    const ten = fixtureStore(3, { tradingDetails: { name: 'Store 10' } });
    assert.deepEqual(
      normalizeNodes([ten, two]).nodes.map((n) => n.name),
      ['Store 2', 'Store 10'],
    );
  });

  it('flags records that are not objects or have no usable _id, without keeping their payload', () => {
    const { nodes, malformed } = normalizeNodes([
      null,
      'text',
      [1],
      42,
      { tradingDetails: { name: 'No id' } },
      { _id: '   ', tradingDetails: { name: 'Blank id' } },
      { _id: 123, tradingDetails: { name: 'Numeric id' } },
      fixtureStore(10),
    ]);

    assert.deepEqual(
      nodes.map((n) => n.id),
      [FIXTURE_ID(10)],
    );
    assert.deepEqual(malformed, [
      { index: 0, reason: 'NOT_AN_OBJECT', id: null },
      { index: 1, reason: 'NOT_AN_OBJECT', id: null },
      { index: 2, reason: 'NOT_AN_OBJECT', id: null },
      { index: 3, reason: 'NOT_AN_OBJECT', id: null },
      { index: 4, reason: 'MISSING_ID', id: null },
      { index: 5, reason: 'MISSING_ID', id: null },
      { index: 6, reason: 'MISSING_ID', id: null },
    ]);
  });

  it('keeps the first of duplicate ids and flags the rest', () => {
    const first = fixtureStore(10);
    const second = fixtureStore(10, { tradingDetails: { name: 'Impostor' } });
    const { nodes, malformed } = normalizeNodes([first, second]);

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'Store 010');
    assert.deepEqual(malformed, [{ index: 1, reason: 'DUPLICATE_ID', id: FIXTURE_ID(10) }]);
  });

  it('keeps a node with a missing name but warns, and never invents a name from the id', () => {
    const [node] = normalizeNodes([
      fixtureStore(10, { tradingDetails: {}, name: undefined }),
    ]).nodes;
    assert.equal(node.name, null);
    assert.deepEqual(node.warnings, [NODE_WARNINGS.MISSING_NAME]);
  });

  it('prefers tradingDetails.name, falls back to name, and warns on a conflict', () => {
    const fallback = normalizeNodes([fixtureStore(10, { tradingDetails: undefined, name: 'Top' })])
      .nodes[0];
    assert.equal(fallback.name, 'Top');
    assert.deepEqual(fallback.warnings, []);

    const conflict = normalizeNodes([fixtureStore(11, { name: 'Admin Node' })]).nodes[0];
    assert.equal(conflict.name, 'Store 011');
    assert.deepEqual(conflict.warnings, [NODE_WARNINGS.NAME_CONFLICT]);

    const agree = normalizeNodes([fixtureStore(12, { name: 'Store 012' })]).nodes[0];
    assert.deepEqual(agree.warnings, []);
  });

  it('trims names and ids', () => {
    const [node] = normalizeNodes([
      fixtureStore(10, { _id: `  ${FIXTURE_ID(10)} `, tradingDetails: { name: '  Padded  ' } }),
    ]).nodes;
    assert.equal(node.id, FIXTURE_ID(10));
    assert.equal(node.name, 'Padded');
  });

  it('warns on wrongly typed optional fields and nulls them; absent ones stay silent', () => {
    const [bad] = normalizeNodes([fixtureStore(10, { parent: 5, nodeId: {}, status: 3 })]).nodes;
    assert.equal(bad.parentId, null);
    assert.equal(bad.sourceNodeId, null);
    assert.equal(bad.sourceStatus, null);
    assert.deepEqual(bad.warnings, [
      NODE_WARNINGS.INVALID_PARENT,
      NODE_WARNINGS.INVALID_SOURCE_NODE_ID,
      NODE_WARNINGS.INVALID_STATUS,
    ]);

    const [absent] = normalizeNodes([
      fixtureStore(11, { parent: undefined, nodeId: undefined, status: undefined }),
    ]).nodes;
    assert.deepEqual(absent.warnings, []);
    assert.equal(absent.parentId, null);
  });

  it('returns empty results for no records', () => {
    assert.deepEqual(normalizeNodes([]), { nodes: [], malformed: [] });
  });
});

describe('nodes adapter fetch (FIXTURE client)', () => {
  it('requests /nodes with limit and skip, never sort or a key', async () => {
    const { client, adapter } = adapterFor([fixturePage(MIXED_NODES)]);
    const controller = new AbortController();
    await adapter.fetchNodes({ signal: controller.signal, requestId: 'req-1' });

    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].path, '/nodes');
    assert.deepEqual(client.calls[0].params, { limit: 1000, skip: 0 });
    assert.equal(client.calls[0].options.signal, controller.signal);
    assert.equal(client.calls[0].options.requestId, 'req-1');
  });

  it('returns a complete, sorted result with provenance', async () => {
    const { adapter } = adapterFor([fixturePage(MIXED_NODES)]);
    const result = await adapter.fetchNodes();

    assert.equal(result.complete, true);
    assert.equal(result.rawCount, 4);
    assert.equal(result.upstreamTotal, 4);
    assert.equal(result.fetchedAt, '2026-11-07T10:00:00.000Z');
    assert.deepEqual(
      result.nodes.map((n) => n.name),
      ['Group 1', 'Store 010', 'Store 011', 'Store 012'],
    );
  });

  it('is deterministic: the same payload always gives the same output', async () => {
    const first = await adapterFor([fixturePage(MIXED_NODES)]).adapter.fetchNodes();
    const second = await adapterFor([fixturePage([...MIXED_NODES].reverse())]).adapter.fetchNodes();
    assert.deepEqual(first, second);
  });

  it('pages until totalRecords is reached and de-duplicates across pages', async () => {
    const pageOne = [fixtureStore(10), fixtureStore(11)];
    const pageTwo = [fixtureStore(11), fixtureStore(12)]; // overlap: 11 repeats
    const { client, adapter } = adapterFor([fixturePage(pageOne, 4), fixturePage(pageTwo, 4)], {
      pageSize: 2,
    });
    const result = await adapter.fetchNodes();

    assert.deepEqual(
      client.calls.map((c) => c.params),
      [
        { limit: 2, skip: 0 },
        { limit: 2, skip: 2 },
      ],
    );
    assert.equal(result.complete, true);
    assert.equal(result.rawCount, 4);
    assert.deepEqual(
      result.nodes.map((n) => n.id),
      [FIXTURE_ID(10), FIXTURE_ID(11), FIXTURE_ID(12)],
    );
    assert.deepEqual(result.malformed, [{ index: 2, reason: 'DUPLICATE_ID', id: FIXTURE_ID(11) }]);
  });

  it('treats an empty result as complete and empty', async () => {
    const { adapter } = adapterFor([fixturePage([], 0)]);
    const result = await adapter.fetchNodes();
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.malformed, []);
    assert.equal(result.complete, true);
    assert.equal(result.upstreamTotal, 0);
  });

  it('is complete on a short page when GAAP gave no valid total', async () => {
    const { adapter } = adapterFor([{ data: [fixtureStore(10)] }]);
    const result = await adapter.fetchNodes();
    assert.equal(result.complete, true);
    assert.equal(result.upstreamTotal, null);

    const badTotal = await adapterFor([
      { totalRecords: 'many', data: [fixtureStore(10)] },
    ]).adapter.fetchNodes();
    assert.equal(badTotal.upstreamTotal, null);
    assert.equal(badTotal.complete, true);
  });

  it('is incomplete when GAAP promises more records than it returned', async () => {
    const { adapter } = adapterFor([fixturePage([fixtureStore(10)], 5), fixturePage([], 5)], {
      pageSize: 2,
    });
    const result = await adapter.fetchNodes();
    assert.equal(result.complete, false);
    assert.equal(result.upstreamTotal, 5);
  });

  it('stops at the page cap and reports incomplete', async () => {
    const pages = [0, 1, 2].map((p) =>
      fixturePage([fixtureStore(10 + p * 2), fixtureStore(11 + p * 2)], 100),
    );
    const { client, adapter } = adapterFor(pages, { pageSize: 2, maxPages: 3 });
    const result = await adapter.fetchNodes();

    assert.equal(client.calls.length, 3, 'must not exceed maxPages');
    assert.equal(result.complete, false);
    assert.equal(result.nodes.length, 6);
  });

  it('flags malformed records inside a real page without failing the fetch', async () => {
    const { adapter } = adapterFor([fixturePage([fixtureStore(10), null, { name: 'x' }], 3)]);
    const result = await adapter.fetchNodes();
    assert.equal(result.nodes.length, 1);
    assert.deepEqual(
      result.malformed.map((m) => m.reason),
      ['NOT_AN_OBJECT', 'MISSING_ID'],
    );
    assert.equal(result.rawCount, 3);
  });

  for (const [label, body] of [
    ['an array body', [fixtureStore(10)]],
    ['a missing data field', { totalRecords: 1 }],
    ['a null data field', { totalRecords: 1, data: null }],
    ['an object data field', { totalRecords: 1, data: {} }],
    ['a string body', 'nope'],
    ['a null body', null],
  ]) {
    it(`rejects ${label} as GAAP_INVALID_RESPONSE`, async () => {
      const { adapter } = adapterFor([body]);
      await assert.rejects(adapter.fetchNodes(), (error) => {
        assert.ok(error instanceof GaapError);
        assert.equal(error.code, GAAP_ERROR_CODES.INVALID_RESPONSE);
        return true;
      });
    });
  }

  it('propagates client failures unchanged', async () => {
    const failure = new GaapError({ code: GAAP_ERROR_CODES.TIMEOUT, message: 'timed out' });
    const { adapter } = adapterFor([failure]);
    await assert.rejects(adapter.fetchNodes(), (error) => error === failure);
  });
});

describe('fixture realism', () => {
  it('root fixtures use their own id as nodeId and children share the root', () => {
    assert.equal(fixtureRoot(1).nodeId, fixtureRoot(1)._id);
    assert.equal(fixtureStore(10).nodeId, fixtureStore(11).nodeId);
  });
});
