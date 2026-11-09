/**
 * `GET /api/v1/reports` (Saved Reports list) tests. The repository is a FIXTURE stub (no MongoDB, no
 * GAAP): this proves routing, query validation and the response envelope, not persistence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createReportsService } from '../modules/reports/index.js';

function build(listReports) {
  const reports = createReportsService({
    catalogService: {},
    nodeFiltersService: {},
    listReports,
  });
  return createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    reports,
  });
}

function stub(total = 45) {
  const seen = [];
  const listReports = async (query) => {
    seen.push(query);
    const count = Math.max(0, Math.min(query.limit, total - query.offset));
    return {
      items: Array.from({ length: count }, (_, i) => ({
        reportId: `r${query.offset + i}`,
        status: 'completed',
      })),
      total,
    };
  };
  return { listReports, seen };
}

const get = (app, query = '') => request(app).get(`/api/v1/reports${query}`);

describe('GET /api/v1/reports (FIXTURE repository stub, no MongoDB)', () => {
  it('returns a default page with pagination, sort and status meta', async () => {
    const { listReports, seen } = stub();
    const res = await get(build(listReports));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 20);
    assert.deepEqual(res.body.meta.pagination, {
      total: 45,
      limit: 20,
      offset: 0,
      returned: 20,
      hasMore: true,
    });
    assert.deepEqual(res.body.meta.sort, { field: 'createdAt', order: 'desc' });
    assert.equal(res.body.meta.status, null);
    assert.deepEqual(seen[0], { sort: 'createdAt', order: 'desc', limit: 20, offset: 0 });
  });

  it('pages through every report exactly once and ends without hasMore', async () => {
    const app = build(stub(45).listReports);
    const ids = [];
    let offset = 0;
    for (;;) {
      const res = await get(app, `?limit=20&offset=${offset}`);
      ids.push(...res.body.data.map((r) => r.reportId));
      if (!res.body.meta.pagination.hasMore) break;
      offset += 20;
    }
    assert.equal(ids.length, 45);
    assert.equal(new Set(ids).size, 45);
  });

  it('answers an offset past the end with an empty page, not an error', async () => {
    const res = await get(build(stub(3).listReports), '?offset=50');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.pagination.total, 3);
    assert.equal(res.body.meta.pagination.hasMore, false);
  });

  it('answers an empty list when no report exists', async () => {
    const res = await get(build(stub(0).listReports));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.pagination.total, 0);
  });

  it('passes valid status, sort and order through', async () => {
    const { listReports, seen } = stub();
    const res = await get(
      build(listReports),
      '?status=failed&sort=startDate&order=asc&limit=5&offset=10',
    );
    assert.equal(res.status, 200);
    assert.deepEqual(seen[0], {
      status: 'failed',
      sort: 'startDate',
      order: 'asc',
      limit: 5,
      offset: 10,
    });
    assert.equal(res.body.meta.status, 'failed');
  });

  it('rejects invalid queries with 400 INVALID_QUERY before reading anything', async () => {
    const { listReports, seen } = stub();
    const app = build(listReports);
    const bad = [
      '?limit=0',
      '?limit=101',
      '?limit=abc',
      '?limit=-1',
      '?limit=1.5',
      '?limit=1&limit=2',
      '?offset=-1',
      '?status=done',
      '?sort=turnover',
      '?sort=__proto__',
      '?order=up',
      '?foo=bar',
    ];
    for (const query of bad) {
      const res = await get(app, query);
      assert.equal(res.status, 400, query);
      assert.equal(res.body.error.code, 'INVALID_QUERY', query);
    }
    assert.equal(seen.length, 0);
  });

  it('answers 500 without detail when the store fails', async () => {
    const app = build(async () => {
      throw new Error('mongodb://user:secret@host exploded');
    });
    const res = await get(app);
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /secret|mongodb:/);
  });
});
