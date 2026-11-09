/**
 * `GET /api/v1/reports/:reportId` tests. The repository is a FIXTURE stub (no MongoDB, no GAAP):
 * this proves routing, id validation, error mapping and the envelope, not persistence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createReportsService, SnapshotIntegrityError } from '../modules/reports/index.js';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function build(getReport) {
  const reports = createReportsService({ catalogService: {}, nodeFiltersService: {}, getReport });
  return createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    reports,
  });
}
const get = (app, path) => request(app).get(`/api/v1/reports/${path}`);

describe('GET /api/v1/reports/:reportId (FIXTURE repository stub, no MongoDB)', () => {
  it('returns the saved report as stored', async () => {
    const saved = {
      reportId: ID,
      status: 'completed',
      totals: [{ currency: 'USD', lineCount: 1, quantity: '1', turnover: '2.5' }],
      summary: { byProduct: [], byNode: [], warnings: [] },
    };
    const seen = [];
    const app = build(async (id) => {
      seen.push(id);
      return saved;
    });
    const res = await get(app, ID);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, saved);
    assert.deepEqual(seen, [ID]);
  });

  it('answers 404 REPORT_NOT_FOUND when no report exists', async () => {
    const res = await get(
      build(async () => null),
      ID,
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'REPORT_NOT_FOUND');
  });

  it('rejects malformed ids and unknown query parameters before reading anything', async () => {
    const seen = [];
    const app = build(async (id) => seen.push(id));
    for (const path of ['nope', 'a'.repeat(23), 'g'.repeat(24), `${ID}x`]) {
      const res = await get(app, path);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.error.code, 'INVALID_REPORT_ID', path);
    }
    const res = await get(app, `${ID}?refresh=1`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_QUERY');
    assert.equal(seen.length, 0);
  });

  it('hides integrity problem codes behind a safe 500', async () => {
    const app = build(async () => {
      throw new SnapshotIntegrityError(['CHECKSUM_MISMATCH']);
    });
    const res = await get(app, ID);
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'SNAPSHOT_INTEGRITY_ERROR');
    assert.doesNotMatch(JSON.stringify(res.body), /CHECKSUM/);
  });

  it('answers 500 without detail when the store fails', async () => {
    const app = build(async () => {
      throw new Error('mongodb://user:secret@host exploded');
    });
    const res = await get(app, ID);
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /secret|mongodb:/);
  });
});
