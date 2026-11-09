/**
 * `GET /api/v1/reports/:reportId/rows` tests. The repository is a FIXTURE stub (no MongoDB, no GAAP):
 * this proves routing, query validation, error mapping and the envelope, not persistence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createReportsService } from '../modules/reports/index.js';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function build(listReportRows) {
  const reports = createReportsService({
    catalogService: {},
    nodeFiltersService: {},
    listReportRows,
  });
  return createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    reports,
  });
}
const get = (app, path) => request(app).get(`/api/v1/reports/${path}`);

const PAGE = {
  completed: true,
  rows: [{ lineIndex: 0, productId: 'p1', currency: 'USD', quantity: '1', turnover: '2.5' }],
  total: 1,
  totals: [{ currency: 'USD', lineCount: 1, quantity: '1', turnover: '2.5' }],
  reportTotals: [{ currency: 'USD', lineCount: 1, quantity: '1', turnover: '2.5' }],
  rowCount: 1,
};

describe('GET /api/v1/reports/:reportId/rows (FIXTURE repository stub, no MongoDB)', () => {
  it('returns a page with pagination, sort, filters and totals; defaults are applied', async () => {
    const seen = [];
    const app = build(async (id, query) => {
      seen.push([id, query]);
      return PAGE;
    });
    const res = await get(app, `${ID}/rows`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, PAGE.rows);
    assert.deepEqual(seen, [[ID, { sort: 'lineIndex', order: 'asc', limit: 50, offset: 0 }]]);
    assert.deepEqual(res.body.meta.pagination, {
      total: 1,
      limit: 50,
      offset: 0,
      returned: 1,
      hasMore: false,
    });
    assert.deepEqual(res.body.meta.sort, { field: 'lineIndex', order: 'asc' });
    assert.deepEqual(res.body.meta.filters, {
      search: null,
      currency: null,
      productId: null,
      nodeId: null,
    });
    assert.deepEqual(res.body.meta.totals, PAGE.totals);
    assert.deepEqual(res.body.meta.reportTotals, PAGE.reportTotals);
    assert.equal(res.body.meta.reportRowCount, 1);
  });

  it('passes validated sort, filters and paging through and reports hasMore', async () => {
    const seen = [];
    const app = build(async (id, query) => {
      seen.push(query);
      return { ...PAGE, total: 120 };
    });
    const res = await get(
      app,
      `${ID}/rows?sort=turnover&order=desc&limit=10&offset=20&currency=ZWG&productId=p1&nodeId=n1&search=%20burger%20`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(seen[0], {
      sort: 'turnover',
      order: 'desc',
      limit: 10,
      offset: 20,
      currency: 'ZWG',
      search: 'burger',
      productId: 'p1',
      nodeId: 'n1',
    });
    assert.equal(res.body.meta.pagination.hasMore, true);
    assert.equal(res.body.meta.filters.search, 'burger');
  });

  it('answers 404 REPORT_NOT_FOUND for an unknown report', async () => {
    const res = await get(
      build(async () => null),
      `${ID}/rows`,
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'REPORT_NOT_FOUND');
  });

  it('answers 409 REPORT_NOT_COMPLETED for a pending or failed report', async () => {
    for (const status of ['pending', 'failed']) {
      const res = await get(
        build(async () => ({ completed: false, status })),
        `${ID}/rows`,
      );
      assert.equal(res.status, 409, status);
      assert.equal(res.body.error.code, 'REPORT_NOT_COMPLETED');
      assert.equal(res.body.error.details.status, status);
    }
  });

  it('rejects bad ids and every bad query before reading anything', async () => {
    const seen = [];
    const app = build(async (...args) => seen.push(args));
    for (const path of ['nope/rows', `${'g'.repeat(24)}/rows`, `${ID}x/rows`]) {
      const res = await get(app, path);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.error.code, 'INVALID_REPORT_ID', path);
    }
    const bad = [
      'sort=reportId',
      'sort=__proto__',
      'sort=$where',
      'sort=turnover&sort=currency',
      'order=sideways',
      'limit=0',
      'limit=201',
      'limit=-1',
      'limit=1.5',
      'limit=abc',
      'offset=-1',
      'offset=1000001',
      'currency=usd',
      'currency=US',
      'currency=%24ne',
      'search=',
      'search=%20%20',
      `search=${'x'.repeat(101)}`,
      'search=a%00b',
      'productId=',
      `productId=${'x'.repeat(201)}`,
      'nodeId=a&nodeId=b',
      'reportId=bbbbbbbbbbbbbbbbbbbbbbbb',
      'nodeId[$ne]=x',
      'refresh=1',
    ];
    for (const query of bad) {
      const res = await get(app, `${ID}/rows?${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(res.body.error.code, 'INVALID_QUERY', query);
    }
    assert.equal(seen.length, 0);
  });

  it('answers 500 without detail when the store fails', async () => {
    const app = build(async () => {
      throw new Error('mongodb://user:secret@host exploded');
    });
    const res = await get(app, `${ID}/rows`);
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /secret|mongodb:/);
  });
});
