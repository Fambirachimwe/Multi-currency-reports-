/**
 * Saved Reports list tests against a real, isolated local MongoDB database (dropped afterwards).
 * Skipped when no MongoDB answers. Reports and rows are FIXTURES; this is persistence evidence only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { ensureModelIndexes } from '../../models/index.js';
import { ReportRow } from '../../models/report-row.model.js';
import { Report } from '../../models/report.model.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { createReportRepository } from './report.repository.js';

const skip = await skipUnlessMongo();

describe('report repository list (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  const repository = createReportRepository();

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });
  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  const at = (minutes) => new Date(Date.UTC(2026, 10, 8, 10, minutes));
  const base = (startDate, minutes) => ({
    filters: {
      startDate,
      endDate: startDate,
      productIds: ['p1', 'p2', 'p3'],
      brandIds: ['b1'],
      nodeIds: ['n1', 'n2'],
    },
    provenance: { source: 'GAAP_UNITY', usedCache: false, complete: true, fetchedAt: at(minutes) },
    createdAt: at(minutes),
    updatedAt: at(minutes),
  });

  it('is empty before any report exists', async () => {
    assert.deepEqual(await repository.list(), { items: [], total: 0 });
  });

  it('lists metadata only, newest first, with counts instead of id lists and no rows', async () => {
    // Seeded with the raw driver so createdAt is controlled; shapes match what the model stores.
    await Report.collection.insertMany([
      {
        ...base('20261101', 1),
        status: 'completed',
        totals: [{ currency: 'USD', lineCount: 1, quantity: '1', turnover: '1' }],
        rowCount: 1,
        calculationVersion: 'v1',
        completedAt: at(1),
        integrity: { rowsChecksum: 'a'.repeat(64) },
      },
      {
        ...base('20261102', 2),
        status: 'failed',
        failedAt: at(2),
        error: { code: 'GAAP_UNAVAILABLE', message: 'GAAP could not be reached.' },
      },
      { ...base('20261103', 3), status: 'pending' },
    ]);
    await ReportRow.collection.insertOne({ reportId: 'x', lineIndex: 0 });

    const { items, total } = await repository.list();
    assert.equal(total, 3);
    assert.deepEqual(
      items.map((i) => i.status),
      ['pending', 'failed', 'completed'],
    );
    const completed = items[2];
    assert.deepEqual(completed.filters, {
      startDate: '20261101',
      endDate: '20261101',
      productCount: 3,
      nodeCount: 2,
      brandCount: 1,
    });
    assert.equal(completed.rowCount, 1);
    assert.equal(completed.provenance.fetchedAt, at(1).toISOString());
    assert.equal(completed.provenance.usedCache, false);
    assert.equal(items[1].error.code, 'GAAP_UNAVAILABLE');
    assert.equal(items[0].error, null);
    for (const item of items) {
      for (const heavy of ['totals', 'rows', 'integrity']) {
        assert.ok(!(heavy in item), heavy);
      }
      for (const heavy of ['productIds', 'nodeIds', 'brandIds']) {
        assert.ok(!(heavy in item.filters), heavy);
      }
      assert.ok(JSON.stringify(item).length < 1500);
    }
  });

  it('filters by status and reports the filtered total', async () => {
    const { items, total } = await repository.list({ status: 'failed' });
    assert.equal(total, 1);
    assert.equal(items[0].status, 'failed');
  });

  it('sorts by start date and status in both directions', async () => {
    const byStart = await repository.list({ sort: 'startDate', order: 'asc' });
    assert.deepEqual(
      byStart.items.map((i) => i.filters.startDate),
      ['20261101', '20261102', '20261103'],
    );
    const byStatus = await repository.list({ sort: 'status', order: 'asc' });
    assert.deepEqual(
      byStatus.items.map((i) => i.status),
      ['completed', 'failed', 'pending'],
    );
  });

  it('pages without repeats or gaps, even when sort keys tie', async () => {
    await Report.collection.insertMany(
      Array.from({ length: 7 }, () => ({ ...base('20261110', 10), status: 'pending' })),
    );
    const ids = [];
    for (let offset = 0; ; offset += 4) {
      const page = await repository.list({ sort: 'startDate', limit: 4, offset });
      ids.push(...page.items.map((i) => i.reportId));
      assert.equal(page.total, 10);
      if (page.items.length < 4) break;
    }
    assert.equal(ids.length, 10);
    assert.equal(new Set(ids).size, 10);
  });

  it('answers an offset past the end with no items and the true total', async () => {
    assert.deepEqual(await repository.list({ offset: 500 }), { items: [], total: 10 });
  });

  it('survives damaged or legacy documents with missing parts (nulls, not a failed page)', async () => {
    await Report.collection.deleteMany({});
    await Report.collection.insertMany([
      { status: 'completed', createdAt: at(30) },
      { createdAt: at(29), filters: {}, provenance: {}, error: {} },
    ]);
    const { items, total } = await repository.list();
    assert.equal(total, 2);
    assert.equal(items[0].filters.startDate, null);
    assert.equal(items[0].filters.productCount, 0);
    assert.equal(items[0].provenance, null);
    assert.equal(items[0].rowCount, null);
    assert.equal(items[1].status, null);
    assert.equal(items[1].error, null);
    assert.equal(items[1].provenance.fetchedAt, null);
  });

  it('refuses unsupported options instead of passing them to MongoDB', async () => {
    await assert.rejects(repository.list({ sort: 'totals' }), RangeError);
    await assert.rejects(repository.list({ sort: '__proto__' }), RangeError);
    await assert.rejects(repository.list({ status: { $ne: 'x' } }), RangeError);
    await assert.rejects(repository.list({ limit: 101 }), RangeError);
    await assert.rejects(repository.list({ limit: 0 }), RangeError);
    await assert.rejects(repository.list({ offset: -1 }), RangeError);
  });
});
