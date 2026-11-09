/**
 * Saved report detail/summary tests against a real, isolated local MongoDB database (dropped afterwards).
 * Skipped when no MongoDB answers. Rows are FIXTURES; no GAAP adapter exists in this test, so a pass
 * also shows the summary needs nothing but saved data.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { ensureModelIndexes } from '../../models/index.js';
import { ReportRow } from '../../models/report-row.model.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { SnapshotIntegrityError } from './report-snapshot.js';
import { createReportRepository } from './report.repository.js';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const REQUEST = Object.freeze({
  startDate: '20261101',
  endDate: '20261107',
  productIds: ['p1', 'p2'],
  nodes: { mode: 'brands', brandIds: ['b1'], nodeIds: ['n1', 'n2'] },
  cachePolicy: 'bypass_cache',
});
const provenance = {
  source: 'GAAP_UNITY',
  sourceStartedAt: new Date('2026-11-08T09:58:00Z'),
  fetchedAt: new Date('2026-11-08T09:59:00Z'),
  usedCache: false,
  cacheFreshness: 'not_applicable',
  complete: true,
};

const skip = await skipUnlessMongo();

describe('report repository getDetail (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  const repository = createReportRepository({ batchSize: 2 });

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });
  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  const row = (i, o = {}) => ({
    lineIndex: i,
    sourceLineKey: `s${i}/l1`,
    transactionAt: new Date('2026-11-05T08:00:00Z'),
    nodeId: 'n1',
    nodeName: 'Store One',
    productId: 'p1',
    productName: 'Product One',
    currency: 'USD',
    quantity: '1',
    turnover: '2.5',
    warnings: [],
    ...o,
  });
  const ROWS = [
    row(0),
    row(1, { turnover: '0.1' }),
    row(2, { nodeId: 'n2', nodeName: 'Store Two', productId: 'p2', productName: 'Product Two' }),
    row(3, { currency: 'ZWG', turnover: '100', quantity: '4' }),
    row(4, { currency: 'UNKNOWN', turnover: '7', warnings: ['CURRENCY_UNKNOWN'] }),
  ];
  const TOTALS = [
    { currency: 'USD', lineCount: 3, quantity: '3', turnover: '5.1' },
    { currency: 'UNKNOWN', lineCount: 1, quantity: '1', turnover: '7' },
    { currency: 'ZWG', lineCount: 1, quantity: '4', turnover: '100' },
  ];

  async function completed(rows = ROWS, totals = TOTALS) {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markCompleted({
      reportId,
      totals,
      rows,
      provenance,
      calculationVersion: 'v-test',
      completedAt: NOW,
    });
    return reportId;
  }

  it('returns metadata, full filters, per-currency totals and groupings that equal the saved totals', async () => {
    const reportId = await completed();
    const detail = await repository.getDetail(reportId);

    assert.equal(detail.status, 'completed');
    assert.equal(detail.reportId, reportId);
    assert.deepEqual(detail.filters.productIds, ['p1', 'p2']);
    assert.deepEqual(detail.filters.nodeIds, ['n1', 'n2']);
    assert.equal(detail.provenance.fetchedAt, '2026-11-08T09:59:00.000Z');
    assert.equal(detail.completedAt, NOW.toISOString());
    assert.equal(detail.rowCount, 5);
    assert.deepEqual(
      detail.totals.map((t) => [t.currency, t.lineCount, t.quantity, t.turnover]),
      [
        ['USD', 3, '3', '5.1'],
        ['UNKNOWN', 1, '1', '7'],
        ['ZWG', 1, '4', '100'],
      ],
    );

    // Product and node groupings, per currency, add up to the saved totals for that currency.
    for (const groups of [detail.summary.products, detail.summary.nodes]) {
      for (const total of detail.totals) {
        const inCurrency = groups.filter((g) => g.currency === total.currency);
        assert.equal(
          inCurrency.reduce((n, g) => n + g.lineCount, 0),
          total.lineCount,
        );
        // Fixture amounts are small and exact enough to compare as scaled integers.
        const cents = (v) => Math.round(Number(v) * 100);
        assert.equal(
          inCurrency.reduce((n, g) => n + cents(g.turnover), 0),
          cents(total.turnover),
        );
      }
    }
    assert.deepEqual(
      detail.summary.products.map((g) => [g.currency, g.id, g.name, g.turnover]),
      [
        ['USD', 'p1', 'Product One', '2.6'],
        ['USD', 'p2', 'Product Two', '2.5'],
        ['ZWG', 'p1', 'Product One', '100'],
        ['UNKNOWN', 'p1', 'Product One', '7'],
      ],
    );
    assert.deepEqual(detail.summary.warnings, [{ code: 'CURRENCY_UNKNOWN', rowCount: 1 }]);
    assert.equal(detail.integrity.rowsChecksum.length, 64);
  });

  it('never returns rows or other heavy payloads, and is identical on repeat reads', async () => {
    const reportId = await completed();
    const a = await repository.getDetail(reportId);
    const b = await repository.getDetail(reportId);
    assert.deepEqual(a, b);
    assert.ok(!('rows' in a));
    assert.ok(JSON.stringify(a).length < 10_000);
  });

  it('shows an empty completed report with no groups', async () => {
    const reportId = await completed([], []);
    const detail = await repository.getDetail(reportId);
    assert.equal(detail.rowCount, 0);
    assert.deepEqual(detail.totals, []);
    assert.deepEqual(detail.summary.products, []);
    assert.deepEqual(detail.summary.nodes, []);
    assert.deepEqual(detail.summary.warnings, []);
    assert.equal(detail.summary.consistency.ok, true);
  });

  it('answers pending and failed reports with metadata and no summary', async () => {
    const pending = await repository.createPending({ request: REQUEST, startedAt: NOW });
    const p = await repository.getDetail(pending.reportId);
    assert.equal(p.status, 'pending');
    assert.ok(!('summary' in p) && !('totals' in p));
    assert.deepEqual(p.filters.nodeIds, ['n1', 'n2']);

    const failing = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markFailed({
      reportId: failing.reportId,
      code: 'GAAP_UNAVAILABLE',
      message: 'GAAP could not be reached.',
      failedAt: NOW,
    });
    const f = await repository.getDetail(failing.reportId);
    assert.equal(f.status, 'failed');
    assert.equal(f.error.code, 'GAAP_UNAVAILABLE');
    assert.ok(!('summary' in f) && !('totals' in f));
  });

  it('returns null for a missing or malformed id', async () => {
    assert.equal(await repository.getDetail(new mongoose.Types.ObjectId().toString()), null);
    assert.equal(await repository.getDetail('nope'), null);
    assert.equal(await repository.getDetail(undefined), null);
  });

  it('refuses to show a snapshot whose saved rows were altered or lost', async () => {
    const edited = await completed();
    // Bypasses the model guards, as a direct database edit would.
    await ReportRow.collection.updateOne(
      { reportId: new mongoose.Types.ObjectId(edited), lineIndex: 0 },
      { $set: { turnover: mongoose.Types.Decimal128.fromString('999') } },
    );
    await assert.rejects(repository.getDetail(edited), SnapshotIntegrityError);

    const lost = await completed();
    await ReportRow.collection.deleteOne({
      reportId: new mongoose.Types.ObjectId(lost),
      lineIndex: 4,
    });
    await assert.rejects(repository.getDetail(lost), SnapshotIntegrityError);
  });
});
