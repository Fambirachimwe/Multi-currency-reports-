/**
 * `GET /api/v1/nodes` integration tests. The full backend stack (route -> controller -> catalog
 * service -> nodes adapter -> real GAAP client -> Axios) runs, but Axios uses a scripted FIXTURE
 * adapter, so no network is touched. This is NOT live GAAP evidence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createNodesService } from '../modules/catalog/index.js';
import { memoryRepository } from '../modules/catalog/support/memory-repository.js';
import {
  FIXTURE_ID,
  MIXED_NODES,
  fixturePage,
  fixtureStore,
} from '../modules/gaap/fixtures/nodes.fixture.js';
import { createGaapClient } from '../modules/gaap/gaap.client.js';
import { loadGaapConfig } from '../modules/gaap/gaap.config.js';
import { createNodesAdapter } from '../modules/gaap/nodes.adapter.js';

const KEY = 'fixture-secret-key-0002';
const quietLogger = { info() {}, warn() {}, error() {} };

/** steps: { status, data } | { error: 'timeout' | 'network' }; the last step repeats. */
function buildApp(steps) {
  const calls = [];
  const adapter = async (config) => {
    calls.push({ url: config.url, params: { ...config.params } });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step.error === 'timeout') {
      throw new axios.AxiosError(`timeout ${KEY}`, 'ECONNABORTED', config);
    }
    if (step.error === 'network') {
      throw new axios.AxiosError(`connect ECONNREFUSED ?apikey=${KEY}`, 'ECONNREFUSED', config);
    }
    const response = {
      status: step.status,
      statusText: '',
      data: step.data,
      headers: {},
      config,
      request: {},
    };
    if (step.status >= 400) {
      throw new axios.AxiosError(`failed ?apikey=${KEY}`, 'ERR_BAD_RESPONSE', config, {}, response);
    }
    return response;
  };
  const client = createGaapClient({
    config: loadGaapConfig({
      GAAP_API_KEY: KEY,
      GAAP_API_BASE_URL: 'https://gaap.test',
      GAAP_MAX_RETRIES: '1',
      GAAP_RETRY_BASE_DELAY_MS: '0',
    }),
    logger: quietLogger,
    adapter,
    sleep: async () => {},
    random: () => 0,
  });
  const repository = memoryRepository();
  const nodes = createNodesService({
    nodesAdapter: createNodesAdapter({ client }),
    repository,
    logger: quietLogger,
  });
  const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    nodes,
  });
  return { app, calls, repository };
}

const OK = { status: 200, data: fixturePage(MIXED_NODES) };

function assertNoLeak(res) {
  const text = JSON.stringify(res.body) + JSON.stringify(res.headers);
  assert.ok(!text.includes(KEY), 'the API key leaked');
  assert.ok(!/apikey/i.test(text), 'apikey leaked');
  assert.ok(!/gaap\.test/.test(text), 'the upstream host leaked');
}

