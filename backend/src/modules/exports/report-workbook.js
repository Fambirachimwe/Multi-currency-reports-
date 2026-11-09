import ExcelJS from 'exceljs';
import { compactDateToDate, isoToDate, safeText, toExcelAmount } from './spreadsheet-safe.js';

/**
 * Writes the Excel workbook of ONE saved report (Feature 26) to a stream. It renders data that was
 * already saved in MongoDB: the saved snapshot (totals, filters, provenance, groupings) and the saved
 * rows. It never fetches, recalculates or converts anything, and it never merges currencies: every
 * table is keyed by currency and carries the currency code on each line.
 *
 * Worksheets, in order: Summary, Product Details, Currency Summary, Raw Transactions. The workbook
 * is written with ExcelJS' streaming writer and rows are committed as they are produced, so memory
 * stays bounded however many saved rows there are.
 */

export const SHEET_NAMES = Object.freeze({
  summary: 'Summary',
  products: 'Product Details',
  currencies: 'Currency Summary',
  raw: 'Raw Transactions',
});

const FORMATS = Object.freeze({
  count: '#,##0',
  quantity: 'General',
  turnover: '#,##0.00######',
  text: '@',
  date: 'yyyy-mm-dd',
  dateTime: 'yyyy-mm-dd hh:mm:ss',
});

const HEADER_STYLE = Object.freeze({
  font: { bold: true },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
  alignment: { vertical: 'middle', wrapText: true },
});
const TITLE_FONT = Object.freeze({ bold: true, size: 14 });
const SECTION_FONT = Object.freeze({ bold: true, size: 12 });

/** Rows written between checks that the client is still reading and keeping up. */
export const FLUSH_EVERY_ROWS = 500;

/** Wait until the response drains (or closes) so a slow client cannot make memory grow without bound. */
function waitForStream(stream) {
  if (stream.writableNeedDrain !== true) return new Promise((resolve) => setImmediate(resolve));
  return new Promise((resolve) => {
    const done = () => {
      stream.off('drain', done);
      stream.off('close', done);
      resolve();
    };
    stream.once('drain', done);
    stream.once('close', done);
  });
}

/** A cell: a plain value, or `{ value, numFmt }` to set a number format. */
const isCell = (cell) => cell !== null && typeof cell === 'object' && !(cell instanceof Date);

/** Adds and commits one row; `style` is applied to every cell given. */
function put(sheet, cells, { style, font } = {}) {
  const row = sheet.addRow(cells.map((cell) => (isCell(cell) ? cell.value : cell)));
  cells.forEach((cell, index) => {
    const target = row.getCell(index + 1);
    if (isCell(cell) && cell.numFmt !== undefined) target.numFmt = cell.numFmt;
    if (style !== undefined) Object.assign(target, style);
    if (font !== undefined) target.font = font;
  });
  row.commit();
}

/**
 * A saved amount: a number when Excel can hold it exactly, otherwise the exact saved text (never a
 * silently rounded number). Unreadable text is shown as saved.
 */
function amountCell(value, numFmt) {
  const amount = toExcelAmount(value);
  if (amount.value === null) return { value: safeText(value), numFmt: FORMATS.text };
  return { value: amount.value, numFmt: amount.exact ? numFmt : FORMATS.text };
}

const dateCell = (value) => {
  const date = compactDateToDate(value);
  return date === null ? safeText(value) : { value: date, numFmt: FORMATS.date };
};
const instantCell = (value) => {
  const date = isoToDate(value);
  return date === null ? null : { value: date, numFmt: FORMATS.dateTime };
};
const countCell = (value) => ({
  value: Number.isInteger(value) ? value : null,
  numFmt: FORMATS.count,
});
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : null);

/** A sheet whose first row is a frozen header. */
function tableSheet(workbook, name, columns) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([, width]) => ({ width }));
  put(
    sheet,
    columns.map(([label]) => label),
    { style: HEADER_STYLE },
  );
  return sheet;
}

/**
 * @param {object} input
 * @param {import('node:stream').Writable} input.stream Destination (the HTTP response).
 * @param {object} input.report The saved report as returned by the repository's `getDetail`
 *   (completed): metadata, filters, provenance, integrity, per-currency `totals` and `summary`.
 * @param {() => AsyncIterable<object>} input.rows Opens the saved rows in `lineIndex` order.
 * @param {Date} input.exportedAt When this export was produced.
 * @param {() => boolean} [input.isAborted] True once the client has gone away.
 * @returns {Promise<{ completed: boolean, rowCount: number }>} `completed: false` when the client left
 *   before the workbook was finished (nothing was committed).
 */
