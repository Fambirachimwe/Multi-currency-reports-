/**
 * `/api/v1/filters/nodes` route tests. Nodes come from a FIXTURE nodes service (no GAAP, no
 * MongoDB), so this is not live evidence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createNodeFiltersService } from '../modules/catalog/index.js';
import { GaapError, GAAP_ERROR_CODES } from '../modules/gaap/gaap.errors.js';

const node = (id, name, parentId, top = false) => ({
  id,
  name,
  parentId,
  sourceNodeId: top ? id : parentId,
  warnings: [],
});

const NODES = [
  node('B1', 'Brand One', 'root', true),
  node('B2', 'Brand Two', 'root', true),
  node('s1', 'Store A', 'B1'),
  node('s2', 'Store B', 'B1'),
  node('s3', 'Store C', 'B2'),
];
const META = {
  source: 'GAAP_UNITY',
  origin: 'database',
  fetchedAt: '2026-11-07T00:00:00.000Z',
  cacheFreshness: 'stale',
  complete: true,
};

function buildApp({ nodes = NODES, fail = null } = {}) {
  const nodesService = {
    async listAllNodes() {
      if (fail) throw fail;
      return { nodes, meta: META };
    },
  };
  return createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    nodeFilters: createNodeFiltersService({ nodesService }),
  });
}

const resolve = (app, body) => request(app).post('/api/v1/filters/nodes/resolve').send(body);

describe('GET /api/v1/filters/nodes (FIXTURE nodes)', () => {
  it('returns brands with their node ids, nodes, and provenance', async () => {
    const res = await request(buildApp()).get('/api/v1/filters/nodes');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.brands.map((b) => [b.id, b.nodeIds]),
      [
        ['B1', ['s1', 's2']],
        ['B2', ['s3']],
      ],
    );
    assert.deepEqual(
      res.body.data.nodes.map((n) => n.id),
      ['s1', 's2', 's3'],
    );
    assert.equal(res.body.meta.brandDefinition, 'TOP_LEVEL_NODE_WITH_CHILDREN_UNVERIFIED');
    assert.equal(res.body.meta.cacheFreshness, 'stale');
    assert.equal(res.body.meta.nodeCount, 3);
  });

  it('is identical on repeated calls and rejects unknown query parameters', async () => {
    const app = buildApp();
    const a = await request(app).get('/api/v1/filters/nodes');
    const b = await request(app).get('/api/v1/filters/nodes');
    assert.deepEqual(a.body.data, b.body.data);
    const bad = await request(app).get('/api/v1/filters/nodes?x=1');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_QUERY');
  });

  it('returns empty lists for zero nodes', async () => {
    const res = await request(buildApp({ nodes: [] })).get('/api/v1/filters/nodes');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { brands: [], nodes: [] });
  });

  it('maps a GAAP failure to a normalized error', async () => {
    const fail = new GaapError({ code: GAAP_ERROR_CODES.NETWORK, message: 'down' });
    const res = await request(buildApp({ fail })).get('/api/v1/filters/nodes');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'GAAP_UNAVAILABLE');
  });
});

describe('POST /api/v1/filters/nodes/resolve (FIXTURE nodes)', () => {
  it('all mode is explicit and returns every node once', async () => {
    const res = await resolve(buildApp(), { mode: 'all' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { mode: 'all', brandIds: [], nodeIds: ['s1', 's2', 's3'] });
  });

  it('brand mode expands to exact node ids without duplicates', async () => {
    const res = await resolve(buildApp(), { mode: 'brands', brandIds: ['B2', 'B1', 'B1'] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.nodeIds, ['s1', 's2', 's3']);
    assert.deepEqual(res.body.data.brandIds, ['B1', 'B2']);
  });

  it('multi-node mode returns the sorted unique selection', async () => {
    const res = await resolve(buildApp(), { mode: 'nodes', nodeIds: ['s3', 's1', 's3'] });
    assert.deepEqual(res.body.data.nodeIds, ['s1', 's3']);
  });

  it('stale node mapping gives 422 with the offending ids', async () => {
    const res = await resolve(buildApp(), { mode: 'nodes', nodeIds: ['s1', 'old'] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'UNKNOWN_NODE');
    assert.deepEqual(res.body.error.details.unknownIds, ['old']);
  });

  it('unknown brand gives 422 UNKNOWN_BRAND', async () => {
    const res = await resolve(buildApp(), { mode: 'brands', brandIds: ['nope'] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'UNKNOWN_BRAND');
  });

  it('zero nodes in all mode gives 422 NO_NODES', async () => {
    const res = await resolve(buildApp({ nodes: [] }), { mode: 'all' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NO_NODES');
  });

  it('rejects invalid bodies with 400 INVALID_SELECTION', async () => {
    const app = buildApp();
    const bodies = [
      {},
      { mode: 'some' },
      { mode: 'all', nodeIds: ['s1'] },
      { mode: 'all', brandIds: ['B1'] },
      { mode: 'brands' },
      { mode: 'brands', brandIds: [] },
      { mode: 'brands', brandIds: ['B1'], nodeIds: ['s1'] },
      { mode: 'nodes' },
      { mode: 'nodes', nodeIds: 's1' },
      { mode: 'nodes', nodeIds: [1] },
      { mode: 'nodes', nodeIds: [''] },
      { mode: 'nodes', nodeIds: ['s1'], extra: true },
      ['s1'],
    ];
    for (const body of bodies) {
      const res = await resolve(app, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'INVALID_SELECTION', JSON.stringify(body));
    }
  });

  it('an unparseable body is a 400, not a 500', async () => {
    const res = await request(buildApp())
      .post('/api/v1/filters/nodes/resolve')
      .set('Content-Type', 'application/json')
      .send('{bad');
    assert.equal(res.status, 400);
  });

  it('is deterministic across calls', async () => {
    const app = buildApp();
    const a = await resolve(app, { mode: 'brands', brandIds: ['B1', 'B2'] });
    const b = await resolve(app, { mode: 'brands', brandIds: ['B2', 'B1'] });
    assert.deepEqual(a.body.data, b.body.data);
  });
});
