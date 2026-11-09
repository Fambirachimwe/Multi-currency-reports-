/**
 * `/api/v1/catalog` integration tests. Route -> controller -> service -> real catalog adapter ->
 * real GAAP client -> Axios with a scripted FIXTURE adapter, so no network is touched.
 * This is NOT live GAAP evidence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createCatalogService } from '../modules/catalog/index.js';
import { catalogMemoryRepository } from '../modules/catalog/support/catalog-memory-repository.js';
import { createCatalogAdapter } from '../modules/gaap/catalog.adapter.js';
import {
  MIXED_PRODUCTS,
  dept,
  fixturePage,
  fixtureProduct,
} from '../modules/gaap/fixtures/catalog.fixture.js';
import { createGaapClient } from '../modules/gaap/gaap.client.js';
import { loadGaapConfig } from '../modules/gaap/gaap.config.js';

const KEY = 'fixture-secret-key-0009';
const quietLogger = { info() {}, warn() {}, error() {} };

function buildApp(steps) {
  const calls = [];
  const adapter = async (config) => {
    calls.push({ url: config.url, params: { ...config.params } });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step.error === 'timeout') {
      throw new axios.AxiosError(`timeout ${KEY}`, 'ECONNABORTED', config);
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
      GAAP_MAX_RETRIES: '0',
      GAAP_RETRY_BASE_DELAY_MS: '0',
    }),
    logger: quietLogger,
    adapter,
    sleep: async () => {},
    random: () => 0,
  });
  const catalog = createCatalogService({
    catalogAdapter: createCatalogAdapter({ client }),
    repository: catalogMemoryRepository(),
    logger: quietLogger,
  });
  const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    catalog,
  });
  return { app, calls };
}

const OK = { status: 200, data: fixturePage(MIXED_PRODUCTS) };
const EMPTY = { status: 200, data: fixturePage([]) };
const BASE = '/api/v1/catalog';

describe('GET /api/v1/catalog/departments (FIXTURE GAAP)', () => {
  it('returns sorted departments with the standard envelope and complete labelling', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get(`${BASE}/departments`).expect(200);

    assert.deepEqual(
      res.body.data.map((d) => d.id),
      ['FX-DEPT-1', 'FX-DEPT-2'],
    );
    assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
      'groupId',
      'groupName',
      'id',
      'name',
      'productCount',
      'warnings',
    ]);
    assert.equal(res.body.meta.complete, true);
    assert.equal(res.body.meta.derivation, 'PRODUCTS_ENDPOINT');
    assert.equal(res.body.meta.unmappedProductCount, 1);
    assert.ok(!(JSON.stringify(res.body) + JSON.stringify(res.headers)).includes(KEY));
  });

  it('calls GAAP once, then serves from storage; POST refresh calls it again', async () => {
    const { app, calls } = buildApp([OK]);
    await request(app).get(`${BASE}/departments`).expect(200);
    await request(app).get(`${BASE}/departments`).expect(200);
    await request(app).get(`${BASE}/products/unmapped`).expect(200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/products');
    await request(app).post(`${BASE}/refresh`).expect(200);
    assert.equal(calls.length, 2);
  });

  it('paginates', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get(`${BASE}/departments?limit=1&offset=1`).expect(200);
    assert.deepEqual(
      res.body.data.map((d) => d.id),
      ['FX-DEPT-2'],
    );
    assert.equal(res.body.meta.total, 2);
    assert.equal(res.body.meta.returned, 1);
  });

  it('returns 200 with an empty list for an empty catalog', async () => {
    const { app } = buildApp([EMPTY]);
    const res = await request(app).get(`${BASE}/departments`).expect(200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.complete, true);
  });

  it('rejects invalid pagination with 400 INVALID_QUERY and never calls GAAP', async () => {
    const { app, calls } = buildApp([OK]);
    for (const qs of [
      'limit=0',
      'limit=1001',
      'limit=abc',
      'offset=-1',
      'limit=1&limit=2',
      'x=1',
      'limit=1.5',
    ]) {
      const res = await request(app).get(`${BASE}/departments?${qs}`).expect(400);
      assert.equal(res.body.error.code, 'INVALID_QUERY');
    }
    assert.equal(calls.length, 0);
  });

  it('maps GAAP failures to client-safe errors without leaking the key', async () => {
    const cases = [
      [{ error: 'timeout' }, 504, 'GAAP_TIMEOUT'],
      [{ status: 401, data: {} }, 502, 'GAAP_UPSTREAM_ERROR'],
      [{ status: 503, data: {} }, 503, 'GAAP_UNAVAILABLE'],
      [{ status: 200, data: { nope: true } }, 502, 'GAAP_UPSTREAM_ERROR'],
    ];
    for (const [step, status, code] of cases) {
      const { app } = buildApp([step]);
      const res = await request(app).get(`${BASE}/departments`).expect(status);
      assert.equal(res.body.error.code, code);
      assert.ok(!(JSON.stringify(res.body) + JSON.stringify(res.headers)).includes(KEY));
    }
  });
});

describe('GET /api/v1/catalog/departments/:departmentId/products (FIXTURE GAAP)', () => {
  it('returns the department products, sorted, with department context', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get(`${BASE}/departments/FX-DEPT-2/products`).expect(200);
    assert.deepEqual(
      res.body.data.map((p) => p.id),
      ['FX-PROD-2', 'FX-PROD-3'],
    );
    assert.equal(res.body.meta.department.id, 'FX-DEPT-2');
    assert.equal(res.body.meta.complete, true);
  });

  it('keeps product ids stable across calls and refreshes', async () => {
    const { app } = buildApp([OK]);
    const a = await request(app).get(`${BASE}/departments/FX-DEPT-2/products`).expect(200);
    await request(app).post(`${BASE}/refresh`).expect(200);
    const b = await request(app).get(`${BASE}/departments/FX-DEPT-2/products`).expect(200);
    assert.deepEqual(a.body.data, b.body.data);
  });

  it('paginates products', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app)
      .get(`${BASE}/departments/FX-DEPT-2/products?limit=1&offset=1`)
      .expect(200);
    assert.deepEqual(
      res.body.data.map((p) => p.id),
      ['FX-PROD-3'],
    );
    assert.equal(res.body.meta.total, 2);
  });

  it('returns 404 DEPARTMENT_NOT_FOUND for an unknown department', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get(`${BASE}/departments/nope/products`).expect(404);
    assert.equal(res.body.error.code, 'DEPARTMENT_NOT_FOUND');
  });

  it('returns 404 (not an empty 200) for any department when the catalog is empty', async () => {
    const { app } = buildApp([EMPTY]);
    await request(app).get(`${BASE}/departments/FX-DEPT-1/products`).expect(404);
  });

  it('rejects an invalid department id and bad paging with 400', async () => {
    const { app, calls } = buildApp([OK]);
    const long = 'x'.repeat(201);
    const res = await request(app).get(`${BASE}/departments/${long}/products`).expect(400);
    assert.equal(res.body.error.code, 'INVALID_DEPARTMENT_ID');
    await request(app).get(`${BASE}/departments/%01/products`).expect(400);
    await request(app).get(`${BASE}/departments/FX-DEPT-1/products?limit=0`).expect(400);
    assert.equal(calls.length, 0);
  });
});

describe('GET /api/v1/catalog/products/unmapped (FIXTURE GAAP)', () => {
  it('lists products with unknown department mapping, flagged', async () => {
    const { app } = buildApp([OK]);
    const res = await request(app).get(`${BASE}/products/unmapped`).expect(200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, 'FX-PROD-9');
    assert.equal(res.body.data[0].mapped, false);
    assert.deepEqual(res.body.data[0].warnings, ['UNMAPPED_DEPARTMENT']);
  });
});

describe('catalog routes mounting', () => {
  it('are not mounted when no catalog service is provided', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }));
    await request(app).get(`${BASE}/departments`).expect(404);
  });

  it('exposes no write methods other than the explicit refresh', async () => {
    const { app } = buildApp([OK]);
    for (const method of ['post', 'put', 'patch', 'delete']) {
      await request(app)[method](`${BASE}/departments`).expect(404);
    }
  });
});

describe('POST /api/v1/catalog/products/validate (FIXTURE GAAP)', () => {
  const validate = (app, body) => request(app).post(`${BASE}/products/validate`).send(body);

  it('accepts several products, returning unique ids sorted regardless of input order', async () => {
    const { app } = buildApp([OK]);
    const res = await validate(app, {
      productIds: ['FX-PROD-3', 'FX-PROD-1', 'FX-PROD-3', 'FX-PROD-9'],
    }).expect(200);
    assert.deepEqual(res.body.data, { productIds: ['FX-PROD-1', 'FX-PROD-3', 'FX-PROD-9'] });
    const again = await validate(app, {
      productIds: ['FX-PROD-9', 'FX-PROD-1', 'FX-PROD-3'],
    }).expect(200);
    assert.deepEqual(again.body.data, res.body.data);
  });

  it('rejects unknown ids with 422 and lists them; known ids are not silently kept', async () => {
    const { app } = buildApp([OK]);
    const res = await validate(app, { productIds: ['FX-PROD-1', 'NOPE-2', 'NOPE-1'] }).expect(422);
    assert.equal(res.body.error.code, 'UNKNOWN_PRODUCT');
    assert.deepEqual(res.body.error.details.unknownIds, ['NOPE-1', 'NOPE-2']);
  });

  it('rejects inactive and deleted products as unknown', async () => {
    const { app } = buildApp([
      {
        status: 200,
        data: fixturePage([
          fixtureProduct(1, [dept(1)]),
          fixtureProduct(2, [dept(1)], { status: false }),
          fixtureProduct(3, [dept(1)], { isDeleted: true }),
        ]),
      },
    ]);
    const res = await validate(app, { productIds: ['FX-PROD-1', 'FX-PROD-2', 'FX-PROD-3'] }).expect(
      422,
    );
    assert.deepEqual(res.body.error.details.unknownIds, ['FX-PROD-2', 'FX-PROD-3']);
  });

  it('rejects an empty selection and malformed bodies with 400 INVALID_SELECTION', async () => {
    const { app, calls } = buildApp([OK]);
    const bad = [
      {},
      { productIds: [] },
      { productIds: 'FX-PROD-1' },
      { productIds: [1] },
      { productIds: [''] },
      { productIds: ['  '] },
      { productIds: ['a\u0001b'] },
      { productIds: [null] },
      { productIds: ['FX-PROD-1'], extra: true },
      [],
    ];
    for (const body of bad) {
      const res = await validate(app, body).expect(400);
      assert.equal(res.body.error.code, 'INVALID_SELECTION', JSON.stringify(body));
    }
    await request(app)
      .post(`${BASE}/products/validate?x=1`)
      .send({ productIds: ['a'] })
      .expect(400);
    assert.equal(calls.length, 0, 'invalid input never reaches GAAP');
  });

  it('maps a GAAP failure on first load to a gateway error', async () => {
    const { app } = buildApp([{ status: 503, data: {} }]);
    const res = await validate(app, { productIds: ['FX-PROD-1'] });
    assert.equal(res.status, 503);
  });
});
