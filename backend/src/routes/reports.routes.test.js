/**
 * `POST /api/v1/reports` request-validation tests. Catalog and node services are FIXTURES (no GAAP,
 * no MongoDB), and `startReport` is a stub: this is not live evidence and no real report is created.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createNodeFiltersService, SelectionError } from '../modules/catalog/index.js';
import { GaapError, GAAP_ERROR_CODES } from '../modules/gaap/gaap.errors.js';
import {
  createReportsService,
  DEFAULT_REPORT_LIMITS,
  ReportBusyError,
  ReportRejectedError,
} from '../modules/reports/index.js';

const NOW = new Date('2026-11-08T10:00:00Z'); // Harare date 20261108
const node = (id, name, parentId, top = false) => ({
  id,
  name,
  parentId,
  sourceNodeId: top ? id : parentId,
  warnings: [],
});
const NODES = [
  node('B1', 'Brand One', 'root', true),
  node('s1', 'Store A', 'B1'),
  node('s2', 'Store B', 'B1'),
  node('s3', 'Store C', 'B1'),
];
const NODE_META = {
  source: 'GAAP_UNITY',
  origin: 'database',
  fetchedAt: '2026-11-07T00:00:00.000Z',
  cacheFreshness: 'fresh',
  complete: true,
};
const KNOWN_PRODUCTS = new Set(['p1', 'p2', 'p3']);

function build({
  nodes = NODES,
  nodeMeta = NODE_META,
  limits = DEFAULT_REPORT_LIMITS,
  startReport,
  getReportStatus,
  listReports,
  nodesFail = null,
  catalogFail = null,
} = {}) {
  const calls = { nodes: 0, catalog: 0, start: 0 };
  const nodeFiltersService = createNodeFiltersService({
    nodesService: {
      async listAllNodes() {
        calls.nodes += 1;
        if (nodesFail) throw nodesFail;
        return { nodes, meta: nodeMeta };
      },
    },
  });
  const catalogService = {
    async validateProductIds({ productIds }) {
      calls.catalog += 1;
      if (catalogFail) throw catalogFail;
      const unknown = productIds.filter((id) => !KNOWN_PRODUCTS.has(id)).sort();
      if (unknown.length > 0) {
        throw new SelectionError('UNKNOWN_PRODUCT', 'Unknown product.', unknown);
      }
      return { items: { productIds }, meta: {} };
    },
  };
  const wrappedStart =
    startReport === undefined
      ? undefined
      : async (args) => {
          calls.start += 1;
          return startReport(args);
        };
  const reports = createReportsService({
    catalogService,
    nodeFiltersService,
    limits,
    startReport: wrappedStart,
    getReportStatus,
    listReports,
    now: () => NOW,
  });
  const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    reports,
  });
  return { app, calls };
}

const valid = (overrides = {}) => ({
  startDate: '20261101',
  endDate: '20261107',
  productIds: ['p2', 'p1'],
  nodes: { mode: 'brands', brandIds: ['B1'] },
  cachePolicy: 'use_cache',
  ...overrides,
});
const post = (app, body) => request(app).post('/api/v1/reports').send(body);
const PENDING = async () => ({ reportId: 'rpt-1', status: 'pending' });

describe('POST /api/v1/reports: accepted requests (FIXTURE services, stub startReport)', () => {
  it('returns 202 with report ID, pending status and the normalized request', async () => {
    const { app, calls } = build({ startReport: PENDING });
    const res = await post(app, valid({ productIds: [' p2 ', 'p1', 'p2'] }));
    assert.equal(res.status, 202);
    assert.equal(res.body.data.reportId, 'rpt-1');
    assert.equal(res.body.data.status, 'pending');
    assert.deepEqual(res.body.data.request, {
      startDate: '20261101',
      endDate: '20261107',
      productIds: ['p1', 'p2'],
      nodes: { mode: 'brands', brandIds: ['B1'], nodeIds: ['s1', 's2', 's3'] },
      cachePolicy: 'use_cache',
    });
    assert.equal(res.body.meta.brandDefinition, 'TOP_LEVEL_NODE_WITH_CHILDREN_UNVERIFIED');
    assert.equal(calls.start, 1);
  });

  it('normalizes equivalent requests identically (order, duplicates, whitespace)', async () => {
    const { app } = build({ startReport: PENDING });
    const a = await post(
      app,
      valid({ productIds: ['p1', 'p2'], nodes: { mode: 'nodes', nodeIds: ['s2', 's1'] } }),
    );
    const b = await post(
      app,
      valid({
        productIds: ['p2', 'p1', 'p1', ' p2'],
        nodes: { mode: 'nodes', nodeIds: ['s1', 's2', 's1'] },
      }),
    );
    assert.equal(a.status, 202);
    assert.deepEqual(a.body.data.request, b.body.data.request);
    assert.deepEqual(a.body.data.request.nodes.nodeIds, ['s1', 's2']);
  });

  it('accepts all-nodes mode and a single-day range', async () => {
    const { app } = build({ startReport: PENDING });
    const res = await post(
      app,
      valid({ nodes: { mode: 'all' }, startDate: '20261108', endDate: '20261108' }),
    );
    assert.equal(res.status, 202);
    assert.deepEqual(res.body.data.request.nodes.nodeIds, ['s1', 's2', 's3']);
  });
});

describe('POST /api/v1/reports: feature gate', () => {
  it('validates but creates nothing and returns 501 when execution is not enabled', async () => {
    const { app, calls } = build();
    const res = await post(app, valid());
    assert.equal(res.status, 501);
    assert.equal(res.body.error.code, 'REPORT_EXECUTION_NOT_ENABLED');
    assert.equal(res.body.error.details.reportCreated, false);
    assert.equal(res.body.error.details.validated, true);
    assert.equal(res.body.error.details.request.productCount, 2);
    assert.equal(res.body.error.details.request.nodeCount, 3);
    assert.equal(res.body.data, undefined);
    assert.equal(JSON.stringify(res.body).includes('reportId'), false);
    assert.equal(calls.start, 0);
  });

  it('still rejects an invalid request with 400 while gated', async () => {
    const { app } = build();
    const res = await post(app, valid({ cachePolicy: 'nope' }));
    assert.equal(res.status, 400);
  });

  it('never reports a status other than pending, even if execution says completed', async () => {
    const { app } = build({ startReport: async () => ({ reportId: 'r', status: 'completed' }) });
    const res = await post(app, valid());
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(res.body).includes('completed'), false);
  });

  it('rejects an execution answer without a report ID', async () => {
    const { app } = build({ startReport: async () => ({ status: 'pending' }) });
    assert.equal((await post(app, valid())).status, 500);
  });
});

describe('POST /api/v1/reports: bad input is rejected before any lookup', () => {
  const cases = {
    'missing body': undefined,
    'array body': [],
    'string body': '"x"',
    'null body': null,
    'unknown top-level field': valid({ extra: 1 }),
    '__proto__ field': JSON.parse('{"__proto__":{"polluted":true}}'),
    'missing startDate': valid({ startDate: undefined }),
    'missing endDate': valid({ endDate: undefined }),
    'dashed date': valid({ startDate: '2026-11-01' }),
    'numeric date': valid({ startDate: 20261101 }),
    'impossible date': valid({ startDate: '20261131' }),
    'month 13': valid({ startDate: '20261301' }),
    'leap day in a non-leap year': valid({ startDate: '20250229', endDate: '20250301' }),
    'reversed range': valid({ startDate: '20261107', endDate: '20261101' }),
    'future end date': valid({ endDate: '20261109' }),
    'future start date': valid({ startDate: '20271231', endDate: '20271231' }),
    'range over the cap': valid({ startDate: '20260101', endDate: '20261107' }),
    'missing productIds': valid({ productIds: undefined }),
    'empty productIds': valid({ productIds: [] }),
    'productIds not an array': valid({ productIds: 'p1' }),
    'productIds object': valid({ productIds: { 0: 'p1' } }),
    'non-string product id': valid({ productIds: ['p1', 7] }),
    'null product id': valid({ productIds: [null] }),
    'blank product id': valid({ productIds: ['  '] }),
    'control character in id': valid({ productIds: ['p1\u0000'] }),
    'newline in id': valid({ productIds: ['p1\nx'] }),
    'oversized id': valid({ productIds: ['x'.repeat(201)] }),
    'too many products': valid({
      productIds: Array.from({ length: 2001 }, (_, i) => `p${i}`),
    }),
    'duplicates cannot dodge the product cap': valid({ productIds: Array(2001).fill('p1') }),
    'missing nodes': valid({ nodes: undefined }),
    'nodes not an object': valid({ nodes: 'all' }),
    'nodes array': valid({ nodes: [] }),
    'unknown nodes mode': valid({ nodes: { mode: 'regions' } }),
    'missing nodes mode': valid({ nodes: { nodeIds: ['s1'] } }),
    'unknown nodes field': valid({ nodes: { mode: 'all', extra: true } }),
    'all with nodeIds': valid({ nodes: { mode: 'all', nodeIds: ['s1'] } }),
    'all with brandIds': valid({ nodes: { mode: 'all', brandIds: ['B1'] } }),
    'brands with nodeIds': valid({ nodes: { mode: 'brands', brandIds: ['B1'], nodeIds: ['s1'] } }),
    'nodes with brandIds': valid({ nodes: { mode: 'nodes', nodeIds: ['s1'], brandIds: ['B1'] } }),
    'brands without brandIds': valid({ nodes: { mode: 'brands' } }),
    'brands with empty list': valid({ nodes: { mode: 'brands', brandIds: [] } }),
    'nodes without nodeIds': valid({ nodes: { mode: 'nodes' } }),
    'too many node ids': valid({
      nodes: { mode: 'nodes', nodeIds: Array.from({ length: 1001 }, (_, i) => `n${i}`) },
    }),
    'bad node id': valid({ nodes: { mode: 'nodes', nodeIds: [{}] } }),
    'missing cachePolicy': valid({ cachePolicy: undefined }),
    'unknown cachePolicy': valid({ cachePolicy: 'always' }),
    'cachePolicy wrong case': valid({ cachePolicy: 'USE_CACHE' }),
    'cachePolicy not a string': valid({ cachePolicy: true }),
  };

  for (const [name, body] of Object.entries(cases)) {
    it(`400 INVALID_REPORT_REQUEST: ${name}`, async () => {
      const { app, calls } = build({ startReport: PENDING });
      const req = request(app).post('/api/v1/reports');
      const res = await (body === undefined ? req : req.send(body));
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'INVALID_REPORT_REQUEST');
      assert.ok(Object.keys(res.body.error.details.fields).length >= 1);
      assert.deepEqual(calls, { nodes: 0, catalog: 0, start: 0 });
    });
  }

  it('lists every invalid field, not just the first, and never echoes input', async () => {
    const { app } = build({ startReport: PENDING });
    const secret = 'SECRET-DO-NOT-ECHO';
    const res = await post(app, {
      startDate: secret,
      endDate: '20261301',
      productIds: [secret, 3],
      nodes: { mode: secret },
      cachePolicy: secret,
    });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.error.details.fields).sort(), [
      'cachePolicy',
      'endDate',
      'nodes.mode',
      'productIds',
      'startDate',
    ]);
    assert.equal(JSON.stringify(res.body).includes(secret), false);
  });

  it('truncates the name of an unknown field in the message', async () => {
    const { app } = build({ startReport: PENDING });
    const res = await post(app, valid({ ['x'.repeat(500)]: 1 }));
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.fields.body.length < 100);
  });

  it('rejects unknown query parameters', async () => {
    const { app } = build({ startReport: PENDING });
    const res = await request(app).post('/api/v1/reports?dryRun=1').send(valid());
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_QUERY');
  });

  it('rejects malformed JSON and oversized bodies without leaking parser details', async () => {
    const { app } = build({ startReport: PENDING });
    const bad = await request(app)
      .post('/api/v1/reports')
      .set('Content-Type', 'application/json')
      .send('{bad');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_JSON');
    const big = await request(app)
      .post('/api/v1/reports')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify(
          valid({ productIds: ['x'.repeat(190)].concat(Array(600).fill('y'.repeat(190))) }),
        ),
      );
    assert.equal(big.status, 413);
  });

  it('treats form-encoded and text bodies as missing JSON (400)', async () => {
    const { app } = build({ startReport: PENDING });
    const res = await request(app).post('/api/v1/reports').type('form').send('startDate=20261101');
    assert.equal(res.status, 400);
  });
});

describe('POST /api/v1/reports: well-formed but unacceptable (422)', () => {
  it('rejects unknown products with their ids', async () => {
    const { app, calls } = build({ startReport: PENDING });
    const res = await post(app, valid({ productIds: ['p1', 'ghost', 'alsoGhost'] }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'UNKNOWN_PRODUCT');
    assert.deepEqual(res.body.error.details.unknownIds, ['alsoGhost', 'ghost']);
    assert.equal(calls.start, 0);
  });

  it('rejects unknown nodes and brands (stale mapping), never dropping them', async () => {
    const { app, calls } = build({ startReport: PENDING });
    const node422 = await post(app, valid({ nodes: { mode: 'nodes', nodeIds: ['s1', 'gone'] } }));
    assert.equal(node422.status, 422);
    assert.equal(node422.body.error.code, 'UNKNOWN_NODE');
    assert.deepEqual(node422.body.error.details.unknownIds, ['gone']);
    const brand422 = await post(app, valid({ nodes: { mode: 'brands', brandIds: ['B9'] } }));
    assert.equal(brand422.body.error.code, 'UNKNOWN_BRAND');
    assert.equal(calls.start, 0);
  });

  it('rejects "all nodes" when there are no nodes', async () => {
    const { app } = build({ nodes: [], startReport: PENDING });
    const res = await post(app, valid({ nodes: { mode: 'all' } }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NO_NODES');
  });

  it('rejects "all nodes" when the node list is incomplete', async () => {
    const { app, calls } = build({
      nodeMeta: { ...NODE_META, complete: false },
      startReport: PENDING,
    });
    const res = await post(app, valid({ nodes: { mode: 'all' } }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NODE_LIST_INCOMPLETE');
    assert.equal(calls.start, 0);
    const brands = await post(app, valid());
    assert.equal(brands.status, 202, 'an explicit selection is still fine');
  });

  it('caps the workload by node count and by node-days', async () => {
    const byNodes = build({
      limits: { ...DEFAULT_REPORT_LIMITS, maxNodes: 2 },
      startReport: PENDING,
    });
    const tooManyNodes = await post(byNodes.app, valid({ nodes: { mode: 'all' } }));
    assert.equal(tooManyNodes.status, 422);
    assert.equal(tooManyNodes.body.error.code, 'WORKLOAD_TOO_LARGE');
    assert.equal(tooManyNodes.body.error.details.nodeCount, 3);

    const byDays = build({
      limits: { ...DEFAULT_REPORT_LIMITS, maxNodeDays: 20 },
      startReport: PENDING,
    });
    // 3 nodes x 7 days = 21 > 20; 3 x 6 = 18 passes (the cap is inclusive).
    const over = await post(byDays.app, valid({ nodes: { mode: 'all' } }));
    assert.equal(over.status, 422);
    assert.equal(over.body.error.details.nodeDays, 21);
    const at = await post(
      byDays.app,
      valid({ nodes: { mode: 'all' }, startDate: '20261102', endDate: '20261107' }),
    );
    assert.equal(at.status, 202);
    assert.equal(byDays.calls.start, 1);
  });

  it('accepts exactly the maximum range and rejects one day more', async () => {
    const limits = { ...DEFAULT_REPORT_LIMITS, maxRangeDays: 7 };
    const { app } = build({ limits, startReport: PENDING });
    const at = await post(app, valid({ startDate: '20261101', endDate: '20261107' }));
    assert.equal(at.status, 202);
    const over = await post(app, valid({ startDate: '20261031', endDate: '20261107' }));
    assert.equal(over.status, 400);
    assert.match(over.body.error.details.fields.endDate, /maximum is 7 days/);
  });

  it('judges "today" in Africa/Harare, not UTC', async () => {
    // 2026-11-08T23:30Z is already 2026-11-09 01:30 in Harare (UTC+2).
    const reports = createReportsService({
      catalogService: {
        async validateProductIds({ productIds }) {
          return { items: { productIds }, meta: {} };
        },
      },
      nodeFiltersService: createNodeFiltersService({
        nodesService: { listAllNodes: async () => ({ nodes: NODES, meta: NODE_META }) },
      }),
      startReport: PENDING,
      now: () => new Date('2026-11-08T23:30:00Z'),
    });
    const app = createApp(loadConfig({ NODE_ENV: 'test' }), { reports });
    const harareToday = await post(app, valid({ startDate: '20261109', endDate: '20261109' }));
    assert.equal(harareToday.status, 202);
    const tomorrow = await post(app, valid({ startDate: '20261110', endDate: '20261110' }));
    assert.equal(tomorrow.status, 400);
  });
});

describe('POST /api/v1/reports: dependency failures', () => {
  it('maps a GAAP failure while loading nodes to 503 and creates nothing', async () => {
    const { app, calls } = build({
      nodesFail: new GaapError({ code: GAAP_ERROR_CODES.UNAVAILABLE, message: 'down' }),
      startReport: PENDING,
    });
    const res = await post(app, valid());
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'GAAP_UNAVAILABLE');
    assert.equal(calls.start, 0);
  });

  it('turns an unexpected failure into a generic 500 without leaking the message', async () => {
    const { app, calls } = build({
      catalogFail: new Error('mongodb://user:Sup3rSecret@host exploded'),
      startReport: PENDING,
    });
    const res = await post(app, valid());
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(res.body).includes('Sup3rSecret'), false);
    assert.equal(calls.start, 0);
  });

  it('is not mounted when the reports service is absent', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test' }), {});
    assert.equal((await post(app, valid())).status, 404);
  });

  it('answers only GET (list) and POST on /reports; other methods are 404', async () => {
    const { app } = build({ startReport: PENDING });
    assert.equal((await request(app).delete('/api/v1/reports')).status, 404);
    assert.equal((await request(app).put('/api/v1/reports')).status, 404);
    assert.equal((await request(app).patch('/api/v1/reports')).status, 404);
  });

  it('maps a full runner to 503 REPORT_QUEUE_FULL and an unverified-rules block to 422', async () => {
    const full = build({
      startReport: async () => {
        throw new ReportBusyError();
      },
    });
    const busy = await post(full.app, valid());
    assert.equal(busy.status, 503);
    assert.equal(busy.body.error.code, 'REPORT_QUEUE_FULL');

    const blocked = build({
      startReport: async () => {
        throw new ReportRejectedError('ELIGIBILITY_RULES_UNVERIFIED', 'Rules unverified.');
      },
    });
    const res = await post(blocked.app, valid());
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'ELIGIBILITY_RULES_UNVERIFIED');
  });
});

describe('GET /api/v1/reports/:reportId/status (FIXTURE reader, stub)', () => {
  const ID = 'a'.repeat(24);
  const status = (overrides = {}) => ({
    reportId: ID,
    status: 'failed',
    error: { code: 'SOURCE_INCOMPLETE', message: 'GAAP data could not be fetched completely.' },
    ...overrides,
  });

  it('returns the lifecycle, including a failure reason', async () => {
    const { app } = build({ getReportStatus: async () => status() });
    const res = await request(app).get(`/api/v1/reports/${ID}/status`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'failed');
    assert.equal(res.body.data.error.code, 'SOURCE_INCOMPLETE');
  });

  it('404s an unknown report and 400s a malformed id or query without reading', async () => {
    let reads = 0;
    const { app } = build({
      getReportStatus: async () => {
        reads += 1;
        return null;
      },
    });
    const missing = await request(app).get(`/api/v1/reports/${ID}/status`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REPORT_NOT_FOUND');
    reads = 0;
    assert.equal((await request(app).get('/api/v1/reports/nope/status')).status, 400);
    assert.equal((await request(app).get(`/api/v1/reports/${ID}/status?x=1`)).status, 400);
    assert.equal(reads, 0);
  });
});
