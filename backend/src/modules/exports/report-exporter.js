import { ReportNotCompletedError, ReportNotFoundError } from '../reports/reports.service.js';
import { writeReportWorkbook } from './report-workbook.js';
import { exportFilename } from './spreadsheet-safe.js';

/** Excel allows 1,048,576 rows per sheet; one is the header. */
export const EXCEL_MAX_DATA_ROWS = 1_048_575;

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The saved report has more lines than one worksheet can hold, so no workbook is started. */
export class ExportTooLargeError extends Error {
  /** @param {number} rowCount @param {number} maxRows */
  constructor(rowCount, maxRows) {
    super('This report has too many saved lines to export as one Excel workbook.');
    this.name = 'ExportTooLargeError';
    this.code = 'EXPORT_TOO_LARGE';
    this.rowCount = rowCount;
    this.maxRows = maxRows;
  }
}

/**
 * On-demand Excel export of a SAVED report (Feature 26). Its only inputs are two reads of saved
 * MongoDB data, injected by the composition root; it has no GAAP dependency and never stores the
 * workbook. An export is a rendering of the snapshot, not a new report run.
 *
 * `prepare` runs every check that can still be answered with a normal JSON error (the report exists,
 * is completed, fits in a worksheet, and passes its integrity check) before any workbook byte is
 * sent. `write` then streams the workbook.
 *
 * @param {object} deps
 * @param {(reportId: string) => Promise<object | null>} deps.getReport Saved report with totals and
 *   groupings; re-verifies the snapshot and throws `SnapshotIntegrityError` if it does not match.
 * @param {(reportId: string) => AsyncIterable<object>} deps.streamRows Saved rows in `lineIndex` order;
 *   verifies the stream against the saved snapshot and throws `SnapshotIntegrityError` at the end.
 * @param {number} [deps.maxRows]
 * @param {() => Date} [deps.now]
 */
export function createReportExporter({
  getReport,
  streamRows,
  maxRows = EXCEL_MAX_DATA_ROWS,
  now = () => new Date(),
}) {
  /**
   * @param {{ reportId: string }} input
   * @returns {Promise<{ filename: string, contentType: string,
   *   write: (stream: import('node:stream').Writable, options?: { isAborted?: () => boolean }) => Promise<{ completed: boolean, rowCount: number }> }>}
   * @throws {ReportNotFoundError} @throws {ReportNotCompletedError} @throws {ExportTooLargeError}
   * @throws {import('../reports/report-snapshot.js').SnapshotIntegrityError}
   */
  async function prepare({ reportId }) {
    const report = await getReport(reportId);
    if (report === null || report === undefined) throw new ReportNotFoundError();
    if (report.status !== 'completed') throw new ReportNotCompletedError(report.status);
    if (report.rowCount > maxRows) throw new ExportTooLargeError(report.rowCount, maxRows);

    return {
      filename: exportFilename(report),
      contentType: XLSX_CONTENT_TYPE,
      write: (stream, { isAborted } = {}) =>
        writeReportWorkbook({
          stream,
          report,
          rows: () => streamRows(reportId),
          exportedAt: now(),
          isAborted,
        }),
    };
  }

  return Object.freeze({ prepare });
}
