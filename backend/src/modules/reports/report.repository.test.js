/**
 * Report repository tests against a real, isolated local MongoDB database (dropped afterwards).
 * Skipped when no MongoDB answers. Sales are FIXTURES; this is persistence evidence only, not GAAP.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { ensureModelIndexes } from '../../models/index.js';
import { ReportRow } from '../../models/report-row.model.js';
import { Report } from '../../models/report.model.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { fixtureRawLine, fixtureRawSale } from '../gaap/fixtures/sales-lines.fixture.js';
import { createReportGenerator } from './report-generation.js';
import { createReportRepository } from './report.repository.js';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const REQUEST = Object.freeze({
  startDate: '20261105',
  endDate: '20261105',
  productIds: ['prod-1'],
  nodes: { mode: 'brands', brandIds: ['brand-1'], nodeIds: ['node-a'] },
  cachePolicy: 'bypass_cache',
});

const skip = await skipUnlessMongo();

describe('report repository (isolated MongoDB database)', { skip }, () => {
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

  const row = (i, overrides = {}) => ({
    lineIndex: i,
    sourceLineKey: `s${i}/l1`,
    transactionAt: new Date('2026-11-05T08:00:00Z'),
    nodeId: 'node-a',
    productId: 'prod-1',
    currency: 'USD',
    quantity: '1',
    turnover: '2.5',
    warnings: [],
    ...overrides,
  });
  const provenance = () => ({
    source: 'GAAP_UNITY',
    sourceStartedAt: new Date('2026-11-08T09:58:00Z'),
    fetchedAt: new Date('2026-11-08T09:59:00Z'),
    usedCache: false,
    cacheFreshness: 'not_applicable',
    complete: true,
  });

  it('creates a pending report with the exact filters and no totals', async () => {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    const status = await repository.getStatus(reportId);
    assert.equal(status.status, 'pending');
    assert.equal(status.provenance.complete, false);
    assert.equal(status.error, null);
    const stored = await Report.findById(reportId).lean();
    assert.deepEqual(stored.filters.nodeIds, ['node-a']);
    assert.deepEqual(stored.filters.brandIds, ['brand-1']);
    assert.deepEqual(stored.filters.productIds, ['prod-1']);
  });

  it('completes: rows (across batches) and totals are stored and the report is completed', async () => {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markCompleted({
      reportId,
      totals: [{ currency: 'USD', lineCount: 5, quantity: '5', turnover: '12.5' }],
      rows: [0, 1, 2, 3, 4].map((i) => row(i)),
      provenance: provenance(),
      calculationVersion: 'lines2.cur1.elig1.agg1',
      completedAt: NOW,
    });
    const status = await repository.getStatus(reportId);
    assert.equal(status.status, 'completed');
    assert.equal(status.rowCount, 5);
    assert.equal(status.provenance.fetchedAt, '2026-11-08T09:59:00.000Z');
    assert.equal(status.provenance.sourceStartedAt, '2026-11-08T09:58:00.000Z');
    const rows = await ReportRow.find({ reportId }).sort({ lineIndex: 1 }).lean();
    assert.deepEqual(
      rows.map((r) => r.lineIndex),
      [0, 1, 2, 3, 4],
    );
    assert.equal(rows[0].turnover.toString(), '2.5');
  });

  it('a completed report cannot be completed again or failed', async () => {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markCompleted({
      reportId,
      totals: [],
      rows: [],
      provenance: provenance(),
      calculationVersion: 'v',
      completedAt: NOW,
    });
    await assert.rejects(
      repository.markCompleted({
        reportId,
        totals: [],
        rows: [],
        provenance: provenance(),
        calculationVersion: 'v',
        completedAt: NOW,
      }),
      /only a pending report/,
    );
    await assert.rejects(
      repository.markFailed({ reportId, code: 'X', message: 'm', failedAt: NOW }),
      /only a pending report/,
    );
    assert.equal((await repository.getStatus(reportId)).status, 'completed');
  });

  it('rolls back rows and stays non-completed when row insertion fails midway', async () => {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await assert.rejects(
      repository.markCompleted({
        reportId,
        totals: [],
        // Third row repeats a source line key: the unique index rejects it after batch 1 was written.
        rows: [row(0), row(1), row(2, { sourceLineKey: 's0/l1' })],
        provenance: provenance(),
        calculationVersion: 'v',
        completedAt: NOW,
      }),
    );
    assert.equal(await ReportRow.countDocuments({ reportId }), 0);
    assert.equal((await repository.getStatus(reportId)).status, 'pending');
  });

  it('records a failure with a code and safe message, and owns no rows', async () => {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markFailed({
      reportId,
      code: 'SOURCE_INCOMPLETE',
      message: 'GAAP data could not be fetched completely.',
      failedAt: NOW,
    });
    const status = await repository.getStatus(reportId);
    assert.equal(status.status, 'failed');
    assert.equal(status.error.code, 'SOURCE_INCOMPLETE');
    assert.equal(status.failedAt, NOW.toISOString());
    assert.equal(await ReportRow.countDocuments({ reportId }), 0);
  });

  it('returns null for unknown or malformed ids', async () => {
    assert.equal(await repository.getStatus(String(new mongoose.Types.ObjectId())), null);
    assert.equal(await repository.getStatus('not-an-id'), null);
  });

  it('end to end: generator + real repository store a completed report whose rows match its totals', async () => {
    const sales = [
      fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 2, priceIncl: 5 })]),
      fixtureRawSale('s2', [fixtureRawLine('l1', { priceIncl: 1.25 })]),
    ];
    const generator = createReportGenerator({
      salesAdapter: {
        fetchSales: async () => ({
          sales,
          complete: true,
          partial: false,
          failures: [],
          incompleteReasons: [],
          pageCount: 1,
          queryCount: 1,
          duplicateCount: 0,
          fetchedAt: '2026-11-08T09:59:00.000Z',
          sourceStartedAt: '2026-11-08T09:58:00.000Z',
        }),
      },
      repository,
      salesCachePolicy: { enabled: false },
      rulesVerified: true,
      now: () => NOW,
    });
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    const outcome = await generator.generate({ reportId, request: REQUEST });
    assert.equal(outcome.status, 'completed');

    const report = await Report.findById(reportId).lean();
    assert.equal(report.status, 'completed');
    assert.equal(report.totals.length, 1);
    assert.equal(report.totals[0].currency, 'USD');
    assert.equal(report.totals[0].turnover.toString(), '11.25');
    const rows = await ReportRow.find({ reportId }).lean();
    assert.equal(rows.length, report.rowCount);
    assert.equal(rows.length, report.totals[0].lineCount);
    const sum = rows.reduce((acc, r) => acc + Number(r.turnover.toString()), 0);
    assert.equal(sum, 11.25);
  });
});
