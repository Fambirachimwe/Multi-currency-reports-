import { SelectionError } from '../catalog/node-filters.js';
import { inclusiveDayCount, todayInReportingTimezone } from './report-dates.js';
import { DEFAULT_REPORT_LIMITS } from './report-limits.js';
import { parseReportRequest } from './report-request.js';

/** Status contract of a report. Creating a report can only ever answer `pending`. */
export const REPORT_CREATE_STATUS = 'pending';

/** A well-formed request that cannot be accepted (stale ids, over the workload cap, ...). */
export class ReportRejectedError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReportRejectedError';
    this.code = code;
    this.details = details;
  }
}

/** No report exists with the requested id. */
export class ReportNotFoundError extends Error {
  constructor() {
    super('No report was found with that id.');
    this.name = 'ReportNotFoundError';
    this.code = 'REPORT_NOT_FOUND';
  }
}

/** The report exists but is pending or failed, so it has no saved rows. */
export class ReportNotCompletedError extends Error {
  /** @param {string} status */
  constructor(status) {
    super('This report is not completed, so it has no saved rows to show.');
    this.name = 'ReportNotCompletedError';
    this.code = 'REPORT_NOT_COMPLETED';
    this.status = status;
  }
}

/** The report already finished, so it can no longer be cancelled. */
export class ReportNotCancellableError extends Error {
  /** @param {string} status */
  constructor(status) {
    super('This report has already finished, so it cannot be cancelled.');
    this.name = 'ReportNotCancellableError';
    this.code = 'REPORT_NOT_CANCELLABLE';
    this.status = status;
  }
}

/** The request is valid but report execution is switched off (no `startReport` provided). */
export class ReportExecutionDisabledError extends Error {
  /** @param {Record<string, unknown>} summary */
  constructor(summary) {
    super(
      'The request is valid, but report generation is not enabled yet, so no report was created.',
    );
    this.name = 'ReportExecutionDisabledError';
    this.code = 'REPORT_EXECUTION_NOT_ENABLED';
    this.summary = summary;
  }
}

/**
 * Report request intake: validates, normalizes and caps one request, then hands it to execution.
 *
 * Execution is feature-gated: `startReport` is the only way a report is ever created. Without it
 * the service validates and then refuses with `ReportExecutionDisabledError`; it never invents a
 * report ID, so there is no false "pending" or "completed" record. Feature 13 ships without it.
 *
 * @param {object} deps
 * @param {{ validateProductIds: Function }} deps.catalogService
 * @param {{ resolveSelection: Function }} deps.nodeFiltersService
 * @param {typeof DEFAULT_REPORT_LIMITS} [deps.limits]
 * @param {(args: { request: object, requestId?: string }) => Promise<{ reportId: string, status: string }>} [deps.startReport]
 * @param {(reportId: string) => Promise<object | null>} [deps.getReportStatus] Lifecycle read (no totals/rows).
 * @param {() => Date} [deps.now]
 */
