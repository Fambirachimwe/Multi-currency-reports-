/**
 * Excel export against a real, isolated local MongoDB database (dropped afterwards); skipped when no
 * MongoDB answers. Reports and rows are FIXTURES. No GAAP adapter, client or credentials exist in this
 * test, so a pass also shows the export needs nothing but saved data. This is not a live-GAAP, Atlas or
 * Railway check.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../app.js';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { loadConfig } from '../../config/env.js';
import { ensureModelIndexes } from '../../models/index.js';
import { ReportRow } from '../../models/report-row.model.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { createReportRepository } from '../reports/report.repository.js';
import { createReportsService } from '../reports/reports.service.js';
import { createReportExporter } from './report-exporter.js';

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

describe('Excel export from a saved snapshot (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  const repository = createReportRepository({ batchSize: 500 });
  const exporter = createReportExporter({
    getReport: repository.getDetail,
    streamRows: repository.streamRows,
    now: () => new Date('2026-11-08T12:00:00.000Z'),
  });
  const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    reports: createReportsService({
      catalogService: {},
      nodeFiltersService: {},
      prepareReportExport: exporter.prepare,
    }),
  });

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
    row(2, {
      nodeId: 'n2',
      nodeName: "=cmd|' /C calc'!A0",
      productId: 'p2',
      productName: '+Product Two',
    }),
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
  const download = (id) =>
    request(app)
      .get(`/api/v1/reports/${id}/export`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  const load = async (buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  };

  it('exports the saved snapshot: every number in the workbook equals the saved one', async () => {
    const reportId = await completed();
    const snapshot = await repository.getSnapshot(reportId);
    const saved = await repository.readRows(reportId, { limit: 100 });

    const res = await download(reportId);
    assert.equal(res.status, 200);
    const workbook = await load(res.body);

    // Raw Transactions == the saved rows, field by field, in saved order.
    const raw = workbook.getWorksheet('Raw Transactions');
    assert.equal(raw.rowCount, saved.rows.length + 1);
    saved.rows.forEach((savedRow, index) => {
      const cells = raw.getRow(index + 2);
      assert.equal(cells.getCell(1).value, savedRow.lineIndex + 1);
      assert.equal(cells.getCell(2).value, savedRow.sourceLineKey.replace(/^[=+\-@]/, "'$&"));
      assert.equal(cells.getCell(3).value.toISOString(), savedRow.transactionAt);
      assert.equal(cells.getCell(4).value, savedRow.nodeId);
      assert.equal(cells.getCell(6).value, savedRow.productId);
      assert.equal(cells.getCell(10).value, savedRow.currency);
      assert.equal(String(cells.getCell(11).value), savedRow.quantity);
      assert.equal(String(cells.getCell(12).value), savedRow.turnover);
    });

    // Summary totals == the saved totals; and the Raw rows re-sum to them, currency by currency.
    const summary = workbook.getWorksheet('Summary');
    const totalsRows = [];
    summary.eachRow((r) => {
      if (['USD', 'ZWG', 'UNKNOWN'].includes(r.getCell(1).value))
        totalsRows.push(r.values.slice(1));
    });
    assert.deepEqual(
      totalsRows.map(([currency, lines, quantity, turnover]) => ({
        currency,
        lineCount: lines,
        quantity: String(quantity),
        turnover: String(turnover),
      })),
      [...snapshot.totals].sort((a, b) =>
        a.currency === 'UNKNOWN'
          ? 1
          : b.currency === 'UNKNOWN'
            ? -1
            : a.currency < b.currency
              ? -1
              : 1,
      ),
    );
    const sums = {};
    raw.eachRow((r, n) => {
      if (n === 1) return;
      const code = r.getCell(10).value;
      sums[code] ??= { lines: 0, turnover: 0 };
      sums[code].lines += 1;
      sums[code].turnover += r.getCell(12).value;
    });
    assert.equal(sums.USD.lines, 3);
    assert.ok(Math.abs(sums.USD.turnover - 5.1) < 1e-9);
    assert.equal(sums.ZWG.lines, 1);
    assert.equal(sums.UNKNOWN.lines, 1);
    // Unknown stays UNKNOWN: it is never relabelled as, or added to, another currency.
    assert.equal(snapshot.totals.find((t) => t.currency === 'USD').lineCount, 3);

    // Hostile saved text is escaped in every sheet.
    assert.equal(raw.getRow(4).getCell(5).value, "'=cmd|' /C calc'!A0");
    assert.equal(raw.getRow(4).getCell(7).value, "'+Product Two");
  });

  it('is repeatable: the same saved report exports the same data every time, and changes nothing', async () => {
    const reportId = await completed();
    const before = await repository.getSnapshot(reportId);
    const first = await load((await download(reportId)).body);
    const second = await load((await download(reportId)).body);
    const dump = (workbook, name) => {
      const out = [];
      workbook.getWorksheet(name).eachRow((r) => out.push(JSON.stringify(r.values)));
      return out;
    };
    for (const name of ['Product Details', 'Currency Summary', 'Raw Transactions']) {
      assert.deepEqual(dump(first, name), dump(second, name), name);
    }
    assert.deepEqual(await repository.getSnapshot(reportId), before);
    assert.equal((await repository.verifySnapshot(reportId)).ok, true);
  });

  it('stores no xlsx binary: exporting adds no collection, document or field', async () => {
    const reportId = await completed();
    const names = async () =>
      (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name).sort();
    const stats = async () => ({
      reports: await mongoose.connection.db.collection('reports').countDocuments(),
      rows: await mongoose.connection.db.collection('reportRows').countDocuments(),
    });
    const [namesBefore, statsBefore] = [await names(), await stats()];
    const reportBefore = await mongoose.connection.db
      .collection('reports')
      .findOne({ _id: new mongoose.Types.ObjectId(reportId) });
    await download(reportId);
    assert.deepEqual(await names(), namesBefore);
    assert.deepEqual(await stats(), statsBefore);
    assert.deepEqual(
      await mongoose.connection.db
        .collection('reports')
        .findOne({ _id: new mongoose.Types.ObjectId(reportId) }),
      reportBefore,
    );
    assert.equal(
      namesBefore.some((name) => /file|export|xlsx|gridfs|\.chunks/i.test(name)),
      false,
    );
    // No binary field anywhere in the report document.
    const hasBinary = (value) =>
      value instanceof mongoose.mongo.Binary ||
      (value !== null &&
        typeof value === 'object' &&
        !(value instanceof Date) &&
        Object.values(value).some(hasBinary));
    assert.equal(hasBinary(reportBefore), false);
  });

  it('exports a larger report in full (12,000 rows) and only that report', async () => {
    const count = 12_000;
    const rows = Array.from({ length: count }, (_, i) =>
      row(i, { currency: i % 2 === 0 ? 'USD' : 'ZWG', turnover: '1.25' }),
    );
    const totals = [
      {
        currency: 'USD',
        lineCount: count / 2,
        quantity: String(count / 2),
        turnover: String((count / 2) * 1.25),
      },
      {
        currency: 'ZWG',
        lineCount: count / 2,
        quantity: String(count / 2),
        turnover: String((count / 2) * 1.25),
      },
    ];
    const other = await completed();
    const reportId = await completed(rows, totals);
    const workbook = await load((await download(reportId)).body);
    const raw = workbook.getWorksheet('Raw Transactions');
    assert.equal(raw.rowCount, count + 1);
    assert.equal(raw.getRow(count + 1).getCell(1).value, count);
    const otherWorkbook = await load((await download(other)).body);
    assert.equal(otherWorkbook.getWorksheet('Raw Transactions').rowCount, ROWS.length + 1);
  });

  it('refuses to export a snapshot whose saved rows were altered or lost, sending no file', async () => {
    const edited = await completed();
    await ReportRow.collection.updateOne(
      { reportId: new mongoose.Types.ObjectId(edited), lineIndex: 0 },
      { $set: { turnover: mongoose.Types.Decimal128.fromString('999') } },
    );
    const res = await request(app).get(`/api/v1/reports/${edited}/export`);
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'SNAPSHOT_INTEGRITY_ERROR');
    assert.equal(res.headers['content-disposition'], undefined);

    const lost = await completed();
    await ReportRow.collection.deleteOne({
      reportId: new mongoose.Types.ObjectId(lost),
      lineIndex: 4,
    });
    const gone = await request(app).get(`/api/v1/reports/${lost}/export`);
    assert.equal(gone.status, 500);
    assert.equal(gone.body.error.code, 'SNAPSHOT_INTEGRITY_ERROR');
  });

  it('answers 404 for an unknown id and 409 for a pending or failed report', async () => {
    const unknown = await request(app).get(`/api/v1/reports/${'b'.repeat(24)}/export`);
    assert.equal(unknown.status, 404);

    const { reportId: pending } = await repository.createPending({
      request: REQUEST,
      startedAt: NOW,
    });
    const res = await request(app).get(`/api/v1/reports/${pending}/export`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'REPORT_NOT_COMPLETED');
    assert.equal(res.body.error.details.status, 'pending');

    await repository.markFailed({
      reportId: pending,
      code: 'GAAP_UNAVAILABLE',
      message: 'GAAP could not be reached.',
      failedAt: NOW,
    });
    const failed = await request(app).get(`/api/v1/reports/${pending}/export`);
    assert.equal(failed.status, 409);
    assert.equal(failed.body.error.details.status, 'failed');
  });
});