export async function writeReportWorkbook({
  stream,
  report,
  rows,
  exportedAt,
  isAborted = () => false,
}) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: false,
    created: exportedAt,
    modified: exportedAt,
    creator: 'Simbisa Sales Reporting',
    lastModifiedBy: 'Simbisa Sales Reporting',
  });

  writeSummarySheet(workbook, report, exportedAt);
  writeProductSheet(workbook, report.summary);
  writeCurrencySheet(workbook, report);
  const raw = await writeRawSheet(workbook, rows, isAborted, stream);
  if (!raw.completed) return raw;

  await workbook.commit();
  return raw;
}

function writeSummarySheet(workbook, report, exportedAt) {
  const sheet = workbook.addWorksheet(SHEET_NAMES.summary);
  sheet.columns = [{ width: 38 }, { width: 26 }, { width: 18 }, { width: 22 }];
  const { filters, provenance, integrity, summary } = report;
  const line = (label, value) => put(sheet, [label, value]);
  const section = (title) => {
    put(sheet, []);
    put(sheet, [title], { font: SECTION_FONT });
  };

  put(sheet, ['Sales report: saved snapshot'], { font: TITLE_FONT });
  line(
    'Source',
    'Rendered from the report saved in the application database. GAAP was not contacted and nothing was recalculated.',
  );

  section('Report');
  line('Report ID', safeText(report.reportId));
  line('Status', safeText(report.status));
  line('Calculation version', safeText(report.calculationVersion));
  line('Schema version', report.schemaVersion ?? null);
  line('Lines in report', countCell(report.rowCount));
  line('Report created (UTC)', instantCell(report.createdAt));
  line('Report started (UTC)', instantCell(report.startedAt));
  line('Report completed (UTC)', instantCell(report.completedAt));
  line('Workbook exported (UTC)', { value: exportedAt, numFmt: FORMATS.dateTime });

  section('Source data');
  line('Source system', safeText(provenance?.source));
  line('Source fetch started (UTC)', instantCell(provenance?.sourceStartedAt));
  line('Source fetched (UTC)', instantCell(provenance?.fetchedAt));
  line('Cached data used', yesNo(provenance?.usedCache));
  line('Cache freshness', safeText(provenance?.cacheFreshness));
  line('Extraction complete', yesNo(provenance?.complete));
  line('Integrity checksum algorithm', safeText(integrity?.checksumAlgorithm));
  line('Integrity checksum of saved lines', safeText(integrity?.rowsChecksum));
  line('Integrity verified (UTC)', instantCell(integrity?.verifiedAt));

  section('Selected filters');
  line('Start date (Africa/Harare day)', dateCell(filters?.startDate));
  line('End date (Africa/Harare day, inclusive)', dateCell(filters?.endDate));
  line('Products selected', countCell(filters?.productIds?.length));
  line('Nodes selected', countCell(filters?.nodeIds?.length));
  line('Brands selected', countCell(filters?.brandIds?.length));

  section('Totals by currency');
  line(
    'Note',
    'Each currency is totalled on its own. No amount in this workbook is converted or added across currencies.',
  );
  put(sheet, ['Currency', 'Lines', 'Quantity', 'Turnover'], { style: HEADER_STYLE });
  for (const total of summary.currencies) {
    put(sheet, [
      safeText(total.currency),
      countCell(total.lineCount),
      amountCell(total.quantity, FORMATS.quantity),
      amountCell(total.turnover, FORMATS.turnover),
    ]);
  }
  if (summary.currencies.length === 0) line('No lines', 'This report has no saved lines.');
  if (summary.currencies.some((total) => total.currency === 'UNKNOWN')) {
    line(
      'Warning',
      'UNKNOWN is lines whose currency could not be determined. It is not USD, not ZWG and not converted.',
    );
  }
  line(
    'Number format',
    'Amounts are numbers. An amount with more digits than an Excel number holds exactly is written as text, so nothing is rounded.',
  );

  section('Line warnings');
  if (summary.warnings.length === 0) line('Warnings', 'None recorded on saved lines.');
  for (const warning of summary.warnings) {
    put(sheet, [safeText(warning.code), countCell(warning.rowCount)]);
  }

  // Selected ids come last so the summary above stays short however many ids were selected.
  for (const [title, ids] of [
    ['Selected product IDs', filters?.productIds],
    ['Selected node IDs', filters?.nodeIds],
    ['Selected brand IDs', filters?.brandIds],
  ]) {
    if (!Array.isArray(ids) || ids.length === 0) continue;
    section(title);
    for (const id of ids) put(sheet, [safeText(id)]);
  }
  sheet.commit();
}

