/**
 * Feature 21 snapshot tests against a real, isolated local MongoDB database (dropped afterwards).
 * Skipped when no MongoDB answers. Rows and sales are FIXTURES: this is persistence evidence only,
 * not GAAP evidence, and not a test against Atlas/Railway.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { ensureModelIndexes } from '../../models/index.js';
import { ReportRow, ReportRowImmutableError } from '../../models/report-row.model.js';
import { Report } from '../../models/report.model.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { createDecimalSum } from '../gaap/decimal-sum.js';
import { fixtureRawLine, fixtureRawSale } from '../gaap/fixtures/sales-lines.fixture.js';
import { createReportGenerator } from './report-generation.js';
import { SNAPSHOT_PROBLEMS as P, SnapshotIntegrityError, toRowView } from './report-snapshot.js';
import { MAX_ROW_PAGE_SIZE, createReportRepository } from './report.repository.js';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const REQUEST = Object.freeze({
  startDate: '20261105',
  endDate: '20261105',
  productIds: ['prod-1'],
  nodes: { mode: 'brands', brandIds: ['brand-1'], nodeIds: ['node-a'] },
  cachePolicy: 'bypass_cache',
});
const skip = await skipUnlessMongo();

const row = (i, overrides = {}) => ({
  lineIndex: i,
  sourceLineKey: `s${i}/l1`,
  transactionAt: new Date(Date.UTC(2026, 10, 5, 8, 0, 0) + i * 1000),
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
/** Exact per-currency totals for fixture rows (test helper; uses the project's exact decimal sum). */
function totalsOf(rows) {
  const by = new Map();
  for (const r of rows) {
    const e = by.get(r.currency) ?? {
      currency: r.currency,
      lineCount: 0,
      quantity: createDecimalSum(),
      turnover: createDecimalSum(),
    };
    e.lineCount += 1;
    e.quantity.add(r.quantity);
    e.turnover.add(r.turnover);
    by.set(r.currency, e);
  }
  return [...by.values()]
    .sort((a, b) => (a.currency < b.currency ? -1 : 1))
    .map((e) => ({
      currency: e.currency,
      lineCount: e.lineCount,
      quantity: e.quantity.toString(),
      turnover: e.turnover.toString(),
    }));
}

