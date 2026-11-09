/**
 * `GET /api/v1/reports/:reportId/export` tests. The saved report and rows are FIXTURE stubs (no
 * MongoDB, no GAAP): this proves routing, error mapping, headers and that the workbook renders exactly
 * the saved values. The real-MongoDB check is in report-export.repository.test.js.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createReportExporter, SHEET_NAMES } from '../modules/exports/index.js';
import { createGroupAccumulator } from '../modules/reports/report-groups.js';
import { buildReportSummary } from '../modules/reports/report-summary.js';
import { createReportsService, SnapshotIntegrityError } from '../modules/reports/index.js';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

/** FIXTURE rows: three currencies, hostile text, a precise amount, and a missing optional name. */
const ROWS = [
  {
    lineIndex: 0,
    sourceLineKey: 's1/l1',
    transactionAt: '2026-11-05T08:30:00.000Z',
    nodeId: 'n1',
    nodeName: 'Store One',
    productId: 'p1',
    productName: 'Product One',
    currency: 'USD',
    quantity: '2',
    turnover: '5.10',
    warnings: [],
  },
  {
    lineIndex: 1,
    sourceLineKey: 's2/l1',
    transactionAt: '2026-11-05T09:00:00.000Z',
    nodeId: 'n2',
    nodeName: '=HYPERLINK("http://evil.example","Store Two")',
    productId: 'p2',
    productName: '@SUM(1+1)',
    currency: 'ZWG',
    quantity: '1.5',
    turnover: '100',
    warnings: ['UNEXPECTED_DISCOUNT'],
  },
  {
    lineIndex: 2,
    sourceLineKey: '-2+3/l1',
    transactionAt: '2026-11-06T10:15:00.000Z',
    nodeId: 'n1',
    productId: 'p1',
    currency: 'UNKNOWN',
    quantity: '1',
    turnover: '12345678901234567.89',
    warnings: ['CURRENCY_UNKNOWN', 'ZERO_QUANTITY'],
  },
  {
    lineIndex: 3,
    sourceLineKey: 's4/l1',
    transactionAt: '2026-11-06T11:00:00.000Z',
    nodeId: 'n1',
    nodeName: 'Store One',
    productId: 'p1',
    productName: 'Product One',
    currency: 'USD',
    quantity: '1',
    turnover: '0.1',
    warnings: [],
  },
];
const TOTALS = [
  { currency: 'USD', lineCount: 2, quantity: '3', turnover: '5.2' },
  { currency: 'UNKNOWN', lineCount: 1, quantity: '1', turnover: '12345678901234567.89' },
  { currency: 'ZWG', lineCount: 1, quantity: '1.5', turnover: '100' },
];

function savedReport({ rows = ROWS, totals = TOTALS, ...override } = {}) {
  const groups = createGroupAccumulator();
  for (const row of rows) groups.add(row);
  return {
    reportId: ID,
    status: 'completed',
    schemaVersion: 1,
    calculationVersion: 'v-test',
    filters: {
      startDate: '20261101',
      endDate: '20261107',
      departmentIds: [],
      productIds: ['p1', 'p2'],
      brandIds: ['b1'],
      nodeIds: ['n1', 'n2'],
      currencies: [],
    },
    totals,
    rowCount: rows.length,
    provenance: {
      source: 'GAAP_UNITY',
      sourceStartedAt: '2026-11-08T09:58:00.000Z',
      fetchedAt: '2026-11-08T09:59:00.000Z',
      usedCache: false,
      cacheFreshness: 'not_applicable',
      complete: true,
    },
    integrity: {
      checksumAlgorithm: 'sha256',
      rowsChecksum: 'f'.repeat(64),
      verifiedAt: '2026-11-08T10:00:00.000Z',
    },
    startedAt: '2026-11-08T09:57:00.000Z',
    completedAt: '2026-11-08T10:00:00.000Z',
    createdAt: '2026-11-08T09:57:00.000Z',
    summary: buildReportSummary({ totals, rowCount: rows.length, ...groups.result() }),
    ...override,
  };
}

function build({ report = savedReport(), rows = ROWS, streamRows, maxRows, calls = [] } = {}) {
  const exporter = createReportExporter({
    getReport: async (id) => {
      calls.push(['getReport', id]);
      return report;
    },
    streamRows:
      streamRows ??
      async function* fixtureRows(id) {
        calls.push(['streamRows', id]);
        yield* rows;
      },
    maxRows,
    now: () => new Date('2026-11-08T12:00:00.000Z'),
  });
  const reports = createReportsService({
    catalogService: {},
    nodeFiltersService: {},
    prepareReportExport: exporter.prepare,
  });
  return createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
    reports,
  });
}

