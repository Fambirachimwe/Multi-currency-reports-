import { prepareSnapshot } from '../report-snapshot.js';

/**
 * TEST DOUBLE (not used in production): an in-memory report repository that enforces the same
 * transition rules as the MongoDB one (only `pending -> completed | failed`, rows belong to a
 * completed report). Passing against it is not evidence about MongoDB.
 */
export function createReportMemoryRepository({ failOn = {} } = {}) {
  const reports = new Map();
  const rowsByReport = new Map();
  let sequence = 0;

  function pending(reportId) {
    const report = reports.get(reportId);
    if (report === undefined) throw new Error('Report not found');
    if (report.status !== 'pending') throw new Error(`Report is ${report.status}`);
    return report;
  }

  return {
    reports,
    rowsByReport,
    async createPending({ request, startedAt }) {
      if (failOn.createPending) throw new Error('createPending failed');
      sequence += 1;
      const reportId = `r${String(sequence).padStart(23, '0')}`;
      reports.set(reportId, {
        reportId,
        status: 'pending',
        request,
        startedAt,
        provenance: { complete: false },
        error: null,
      });
      return { reportId };
    },
    async markCompleted({ reportId, totals, rows, provenance, calculationVersion, completedAt }) {
      const report = pending(reportId);
      if (failOn.markCompleted) throw new Error('markCompleted failed');
      // Same pre-write integrity rules as the MongoDB repository (throws before anything is stored).
      const prepared = prepareSnapshot({ totals, rows });
      rowsByReport.set(reportId, prepared.rows);
      Object.assign(report, {
        status: 'completed',
        totals,
        rowCount: prepared.rowCount,
        integrity: { rowsChecksum: prepared.checksum },
        provenance,
        calculationVersion,
        completedAt,
      });
    },
    async markFailed({ reportId, code, message, failedAt }) {
      const report = pending(reportId);
      if (failOn.markFailed) throw new Error('markFailed failed');
      Object.assign(report, { status: 'failed', failedAt, error: { code, message } });
    },
    async discardPending({ reportId }) {
      const report = reports.get(reportId);
      if (report === undefined || report.status !== 'pending') return false;
      reports.delete(reportId);
      rowsByReport.delete(reportId);
      return true;
    },
    async getStatus(reportId) {
      const report = reports.get(reportId);
      return report === undefined ? null : { reportId, status: report.status };
    },
  };
}