const GROUP_COLUMNS = (idLabel, nameLabel) => [
  ['Currency', 10],
  [idLabel, 24],
  [nameLabel, 40],
  ['Lines', 10],
  ['Quantity', 16],
  ['Turnover', 18],
];

const groupRow = (group) => [
  safeText(group.currency),
  safeText(group.id),
  safeText(group.name),
  countCell(group.lineCount),
  amountCell(group.quantity, FORMATS.quantity),
  amountCell(group.turnover, FORMATS.turnover),
];

function writeProductSheet(workbook, summary) {
  const sheet = tableSheet(
    workbook,
    SHEET_NAMES.products,
    GROUP_COLUMNS('Product ID', 'Product name'),
  );
  for (const group of summary.products) put(sheet, groupRow(group));
  sheet.commit();
}

function writeCurrencySheet(workbook, report) {
  const { summary } = report;
  const sheet = workbook.addWorksheet(SHEET_NAMES.currencies);
  sheet.columns = [10, 24, 40, 10, 16, 18, 60].map((width) => ({ width }));

  put(sheet, ['Totals by currency'], { font: SECTION_FONT });
  put(sheet, ['Currency', 'Lines', 'Quantity', 'Turnover', 'Products', 'Nodes', 'Note'], {
    style: HEADER_STYLE,
  });
  const countFor = (groups, currency) => groups.filter((g) => g.currency === currency).length;
  for (const total of summary.currencies) {
    put(sheet, [
      safeText(total.currency),
      countCell(total.lineCount),
      amountCell(total.quantity, FORMATS.quantity),
      amountCell(total.turnover, FORMATS.turnover),
      countCell(countFor(summary.products, total.currency)),
      countCell(countFor(summary.nodes, total.currency)),
      total.currency === 'UNKNOWN'
        ? 'Currency could not be determined: not USD, not ZWG, not converted.'
        : null,
    ]);
  }

  put(sheet, []);
  put(sheet, ['Totals by node and currency'], { font: SECTION_FONT });
  put(
    sheet,
    GROUP_COLUMNS('Node ID', 'Node name').map(([label]) => label),
    {
      style: HEADER_STYLE,
    },
  );
  for (const group of summary.nodes) put(sheet, groupRow(group));
  sheet.commit();
}

const RAW_COLUMNS = Object.freeze([
  ['Line', 8],
  ['Source line key', 30],
  ['Transaction time (UTC)', 22],
  ['Node ID', 24],
  ['Node name', 30],
  ['Product ID', 24],
  ['Product name', 36],
  ['Department ID', 18],
  ['Brand ID', 18],
  ['Currency', 10],
  ['Quantity', 14],
  ['Turnover', 18],
  ['Warnings', 40],
]);

async function writeRawSheet(workbook, rows, isAborted, stream) {
  const sheet = tableSheet(workbook, SHEET_NAMES.raw, RAW_COLUMNS);
  let rowCount = 0;
  for await (const row of rows()) {
    if (isAborted()) return { completed: false, rowCount };
    put(sheet, [
      // One-based line number for readers; the saved lineIndex is zero-based.
      Number.isInteger(row.lineIndex) ? row.lineIndex + 1 : null,
      safeText(row.sourceLineKey),
      instantCell(row.transactionAt),
      safeText(row.nodeId),
      safeText(row.nodeName),
      safeText(row.productId),
      safeText(row.productName),
      safeText(row.departmentId),
      safeText(row.brandId),
      safeText(row.currency),
      amountCell(row.quantity, FORMATS.quantity),
      amountCell(row.turnover, FORMATS.turnover),
      safeText((row.warnings ?? []).join('; ') || null),
    ]);
    rowCount += 1;
    if (rowCount % FLUSH_EVERY_ROWS === 0) await waitForStream(stream);
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: RAW_COLUMNS.length } };
  sheet.commit();
  return { completed: true, rowCount };
}