const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};
const download = (app, path = `${ID}/export`) =>
  request(app).get(`/api/v1/reports/${path}`).buffer(true).parse(binary);

async function load(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}
const cellValues = (sheet) => {
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1)));
  return rows;
};
const findRow = (sheet, label) => cellValues(sheet).find((row) => row[0] === label);

describe('GET /api/v1/reports/:reportId/export (FIXTURE saved report, no MongoDB, no GAAP)', () => {
  it('downloads a valid workbook with the four worksheets in order', async () => {
    const res = await download(build());
    assert.equal(res.status, 200);
    assert.equal(
      res.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.equal(
      res.headers['content-disposition'],
      `attachment; filename="simbisa-sales-report-${ID}-20261101-20261107.xlsx"`,
    );
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    // An .xlsx file is a zip archive.
    assert.equal(res.body.subarray(0, 2).toString('latin1'), 'PK');

    const workbook = await load(res.body);
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      [SHEET_NAMES.summary, SHEET_NAMES.products, SHEET_NAMES.currencies, SHEET_NAMES.raw],
    );
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['Summary', 'Product Details', 'Currency Summary', 'Raw Transactions'],
    );
  });

  it('keeps the saved totals in the Summary and Currency Summary, one line per currency', async () => {
    const workbook = await load((await download(build())).body);
    for (const name of ['Summary', 'Currency Summary']) {
      const rows = cellValues(workbook.getWorksheet(name));
      // The totals table comes first in both sheets (the Currency Summary lists nodes after it).
      const byCurrency = {};
      for (const row of rows) {
        if (['USD', 'ZWG', 'UNKNOWN'].includes(row[0])) byCurrency[row[0]] ??= row;
      }
      assert.deepEqual(Object.keys(byCurrency).sort(), ['UNKNOWN', 'USD', 'ZWG'], name);
      // [currency, lines, quantity, turnover]
      assert.deepEqual(byCurrency.USD.slice(0, 4), ['USD', 2, 3, 5.2], name);
      assert.deepEqual(byCurrency.ZWG.slice(0, 4), ['ZWG', 1, 1.5, 100], name);
      // Too precise for a number: the exact saved text, not a rounded float.
      assert.deepEqual(
        byCurrency.UNKNOWN.slice(0, 4),
        ['UNKNOWN', 1, 1, '12345678901234567.89'],
        name,
      );
    }
    const summary = workbook.getWorksheet('Summary');
    assert.equal(findRow(summary, 'Report ID')[1], ID);
    assert.equal(findRow(summary, 'Calculation version')[1], 'v-test');
    assert.equal(findRow(summary, 'Lines in report')[1], 4);
    assert.equal(findRow(summary, 'Cached data used')[1], 'No');
    assert.equal(findRow(summary, 'Integrity checksum of saved lines')[1], 'f'.repeat(64));
    assert.equal(
      findRow(summary, 'Start date (Africa/Harare day)')[1].toISOString(),
      '2026-11-01T00:00:00.000Z',
    );
    assert.equal(findRow(summary, 'Products selected')[1], 2);
    assert.equal(
      findRow(summary, 'Source fetched (UTC)')[1].toISOString(),
      '2026-11-08T09:59:00.000Z',
    );
    assert.equal(
      findRow(summary, 'Workbook exported (UTC)')[1].toISOString(),
      '2026-11-08T12:00:00.000Z',
    );
    // UNKNOWN is called out and no cross-currency total exists anywhere.
    assert.ok(findRow(summary, 'Warning')[1].includes('not USD'));
    assert.equal(
      cellValues(summary).some((row) => /^total$/i.test(String(row[0]))),
      false,
    );
    assert.equal(findRow(summary, 'UNEXPECTED_DISCOUNT')[1], 1);
  });

  it('lists product groups per currency in Product Details, matching the saved rows', async () => {
    const workbook = await load((await download(build())).body);
    const rows = cellValues(workbook.getWorksheet('Product Details'));
    assert.deepEqual(rows[0], [
      'Currency',
      'Product ID',
      'Product name',
      'Lines',
      'Quantity',
      'Turnover',
    ]);
    const data = rows.slice(1).map((row) => [row[0], row[1], row[3], row[4], row[5]]);
    assert.deepEqual(data, [
      ['USD', 'p1', 2, 3, 5.2],
      ['ZWG', 'p2', 1, 1.5, 100],
      ['UNKNOWN', 'p1', 1, 1, '12345678901234567.89'],
    ]);
  });

  it('writes every saved row to Raw Transactions with typed cells', async () => {
    const workbook = await load((await download(build())).body);
    const sheet = workbook.getWorksheet('Raw Transactions');
    const rows = cellValues(sheet);
    assert.equal(rows.length, ROWS.length + 1);
    assert.deepEqual(rows[0].slice(0, 4), [
      'Line',
      'Source line key',
      'Transaction time (UTC)',
      'Node ID',
    ]);

    const first = sheet.getRow(2);
    assert.equal(first.getCell(1).value, 1);
    assert.equal(first.getCell(2).value, 's1/l1');
    // A real date, not text, written in UTC.
    assert.ok(first.getCell(3).value instanceof Date);
    assert.equal(first.getCell(3).value.toISOString(), '2026-11-05T08:30:00.000Z');
    assert.equal(first.getCell(3).numFmt, 'yyyy-mm-dd hh:mm:ss');
    assert.equal(first.getCell(10).value, 'USD');
    // Amounts are numbers (not preformatted currency strings), each with its currency in its own column.
    assert.equal(first.getCell(11).value, 2);
    assert.equal(first.getCell(12).value, 5.1);
    assert.equal(typeof first.getCell(12).value, 'number');
    assert.match(first.getCell(12).numFmt, /#,##0\.00/);

    const unknown = sheet.getRow(4);
    assert.equal(unknown.getCell(10).value, 'UNKNOWN');
    assert.equal(unknown.getCell(12).value, '12345678901234567.89');
    assert.equal(unknown.getCell(13).value, 'CURRENCY_UNKNOWN; ZERO_QUANTITY');
    // Missing optional text stays an empty cell, never "undefined" or "null".
    assert.equal(unknown.getCell(5).value, null);
    assert.equal(unknown.getCell(7).value, null);
  });

  it('turns formula-injection values in source-controlled cells into plain text', async () => {
    const workbook = await load((await download(build())).body);
    const sheet = workbook.getWorksheet('Raw Transactions');
    const row = sheet.getRow(3);
    assert.equal(row.getCell(5).value, `'=HYPERLINK("http://evil.example","Store Two")`);
    assert.equal(row.getCell(7).value, "'@SUM(1+1)");
    assert.equal(sheet.getRow(4).getCell(2).value, "'-2+3/l1");
    // None of them is a formula cell.
    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow((r) =>
        r.eachCell((cell) => {
          assert.equal(
            typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value,
            false,
          );
        }),
      );
    }
    // The same texts, escaped, in the grouped sheets.
    const nodes = cellValues(workbook.getWorksheet('Currency Summary'));
    assert.ok(nodes.some((r) => r[2] === `'=HYPERLINK("http://evil.example","Store Two")`));
    const products = cellValues(workbook.getWorksheet('Product Details'));
    assert.ok(products.some((r) => r[2] === "'@SUM(1+1)"));
  });

  it('never uses the raw XML text of a hostile value as a formula element', async () => {
    const res = await download(build());
    const zip = await new ExcelJS.Workbook().xlsx.load(res.body);
    assert.ok(zip);
    // Unzip check via JSZip (an ExcelJS dependency): no sheet contains an <f> formula element.
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(res.body);
    for (const name of Object.keys(archive.files).filter((n) => n.startsWith('xl/worksheets/'))) {
      const xml = await archive.file(name).async('string');
      assert.equal(/<f[ >]/.test(xml), false, name);
    }
  });

  it('exports an empty completed report as a valid workbook with headers and no lines', async () => {
    const app = build({ report: savedReport({ rows: [], totals: [] }), rows: [] });
    const res = await download(app);
    assert.equal(res.status, 200);
    const workbook = await load(res.body);
    assert.equal(cellValues(workbook.getWorksheet('Raw Transactions')).length, 1);
    assert.equal(cellValues(workbook.getWorksheet('Product Details')).length, 1);
    assert.equal(
      findRow(workbook.getWorksheet('Summary'), 'No lines')[1],
      'This report has no saved lines.',
    );
  });

  it('streams a large report completely', async () => {
    const count = 20_000;
    const rows = Array.from({ length: count }, (_, i) => ({
      ...ROWS[0],
      lineIndex: i,
      sourceLineKey: `s${i}/l1`,
      turnover: '1.25',
      quantity: '1',
    }));
    const totals = [
      {
        currency: 'USD',
        lineCount: count,
        quantity: String(count),
        turnover: String(count * 1.25),
      },
    ];
    const res = await download(build({ report: savedReport({ rows, totals }), rows }));
    assert.equal(res.status, 200);
    const sheet = (await load(res.body)).getWorksheet('Raw Transactions');
    assert.equal(sheet.rowCount, count + 1);
    assert.equal(sheet.getRow(count + 1).getCell(2).value, `s${count - 1}/l1`);
  });

  it('answers 404 for an unknown report and 409 for one that is not completed', async () => {
    const missing = await download(build({ report: null }));
    assert.equal(missing.status, 404);
    for (const status of ['pending', 'failed']) {
      const res = await request(build({ report: savedReport({ status }) })).get(
        `/api/v1/reports/${ID}/export`,
      );
      assert.equal(res.status, 409, status);
      assert.equal(res.body.error.code, 'REPORT_NOT_COMPLETED');
      assert.equal(res.headers['content-type'].includes('json'), true);
      assert.equal(res.headers['content-disposition'], undefined);
    }
  });

  it('rejects malformed ids and any query parameter before reading the report', async () => {
    const calls = [];
    const app = build({ calls });
    for (const path of ['nope/export', `${'a'.repeat(23)}/export`, `${'g'.repeat(24)}/export`]) {
      const res = await request(app).get(`/api/v1/reports/${path}`);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.error.code, 'INVALID_REPORT_ID', path);
    }
    const res = await request(app).get(`/api/v1/reports/${ID}/export?format=csv`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_QUERY');
    assert.deepEqual(calls, []);
  });

  it('refuses a report with more lines than one worksheet holds, before streaming', async () => {
    const calls = [];
    const res = await request(build({ maxRows: 3, calls })).get(`/api/v1/reports/${ID}/export`);
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'EXPORT_TOO_LARGE');
    assert.equal(res.body.error.details.maxRows, 3);
    assert.equal(res.headers['content-disposition'], undefined);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['getReport'],
    );
  });

  it('hides integrity problem codes behind a safe 500 when the saved report fails its check', async () => {
    const exporter = createReportExporter({
      getReport: async () => {
        throw new SnapshotIntegrityError(['CHECKSUM_MISMATCH']);
      },
      streamRows: async function* never() {},
    });
    const reports = createReportsService({
      catalogService: {},
      nodeFiltersService: {},
      prepareReportExport: exporter.prepare,
    });
    const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
      reports,
    });
    const res = await request(app).get(`/api/v1/reports/${ID}/export`);
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'SNAPSHOT_INTEGRITY_ERROR');
    assert.doesNotMatch(JSON.stringify(res.body), /CHECKSUM/);
    assert.equal(res.headers['content-disposition'], undefined);
  });

  it('does not deliver a workbook when the saved rows fail verification mid-stream', async () => {
    const app = build({
      streamRows: async function* tampered() {
        yield ROWS[0];
        throw new SnapshotIntegrityError(['CHECKSUM_MISMATCH']);
      },
    });
    // Streaming had begun, so the connection is destroyed rather than a "complete" file being sent.
    await assert.rejects(download(app), /socket hang up|aborted|ECONNRESET/i);
  });

  it('does not leak store errors', async () => {
    const exporter = createReportExporter({
      getReport: async () => {
        throw new Error('mongodb://user:secret@host exploded');
      },
      streamRows: async function* never() {},
    });
    const reports = createReportsService({
      catalogService: {},
      nodeFiltersService: {},
      prepareReportExport: exporter.prepare,
    });
    const app = createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173' }), {
      reports,
    });
    const res = await request(app).get(`/api/v1/reports/${ID}/export`);
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /secret|mongodb:/);
  });
});

describe('export makes no GAAP call', () => {
  it('has no GAAP dependency: the exporter only receives two saved-data readers', () => {
    assert.equal(createReportExporter.length, 1);
    const calls = [];
    const exporter = createReportExporter({
      getReport: async (id) => (calls.push(id), savedReport()),
      streamRows: async function* rows() {
        yield* ROWS;
      },
    });
    assert.deepEqual(Object.keys(exporter), ['prepare']);
  });

  it('the exports module imports nothing from the GAAP client or adapters', () => {
    const dir = new URL('../modules/exports/', import.meta.url);
    for (const file of readdirSync(dir).filter(
      (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
    )) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      // Only the pure decimal helper from the GAAP module is allowed (it makes no request).
      for (const specifier of imports.filter((s) => /gaap|axios|fetch/i.test(s))) {
        assert.equal(specifier, '../gaap/decimal-sum.js', `${file} imports ${specifier}`);
      }
    }
  });
});