describe('immutable report snapshot (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  const repository = createReportRepository({ batchSize: 2, now: () => NOW });

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });
  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });
  afterEach(() => mock.restoreAll());

  const pending = async () =>
    (await repository.createPending({ request: REQUEST, startedAt: NOW })).reportId;
  const complete = async (reportId, rows, repo = repository, totals = totalsOf(rows)) =>
    repo.markCompleted({
      reportId,
      totals,
      rows,
      provenance: provenance(),
      calculationVersion: 'lines2.cur1.elig1.agg1',
      completedAt: NOW,
    });
  const allRows = async (reportId, limit = 3) => {
    const rows = [];
    let after = -1;
    for (;;) {
      const page = await repository.readRows(reportId, { afterLineIndex: after, limit });
      rows.push(...page.rows);
      if (page.nextAfterLineIndex === null) return rows;
      after = page.nextAfterLineIndex;
    }
  };

  describe('reloads identically', () => {
    it('returns exactly what was saved: filters, totals, provenance, version, rows, checksum', async () => {
      const rows = [
        row(0, { turnover: '0.0000001', quantity: '3' }),
        row(1, { currency: 'ZWG', turnover: '300', nodeName: 'Harare CBD', productName: 'Burger' }),
        row(2, { currency: 'UNKNOWN', turnover: '-5.5', quantity: '-1', warnings: ['NEGATIVE_X'] }),
        row(3, { departmentId: 'dep-1', brandId: 'brand-1', turnover: '1.5' }),
        row(4, { turnover: '12.50' }),
      ];
      const totals = [
        { currency: 'UNKNOWN', lineCount: 1, quantity: '-1', turnover: '-5.5' },
        { currency: 'USD', lineCount: 3, quantity: '5', turnover: '14.0000001' },
        { currency: 'ZWG', lineCount: 1, quantity: '1', turnover: '300' },
      ];
      const reportId = await pending();
      await complete(reportId, rows, repository, totals);

      const snapshot = await repository.getSnapshot(reportId);
      assert.equal(snapshot.status, 'completed');
      assert.equal(snapshot.reportId, reportId);
      assert.equal(snapshot.calculationVersion, 'lines2.cur1.elig1.agg1');
      assert.deepEqual(snapshot.filters, {
        startDate: '20261105',
        endDate: '20261105',
        departmentIds: [],
        productIds: ['prod-1'],
        brandIds: ['brand-1'],
        nodeIds: ['node-a'],
        currencies: [],
      });
      assert.deepEqual(snapshot.totals, totals);
      assert.equal(snapshot.rowCount, 5);
      assert.deepEqual(snapshot.provenance, {
        source: 'GAAP_UNITY',
        sourceStartedAt: '2026-11-08T09:58:00.000Z',
        fetchedAt: '2026-11-08T09:59:00.000Z',
        usedCache: false,
        cacheFreshness: 'not_applicable',
        complete: true,
      });
      assert.equal(snapshot.completedAt, NOW.toISOString());
      assert.equal(snapshot.integrity.checksumAlgorithm, 'sha256');
      assert.equal(snapshot.integrity.verifiedAt, NOW.toISOString());

      // Rows come back as the same values, in the same order, across several pages.
      assert.deepEqual(await allRows(reportId, 2), rows.map(toRowView));
      assert.equal((await allRows(reportId, 2))[0].turnover, '0.0000001');
      assert.equal((await allRows(reportId, 2))[4].turnover, '12.50');

      // Reading again later gives the same snapshot and rows.
      assert.deepEqual(await repository.getSnapshot(reportId), snapshot);
      assert.deepEqual(await allRows(reportId, 100), await allRows(reportId, 1));
      assert.deepEqual(await repository.verifySnapshot(reportId), {
        ok: true,
        problems: [],
        rowCount: 5,
      });
    });

    it('an empty report completes with no rows and verifies', async () => {
      const reportId = await pending();
      await complete(reportId, [], repository, []);
      assert.equal((await repository.getSnapshot(reportId)).rowCount, 0);
      assert.deepEqual((await repository.readRows(reportId)).rows, []);
      assert.equal((await repository.verifySnapshot(reportId)).ok, true);
    });

    it('pages with keyset paging and validates page arguments', async () => {
      const rows = [0, 1, 2, 3, 4].map((i) => row(i));
      const reportId = await pending();
      await complete(reportId, rows);
      const first = await repository.readRows(reportId, { limit: 2 });
      assert.deepEqual(
        first.rows.map((r) => r.lineIndex),
        [0, 1],
      );
      assert.equal(first.nextAfterLineIndex, 1);
      const last = await repository.readRows(reportId, { afterLineIndex: 3, limit: 2 });
      assert.deepEqual(
        last.rows.map((r) => r.lineIndex),
        [4],
      );
      assert.equal(last.nextAfterLineIndex, null);
      const exact = await repository.readRows(reportId, { afterLineIndex: 2, limit: 2 });
      assert.equal(exact.nextAfterLineIndex, null);
      for (const bad of [
        { limit: 0 },
        { limit: MAX_ROW_PAGE_SIZE + 1 },
        { limit: 1.5 },
        { afterLineIndex: -2 },
      ]) {
        await assert.rejects(repository.readRows(reportId, bad), RangeError);
      }
    });

    it('only completed reports have a snapshot: pending, failed, unknown and malformed ids give null', async () => {
      const pendingId = await pending();
      // Orphan rows of a non-completed report are never served.
      await ReportRow.create({ ...row(0), reportId: pendingId });
      const failedId = await pending();
      await repository.markFailed({ reportId: failedId, code: 'X', message: 'm', failedAt: NOW });
      for (const id of [pendingId, failedId, String(new mongoose.Types.ObjectId()), 'nope']) {
        assert.equal(await repository.getSnapshot(id), null, id);
        assert.equal(await repository.readRows(id), null, id);
        assert.equal(await repository.verifySnapshot(id), null, id);
      }
    });
  });

  describe('large reports and document size', () => {
    it('writes 12,000 rows in bounded batches; every document stays far below the 16 MiB limit', async () => {
      const big = createReportRepository({
        batchSize: 1000,
        limits: { maxRowBytes: 16 * 1024, maxBatchBytes: 150_000, maxReportBytes: 1024 * 1024 },
        now: () => NOW,
      });
      const batches = [];
      const original = ReportRow.insertMany.bind(ReportRow);
      mock.method(ReportRow, 'insertMany', async (batch, options) => {
        batches.push({
          rows: batch.length,
          bytes: batch.reduce((n, d) => n + mongoose.mongo.BSON.calculateObjectSize(d), 0),
        });
        return original(batch, options);
      });

      const rows = Array.from({ length: 12_000 }, (_, i) =>
        row(i, {
          currency: i % 3 === 0 ? 'ZWG' : 'USD',
          turnover: String(i % 50),
          nodeName: `Node ${i % 40}`,
        }),
      );
      const reportId = (await big.createPending({ request: REQUEST, startedAt: NOW })).reportId;
      await complete(reportId, rows, big);
      mock.restoreAll();

      assert.ok(batches.length > 12, `byte bound must split batches (got ${batches.length})`);
      assert.ok(batches.every((b) => b.rows <= 1000 && b.bytes <= 150_000));
      assert.equal(
        batches.reduce((n, b) => n + b.rows, 0),
        12_000,
      );

      const [{ maxRow }] = await ReportRow.aggregate([
        { $match: { reportId: new mongoose.Types.ObjectId(reportId) } },
        { $group: { _id: null, maxRow: { $max: { $bsonSize: '$$ROOT' } } } },
      ]);
      const [{ reportBytes }] = await Report.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(reportId) } },
        { $project: { reportBytes: { $bsonSize: '$$ROOT' } } },
      ]);
      assert.ok(maxRow < 2048, `row document ${maxRow} bytes`);
      assert.ok(reportBytes < 16 * 1024, `report document ${reportBytes} bytes`);

      const snapshot = await big.getSnapshot(reportId);
      assert.equal(snapshot.rowCount, 12_000);
      assert.equal(snapshot.totals.length, 2);
      assert.equal(await ReportRow.countDocuments({ reportId }), 12_000);
      assert.deepEqual(await big.verifySnapshot(reportId), {
        ok: true,
        problems: [],
        rowCount: 12_000,
      });
      // Per-currency lines add up to the row count: nothing merged, nothing lost.
      assert.equal(
        snapshot.totals.reduce((n, t) => n + t.lineCount, 0),
        12_000,
      );
    });

    it('refuses an oversized row before writing anything', async () => {
      const reportId = await pending();
      const rows = [row(0), row(1, { nodeName: 'x'.repeat(20_000) })];
      await assert.rejects(complete(reportId, rows), (e) => e.problems?.includes(P.ROW_TOO_LARGE));
      assert.equal(await ReportRow.countDocuments({ reportId }), 0);
      assert.equal((await repository.getStatus(reportId)).status, 'pending');
    });

    it('refuses an oversized report document and removes the rows it wrote', async () => {
      const tight = createReportRepository({
        batchSize: 2,
        limits: { maxRowBytes: 16 * 1024, maxBatchBytes: 8 * 1024 * 1024, maxReportBytes: 200 },
      });
      const reportId = await pending();
      await assert.rejects(complete(reportId, [row(0), row(1)], tight), (e) =>
        e.problems?.includes(P.REPORT_DOCUMENT_TOO_LARGE),
      );
      assert.equal(await ReportRow.countDocuments({ reportId }), 0);
      assert.equal((await repository.getStatus(reportId)).status, 'pending');
    });
  });

  describe('completion is atomic and consistent', () => {
    const untouched = async (reportId) => {
      assert.equal(await ReportRow.countDocuments({ reportId }), 0, 'rows must be removed');
      const status = await repository.getStatus(reportId);
      assert.equal(status.status, 'pending');
      assert.equal(status.rowCount, null);
      assert.equal(status.completedAt, null);
      const stored = await Report.findById(reportId).lean();
      assert.equal(stored.totals.length, 0);
      assert.equal(stored.integrity, undefined);
    };

    it('totals that do not match the rows: nothing is written, report stays pending', async () => {
      const reportId = await pending();
      const totals = [{ currency: 'USD', lineCount: 2, quantity: '2', turnover: '99' }];
      await assert.rejects(
        complete(reportId, [row(0), row(1)], repository, totals),
        (e) =>
          e instanceof SnapshotIntegrityError && e.problems.includes(P.TOTALS_TURNOVER_MISMATCH),
      );
      await untouched(reportId);
    });

    it('a repeated source line or broken sequence is refused before writing', async () => {
      const reportId = await pending();
      const rows = [row(0), row(1, { sourceLineKey: 's0/l1' })];
      await assert.rejects(complete(reportId, rows), (e) =>
        e.problems?.includes(P.ROW_DUPLICATE_KEY),
      );
      await untouched(reportId);
      await assert.rejects(complete(reportId, [row(1)]), (e) =>
        e.problems?.includes(P.ROW_INDEX_SEQUENCE),
      );
      await untouched(reportId);
    });

    it('a write that fails midway removes every row already written (earlier batches too)', async () => {
      const reportId = await pending();
      const original = ReportRow.insertMany.bind(ReportRow);
      let calls = 0;
      mock.method(ReportRow, 'insertMany', async (batch, options) => {
        calls += 1;
        if (calls === 3) throw new Error('simulated write failure');
        return original(batch, options);
      });
      await assert.rejects(
        complete(
          reportId,
          [0, 1, 2, 3, 4, 5].map((i) => row(i)),
        ),
        /simulated write failure/,
      );
      assert.equal(calls, 3);
      mock.restoreAll();
      await untouched(reportId);
    });

    it('rows that read back differently from what was written fail the report and are removed', async () => {
      const reportId = await pending();
      const original = ReportRow.insertMany.bind(ReportRow);
      mock.method(ReportRow, 'insertMany', async (batch, options) => {
        // Simulates silent corruption in the store: one stored amount differs from what was sent.
        const altered = batch.map((d, i) => (i === 0 ? { ...d, turnover: '2.6' } : d));
        return original(altered, options);
      });
      await assert.rejects(complete(reportId, [row(0), row(1)]), (e) =>
        e.problems?.includes(P.READBACK_MISMATCH),
      );
      mock.restoreAll();
      await untouched(reportId);
    });

    it('a row lost during the write is caught (row count)', async () => {
      const reportId = await pending();
      const original = ReportRow.insertMany.bind(ReportRow);
      mock.method(ReportRow, 'insertMany', async (batch, options) =>
        original(batch.slice(0, -1), options),
      );
      await assert.rejects(complete(reportId, [row(0), row(1), row(2)]), (e) =>
        e.problems?.includes(P.ROW_COUNT_MISMATCH),
      );
      mock.restoreAll();
      await untouched(reportId);
    });

    it('if the report stops being pending before completion, nothing is completed and its rows are removed', async () => {
      const reportId = await pending();
      const original = ReportRow.insertMany.bind(ReportRow);
      mock.method(ReportRow, 'insertMany', async (batch, options) => {
        const result = await original(batch, options);
        // Someone fails the report between the row write and the completion.
        await repository.markFailed({
          reportId,
          code: 'GENERATION_TIMEOUT',
          message: 'm',
          failedAt: NOW,
        });
        return result;
      });
      await assert.rejects(complete(reportId, [row(0)]), /only a pending report|no longer pending/);
      mock.restoreAll();
      assert.equal(await ReportRow.countDocuments({ reportId }), 0);
      assert.equal((await repository.getStatus(reportId)).status, 'failed');
    });

    it('a failed completion never touches other reports', async () => {
      const goodId = await pending();
      await complete(goodId, [row(0), row(1), row(2)]);
      const before = await repository.getSnapshot(goodId);

      const badId = await pending();
      await assert.rejects(
        complete(badId, [row(0)], repository, [
          { currency: 'USD', lineCount: 9, quantity: '1', turnover: '1' },
        ]),
      );
      await repository.markFailed({
        reportId: badId,
        code: 'SNAPSHOT_SAVE_FAILED',
        message: 'm',
        failedAt: NOW,
      });

      assert.deepEqual(await repository.getSnapshot(goodId), before);
      assert.equal((await repository.verifySnapshot(goodId)).ok, true);
      assert.equal(await ReportRow.countDocuments({ reportId: goodId }), 3);
    });

    it('two concurrent completions of one pending report: exactly one wins and its snapshot is intact', async () => {
      for (const rows of [[0, 1, 2, 3].map((i) => row(i)), []]) {
        const reportId = await pending();
        const results = await Promise.allSettled([
          complete(reportId, rows),
          complete(reportId, rows),
        ]);
        assert.equal(
          results.filter((r) => r.status === 'fulfilled').length,
          1,
          `rows=${rows.length}`,
        );
        const snapshot = await repository.getSnapshot(reportId);
        assert.equal(snapshot.rowCount, rows.length);
        assert.equal(await ReportRow.countDocuments({ reportId }), rows.length);
        assert.equal((await repository.verifySnapshot(reportId)).ok, true);
      }
    });
  });

  describe('a completed snapshot cannot be silently edited', () => {
    it('cannot be completed again, failed, re-saved, updated or have its rows changed or deleted', async () => {
      const rows = [row(0), row(1, { currency: 'ZWG', turnover: '7' })];
      const reportId = await pending();
      await complete(reportId, rows);
      const before = await repository.getSnapshot(reportId);

      await assert.rejects(complete(reportId, [row(0)]), /only a pending report/);
      await assert.rejects(
        repository.markFailed({ reportId, code: 'X', message: 'm', failedAt: NOW }),
        /only a pending report/,
      );
      const loaded = await Report.findById(reportId);
      loaded.rowCount = 99;
      await assert.rejects(loaded.save());
      assert.equal(
        (await Report.updateOne({ _id: reportId }, { $set: { rowCount: 99 } })).matchedCount,
        0,
      );
      assert.equal((await Report.replaceOne({ _id: reportId }, { filters: {} })).matchedCount, 0);
      await assert.rejects(
        ReportRow.updateOne({ reportId }, { $set: { turnover: '1' } }),
        ReportRowImmutableError,
      );
      await assert.rejects(ReportRow.deleteMany({ reportId }), ReportRowImmutableError);
      await assert.rejects(
        ReportRow.deleteOne({ reportId, lineIndex: 0 }),
        ReportRowImmutableError,
      );

      assert.deepEqual(await repository.getSnapshot(reportId), before);
      assert.deepEqual(await allRows(reportId), rows.map(toRowView));
      assert.equal((await repository.verifySnapshot(reportId)).ok, true);
    });

    it('later tampering that bypasses the guards (direct driver access) is detected by verifySnapshot', async () => {
      const reportId = await pending();
      await complete(reportId, [row(0), row(1), row(2)]);
      assert.equal((await repository.verifySnapshot(reportId)).ok, true);

      await ReportRow.collection.updateOne(
        { reportId: new mongoose.Types.ObjectId(reportId), lineIndex: 1 },
        { $set: { turnover: mongoose.Types.Decimal128.fromString('999') } },
      );
      const edited = await repository.verifySnapshot(reportId);
      assert.equal(edited.ok, false);
      assert.ok(edited.problems.includes(P.CHECKSUM_MISMATCH));
      assert.ok(edited.problems.includes(P.TOTALS_TURNOVER_MISMATCH));

      await ReportRow.collection.deleteOne({
        reportId: new mongoose.Types.ObjectId(reportId),
        lineIndex: 2,
      });
      const removed = await repository.verifySnapshot(reportId);
      assert.ok(removed.problems.includes(P.ROW_COUNT_MISMATCH));
      assert.ok(
        removed.problems.includes(P.ROW_INDEX_SEQUENCE) ||
          removed.problems.includes(P.CHECKSUM_MISMATCH),
      );
    });
  });

  describe('regeneration creates a new report', () => {
    it('the same request twice gives two ids; completing the second leaves the first unchanged', async () => {
      const makeGenerator = (sales) =>
        createReportGenerator({
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

      const firstId = (await repository.createPending({ request: REQUEST, startedAt: NOW }))
        .reportId;
      const first = await makeGenerator([
        fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 2, priceIncl: 5 })]),
      ]).generate({ reportId: firstId, request: REQUEST });
      assert.equal(first.status, 'completed');
      const firstSnapshot = await repository.getSnapshot(firstId);
      const firstRows = await allRows(firstId);

      // GAAP data changed between runs; regenerating with the same request must not rewrite the first.
      const secondId = (await repository.createPending({ request: REQUEST, startedAt: NOW }))
        .reportId;
      assert.notEqual(secondId, firstId);
      const second = await makeGenerator([
        fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 2, priceIncl: 5 })]),
        fixtureRawSale('s2', [fixtureRawLine('l1', { qty: 1, priceIncl: 9 })]),
      ]).generate({ reportId: secondId, request: REQUEST });
      assert.equal(second.status, 'completed');

      assert.deepEqual(await repository.getSnapshot(firstId), firstSnapshot);
      assert.deepEqual(await allRows(firstId), firstRows);
      const secondSnapshot = await repository.getSnapshot(secondId);
      assert.equal(secondSnapshot.rowCount, 2);
      assert.notEqual(secondSnapshot.integrity.rowsChecksum, firstSnapshot.integrity.rowsChecksum);
      assert.equal(firstSnapshot.rowCount, 1);
      assert.equal((await repository.verifySnapshot(firstId)).ok, true);
      assert.equal((await repository.verifySnapshot(secondId)).ok, true);
    });
  });
});