describe('GET /api/v1/nodes (FIXTURE GAAP, not live)', () => {
  it('returns normalized, sorted nodes in the success envelope with provenance', async () => {
    const { app, calls } = buildApp([OK]);
    const res = await request(app).get('/api/v1/nodes');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((n) => n.name),
      ['Group 1', 'Store 010', 'Store 011', 'Store 012'],
    );
    assert.equal(res.body.data[0].id, FIXTURE_ID(1));
    assert.equal(res.body.meta.source, 'GAAP_UNITY');
    assert.equal(res.body.meta.complete, true);
    assert.equal(res.body.meta.total, 4);
    assert.equal(res.body.meta.returned, 4);
    assert.equal(res.body.meta.malformedCount, 0);
    assert.ok(!Number.isNaN(Date.parse(res.body.meta.fetchedAt)));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/nodes');
    assert.equal(calls[0].params.limit, 1000);
    assertNoLeak(res);
  });

  it('returns identical data on repeated requests (consistent order)', async () => {
    const { app } = buildApp([OK]);
    const first = await request(app).get('/api/v1/nodes');
    const second = await request(app).get('/api/v1/nodes');
    assert.deepEqual(first.body.data, second.body.data);
  });

  it('exposes no brand field', async () => {
    const { app } = buildApp([
      { status: 200, data: fixturePage([fixtureStore(10, { brand: 'X' })]) },
    ]);
    const res = await request(app).get('/api/v1/nodes');
    assert.ok(!('brand' in res.body.data[0]));
    assert.ok(!JSON.stringify(res.body).includes('"X"'));
  });

  it('paginates the normalized list with limit and offset', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get('/api/v1/nodes?limit=2&offset=1');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((n) => n.name),
      ['Store 010', 'Store 011'],
    );
    assert.equal(res.body.meta.limit, 2);
    assert.equal(res.body.meta.offset, 1);
    assert.equal(res.body.meta.total, 4);
    assert.equal(res.body.meta.returned, 2);
  });

  it('returns an empty page (not an error) when offset is past the end', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get('/api/v1/nodes?offset=100');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.total, 4);
  });

  it('returns 200 with an empty list when GAAP has no nodes', async () => {
    const { app } = buildApp([{ status: 200, data: fixturePage([], 0) }]);
    const res = await request(app).get('/api/v1/nodes');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.total, 0);
    assert.equal(res.body.meta.complete, true);
  });

  it('flags malformed records in meta and still returns the valid ones', async () => {
    const records = [
      fixtureStore(10),
      null,
      { tradingDetails: { name: 'No id' } },
      fixtureStore(10),
    ];
    const { app } = buildApp([{ status: 200, data: fixturePage(records) }]);
    const res = await request(app).get('/api/v1/nodes');

    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.meta.malformedCount, 3);
    assert.deepEqual(
      res.body.meta.malformed.map((m) => m.reason),
      ['NOT_AN_OBJECT', 'MISSING_ID', 'DUPLICATE_ID'],
    );
    assert.ok(!JSON.stringify(res.body).includes('No id'), 'malformed payload must not be echoed');
  });

  it('reports node-level warnings in the data and a count in meta', async () => {
    const { app } = buildApp([
      {
        status: 200,
        data: fixturePage([fixtureStore(10, { tradingDetails: {} }), fixtureStore(11)]),
      },
    ]);
    const res = await request(app).get('/api/v1/nodes');
    assert.equal(res.body.meta.warningCount, 1);
    const unnamed = res.body.data.find((n) => n.id === FIXTURE_ID(10));
    assert.deepEqual(unnamed.warnings, ['MISSING_NAME']);
    assert.equal(unnamed.name, null);
  });

  it('marks the result incomplete when GAAP reports more records than were returned', async () => {
    const { app } = buildApp([
      { status: 200, data: fixturePage([fixtureStore(10)], 3) },
      { status: 200, data: fixturePage([], 3) },
    ]);
    // Short first page with a larger total: adapter pages once more, gets nothing, stops.
    const res = await request(app).get('/api/v1/nodes');
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.complete, false);
    assert.equal(res.body.meta.upstreamTotal, 3);
  });

  describe('input validation', () => {
    for (const [label, query] of [
      ['limit=0', 'limit=0'],
      ['limit above the maximum', 'limit=1001'],
      ['negative limit', 'limit=-1'],
      ['non-numeric limit', 'limit=abc'],
      ['decimal limit', 'limit=1.5'],
      ['empty limit', 'limit='],
      ['negative offset', 'offset=-1'],
      ['non-numeric offset', 'offset=x'],
      ['repeated limit', 'limit=1&limit=2'],
      ['unknown parameter', 'brand=abc'],
      ['apikey smuggling', 'apikey=abc'],
      ['bracketed parameter', 'limit[a]=1'],
    ]) {
      it(`rejects ${label} with 400 INVALID_QUERY and never calls GAAP`, async () => {
        const { app, calls } = buildApp([OK]);
        const res = await request(app).get(`/api/v1/nodes?${query}`);

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'INVALID_QUERY');
        assert.equal(typeof res.body.error.requestId, 'string');
        assert.equal(calls.length, 0);
      });
    }

    it('accepts the boundary values', async () => {
      const { app } = buildApp([OK]);
      assert.equal((await request(app).get('/api/v1/nodes?limit=1')).status, 200);
      assert.equal((await request(app).get('/api/v1/nodes?limit=1000&offset=0')).status, 200);
    });
  });

  describe('unavailable or broken GAAP', () => {
    const cases = [
      ['timeouts', { error: 'timeout' }, 504, 'GAAP_TIMEOUT'],
      ['network errors', { error: 'network' }, 503, 'GAAP_UNAVAILABLE'],
      ['503 responses', { status: 503, data: {} }, 503, 'GAAP_UNAVAILABLE'],
      ['429 responses', { status: 429, data: {} }, 503, 'GAAP_UNAVAILABLE'],
      ['401 responses', { status: 401, data: {} }, 502, 'GAAP_UPSTREAM_ERROR'],
      ['403 responses', { status: 403, data: {} }, 502, 'GAAP_UPSTREAM_ERROR'],
      ['404 responses', { status: 404, data: {} }, 502, 'GAAP_UPSTREAM_ERROR'],
      ['500 responses', { status: 500, data: {} }, 502, 'GAAP_UPSTREAM_ERROR'],
      [
        'a body without a data array',
        { status: 200, data: { totalRecords: 1 } },
        502,
        'GAAP_UPSTREAM_ERROR',
      ],
      ['an array body', { status: 200, data: [] }, 502, 'GAAP_UPSTREAM_ERROR'],
    ];
    for (const [label, step, status, code] of cases) {
      it(`maps ${label} to ${status} ${code} without leaking upstream details`, async () => {
        const { app } = buildApp([step]);
        const res = await request(app).get('/api/v1/nodes');

        assert.equal(res.status, status);
        assert.equal(res.body.error.code, code);
        assert.equal(res.body.data, undefined);
        assert.equal(typeof res.body.error.requestId, 'string');
        assertNoLeak(res);
      });
    }

    it('recovers from one transient failure through the client retry', async () => {
      const { app, calls } = buildApp([{ status: 503, data: {} }, OK]);
      const res = await request(app).get('/api/v1/nodes');
      assert.equal(res.status, 200);
      assert.equal(calls.length, 2);
    });
  });

  describe('stored in the database', () => {
    it('serves later requests from the database with no further GAAP call', async () => {
      const { app, calls, repository } = buildApp([OK]);
      const first = await request(app).get('/api/v1/nodes');
      assert.equal(first.body.meta.origin, 'gaap');
      assert.equal(first.body.meta.persisted, true);
      assert.equal(repository.state.saves, 1);

      const reload = await request(app).get('/api/v1/nodes');
      assert.equal(reload.status, 200);
      assert.equal(reload.body.meta.origin, 'database');
      assert.equal(reload.body.meta.cacheFreshness, 'fresh');
      assert.deepEqual(reload.body.data, first.body.data);
      assert.equal(calls.length, 1, 'GAAP must not be called again');
    });

    it('POST /nodes/refresh calls GAAP again and replaces the stored nodes', async () => {
      const { app, calls } = buildApp([OK]);
      await request(app).get('/api/v1/nodes');
      const refreshed = await request(app).post('/api/v1/nodes/refresh');
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.body.meta.origin, 'gaap');
      assert.equal(calls.length, 2);
      assert.equal((await request(app).get('/api/v1/nodes')).body.meta.origin, 'database');
      assert.equal(calls.length, 2);
    });

    it('a failed refresh returns the GAAP error but keeps the stored nodes', async () => {
      const { app } = buildApp([OK, { status: 401, data: {} }]);
      await request(app).get('/api/v1/nodes');
      const refreshed = await request(app).post('/api/v1/nodes/refresh');
      assert.equal(refreshed.status, 502);
      assertNoLeak(refreshed);
      const after = await request(app).get('/api/v1/nodes');
      assert.equal(after.status, 200);
      assert.equal(after.body.meta.origin, 'database');
      assert.equal(after.body.data.length, 4);
    });

    it('validates refresh query parameters too', async () => {
      const { app, calls } = buildApp([OK]);
      const res = await request(app).post('/api/v1/nodes/refresh?limit=0');
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0);
    });

    it('never stores or returns secrets present in raw GAAP node records', async () => {
      const record = fixtureStore(10, {
        integrationConfig: [
          {
            type: 'x',
            config: { client_secret: 'FIXTURE-SECRET-VALUE', password: 'FIXTURE-PASSWORD' },
          },
        ],
      });
      const { app, repository } = buildApp([{ status: 200, data: fixturePage([record]) }]);
      const res = await request(app).get('/api/v1/nodes');
      const everything = JSON.stringify(res.body) + JSON.stringify(repository.state.stored);
      assert.ok(!everything.includes('FIXTURE-SECRET-VALUE'));
      assert.ok(!everything.includes('FIXTURE-PASSWORD'));
    });
  });

  it('does not mount the route when no nodes service is provided', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }));
    const res = await request(app).get('/api/v1/nodes');
    assert.equal(res.status, 404);
  });
});