export function createReportsService({
  catalogService,
  nodeFiltersService,
  limits = DEFAULT_REPORT_LIMITS,
  startReport,
  getReportStatus: readStatus,
  cancelReport: cancelPending,
  listReports: readList,
  getReport: readReport,
  listReportRows: readRows,
  prepareReportExport,
  now = () => new Date(),
}) {
  async function resolveNodes(nodes, requestId) {
    try {
      const { selection, meta } = await nodeFiltersService.resolveSelection({
        selection: nodes,
        requestId,
      });
      return { selection, meta };
    } catch (error) {
      if (error instanceof SelectionError) {
        throw new ReportRejectedError(error.code, error.message, { unknownIds: error.unknownIds });
      }
      throw error;
    }
  }

  async function checkProducts(productIds, requestId) {
    try {
      await catalogService.validateProductIds({ productIds, requestId });
    } catch (error) {
      if (error instanceof SelectionError) {
        throw new ReportRejectedError(error.code, error.message, { unknownIds: error.unknownIds });
      }
      throw error;
    }
  }

  /**
   * @param {{ body: unknown, requestId?: string }} input
   * @returns {Promise<{ data: { reportId: string, status: 'pending', request: object }, meta: object }>}
   * @throws {import('./report-request.js').ReportRequestError} 400: shape/field errors
   * @throws {ReportRejectedError} 422: unknown ids, incomplete node list, workload over the cap
   * @throws {ReportExecutionDisabledError} 501: valid, but execution is gated off
   */
  async function createReport({ body, requestId }) {
    const parsed = parseReportRequest(body, {
      limits,
      today: todayInReportingTimezone(now()),
    });

    const { selection, meta: nodeMeta } = await resolveNodes(parsed.nodes, requestId);
    // "All nodes" is only meaningful when the node list is whole.
    if (parsed.nodes.mode === 'all' && nodeMeta.complete !== true) {
      throw new ReportRejectedError(
        'NODE_LIST_INCOMPLETE',
        'The node list is incomplete, so "all nodes" cannot be guaranteed. Refresh the nodes and retry.',
      );
    }

    const days = inclusiveDayCount(parsed.startDate, parsed.endDate);
    const nodeDays = selection.nodeIds.length * days;
    if (selection.nodeIds.length > limits.maxNodes || nodeDays > limits.maxNodeDays) {
      throw new ReportRejectedError(
        'WORKLOAD_TOO_LARGE',
        'The selection is too large for one report. Narrow the nodes or the date range.',
        {
          nodeCount: selection.nodeIds.length,
          days,
          nodeDays,
          maxNodes: limits.maxNodes,
          maxNodeDays: limits.maxNodeDays,
        },
      );
    }

    await checkProducts(parsed.productIds, requestId);

    // Nodes are stored as the exact resolved ids, so the request means the same thing later.
    const request = Object.freeze({
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      productIds: parsed.productIds,
      nodes: selection,
      cachePolicy: parsed.cachePolicy,
    });

    if (startReport === undefined) {
      throw new ReportExecutionDisabledError({
        startDate: request.startDate,
        endDate: request.endDate,
        days,
        productCount: request.productIds.length,
        nodeMode: selection.mode,
        nodeCount: selection.nodeIds.length,
        cachePolicy: request.cachePolicy,
      });
    }

    const started = await startReport({ request, requestId });
    // Creating a report is not completing one: refuse any other answer from execution.
    if (
      typeof started?.reportId !== 'string' ||
      started.reportId === '' ||
      started.status !== REPORT_CREATE_STATUS
    ) {
      throw new Error('startReport must return a reportId with status "pending"');
    }
    return {
      data: { reportId: started.reportId, status: REPORT_CREATE_STATUS, request },
      meta: {
        nodeListFetchedAt: nodeMeta.fetchedAt,
        nodeListCacheFreshness: nodeMeta.cacheFreshness,
        brandDefinition: nodeMeta.brandDefinition,
      },
    };
  }

  /**
   * Lifecycle of one report (pending / completed / failed, source timestamps, failure reason).
   * @param {{ reportId: string }} input
   * @throws {ReportNotFoundError}
   */
  async function getReportStatus({ reportId }) {
    if (readStatus === undefined) throw new Error('Report status reading is not configured');
    const status = await readStatus(reportId);
    if (status === null || status === undefined) throw new ReportNotFoundError();
    return { data: status };
  }

  /**
   * Cancels a report that is still pending: its generation is stopped and the report is deleted, so
   * a cancelled report never appears in Saved Reports.
   * @param {{ reportId: string }} input
   * @throws {ReportNotFoundError} @throws {ReportNotCancellableError}
   */
  async function cancelReport({ reportId }) {
    if (cancelPending === undefined) throw new Error('Report cancelling is not configured');
    const result = await cancelPending(reportId);
    if (!result.found) throw new ReportNotFoundError();
    if (!result.cancelled) throw new ReportNotCancellableError(result.status);
    return { data: { reportId, cancelled: true } };
  }

  /**
   * One page of saved-report metadata (no rows, no id lists). Reports are shared at application
   * level: there is no per-user ownership in v1, so nothing here is scoped to a user.
   * @param {{ status?: string, sort?: string, order?: 'asc'|'desc', limit: number, offset: number }} query
   */
  async function listReports(query) {
    if (readList === undefined) throw new Error('Report listing is not configured');
    const { items, total } = await readList(query);
    return {
      data: items,
      meta: {
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          returned: items.length,
          hasMore: query.offset + items.length < total,
        },
        sort: { field: query.sort, order: query.order },
        status: query.status ?? null,
      },
    };
  }

  /**
   * One saved report: metadata, filters and provenance; when completed, also per-currency totals and
   * product/node groupings read from the saved snapshot (never from GAAP).
   * @param {{ reportId: string }} input
   * @throws {ReportNotFoundError}
   */
  async function getReport({ reportId }) {
    if (readReport === undefined) throw new Error('Report reading is not configured');
    const report = await readReport(reportId);
    if (report === null || report === undefined) throw new ReportNotFoundError();
    return { data: report };
  }

  /**
   * One page of a completed report's saved rows, with totals for the filtered set (Feature 24).
   * Reads MongoDB only; never GAAP.
   * @param {{ reportId: string, query: object }} input `query` is already validated by the controller
   * @throws {ReportNotFoundError} @throws {ReportNotCompletedError}
   */
  async function getReportRows({ reportId, query }) {
    if (readRows === undefined) throw new Error('Report row reading is not configured');
    const result = await readRows(reportId, query);
    if (result === null || result === undefined) throw new ReportNotFoundError();
    if (result.completed !== true) throw new ReportNotCompletedError(result.status);
    return {
      data: result.rows,
      meta: {
        pagination: {
          total: result.total,
          limit: query.limit,
          offset: query.offset,
          returned: result.rows.length,
          hasMore: query.offset + result.rows.length < result.total,
        },
        sort: { field: query.sort, order: query.order },
        filters: {
          search: query.search ?? null,
          currency: query.currency ?? null,
          productId: query.productId ?? null,
          nodeId: query.nodeId ?? null,
        },
        totals: result.totals,
        reportTotals: result.reportTotals,
        reportRowCount: result.rowCount,
      },
    };
  }

  /**
   * Readies the Excel export of one saved report (Feature 26): every check that can still produce a
   * JSON error runs here, then the caller streams the workbook with `write`. Reads MongoDB only.
   * @param {{ reportId: string }} input
   * @throws {ReportNotFoundError} @throws {ReportNotCompletedError}
   */
  async function prepareExport({ reportId }) {
    if (prepareReportExport === undefined) throw new Error('Report export is not configured');
    return prepareReportExport({ reportId });
  }

  return Object.freeze({
    createReport,
    getReportStatus,
    cancelReport,
    listReports,
    getReport,
    getReportRows,
    prepareExport,
  });
}
