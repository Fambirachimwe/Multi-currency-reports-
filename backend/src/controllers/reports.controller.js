import {
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  LIST_SORT_FIELDS,
  ROWS_DEFAULT_LIMIT,
  ROWS_MAX_LIMIT,
  ROWS_MAX_OFFSET,
  ROWS_MAX_SEARCH_LENGTH,
  ROWS_SORT_FIELDS,
  ReportBusyError,
  ReportExecutionDisabledError,
  ReportNotCancellableError,
  ReportNotCompletedError,
  ReportNotFoundError,
  ReportRejectedError,
  ReportRequestError,
  SnapshotIntegrityError,
  isReportId,
} from '../modules/reports/index.js';
import { ExportTooLargeError } from '../modules/exports/index.js';
import { ApiError } from '../utils/api-error.js';
import { toApiError } from '../utils/gaap-api-error.js';
import { sendSuccess } from '../utils/http-response.js';
import { logger } from '../utils/logger.js';

/** Maps domain errors to client-safe API errors; anything else passes through (GAAP errors mapped). */
function toReportApiError(error) {
  if (error instanceof ReportRequestError) {
    return new ApiError(400, error.code, error.message, { fields: error.fields });
  }
  if (error instanceof ReportRejectedError) {
    return new ApiError(422, error.code, error.message, error.details);
  }
  if (error instanceof ReportBusyError) {
    return new ApiError(503, error.code, error.message);
  }
  if (error instanceof ReportNotFoundError) {
    return new ApiError(404, error.code, error.message);
  }
  if (error instanceof ReportNotCancellableError) {
    return new ApiError(409, error.code, error.message, { status: error.status });
  }
  if (error instanceof ReportNotCompletedError) {
    return new ApiError(409, error.code, error.message, { status: error.status });
  }
  if (error instanceof ExportTooLargeError) {
    return new ApiError(413, error.code, error.message, { maxRows: error.maxRows });
  }
  if (error instanceof SnapshotIntegrityError) {
    // The problem codes stay in the server log path; the client only learns the report cannot be shown.
    return new ApiError(
      500,
      'SNAPSHOT_INTEGRITY_ERROR',
      'The saved report failed its integrity check, so it is not shown.',
    );
  }
  if (error instanceof ReportExecutionDisabledError) {
    return new ApiError(501, error.code, error.message, {
      validated: true,
      reportCreated: false,
      request: error.summary,
    });
  }
  return toApiError(error);
}

function rejectQuery(req) {
  const [first] = Object.keys(req.query);
  if (first !== undefined) {
    throw new ApiError(400, 'INVALID_QUERY', `Unknown query parameter "${first.slice(0, 40)}".`);
  }
}

const LIST_PARAMS = new Set(['status', 'sort', 'order', 'limit', 'offset']);
const LIST_STATUSES = ['pending', 'completed', 'failed'];

function invalidQuery(message) {
  return new ApiError(400, 'INVALID_QUERY', message);
}

function singleValue(query, name) {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidQuery(`"${name}" must be given once.`);
  return value;
}

function integerParam(query, name, fallback, min, max) {
  const raw = singleValue(query, name);
  if (raw === undefined) return fallback;
  if (!/^\d{1,15}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw invalidQuery(`"${name}" must be an integer from ${min} to ${max}.`);
  }
  return Number(raw);
}

/**
 * Strict `GET /reports` query: status, sort, order, limit, offset. Unknown, repeated or
 * out-of-range values are rejected before anything is read.
 * @returns {{ status?: string, sort: string, order: 'asc'|'desc', limit: number, offset: number }}
 */
export function parseReportListQuery(query) {
  for (const name of Object.keys(query)) {
    if (!LIST_PARAMS.has(name)) {
      throw invalidQuery(`Unknown query parameter "${name.slice(0, 40)}".`);
    }
  }
  const status = singleValue(query, 'status');
  if (status !== undefined && !LIST_STATUSES.includes(status)) {
    throw invalidQuery(`"status" must be one of: ${LIST_STATUSES.join(', ')}.`);
  }
  const sort = singleValue(query, 'sort') ?? 'createdAt';
  if (!Object.hasOwn(LIST_SORT_FIELDS, sort)) {
    throw invalidQuery(`"sort" must be one of: ${Object.keys(LIST_SORT_FIELDS).join(', ')}.`);
  }
  const order = singleValue(query, 'order') ?? 'desc';
  if (order !== 'asc' && order !== 'desc') throw invalidQuery('"order" must be asc or desc.');
  return {
    ...(status === undefined ? {} : { status }),
    sort,
    order,
    limit: integerParam(query, 'limit', LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT),
    offset: integerParam(query, 'offset', 0, 0, 1_000_000_000),
  };
}

const ROWS_PARAMS = new Set([
  'sort',
  'order',
  'limit',
  'offset',
  'search',
  'currency',
  'productId',
  'nodeId',
]);

function textParam(query, name, maxLength) {
  const raw = singleValue(query, name);
  if (raw === undefined) return undefined;
  const text = raw.trim();
  // Control characters have no place in an id or a search; reject rather than strip.
  // eslint-disable-next-line no-control-regex
  if (text === '' || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw invalidQuery(
      `"${name}" must be 1 to ${maxLength} characters without control characters.`,
    );
  }
  return text;
}

/**
 * Strict `GET /reports/:id/rows` query: sort (allowlist), order, limit, offset, search, and the exact
 * filters currency, productId, nodeId. Unknown, repeated, blank or out-of-range values are rejected before
 * anything is read; a blank search or filter is rejected, not ignored.
 */
export function parseReportRowsQuery(query) {
  for (const name of Object.keys(query)) {
    if (!ROWS_PARAMS.has(name)) {
      throw invalidQuery(`Unknown query parameter "${name.slice(0, 40)}".`);
    }
  }
  const sort = singleValue(query, 'sort') ?? 'lineIndex';
  if (!Object.hasOwn(ROWS_SORT_FIELDS, sort)) {
    throw invalidQuery(`"sort" must be one of: ${Object.keys(ROWS_SORT_FIELDS).join(', ')}.`);
  }
  const order = singleValue(query, 'order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') throw invalidQuery('"order" must be asc or desc.');
  const currency = singleValue(query, 'currency');
  if (currency !== undefined && !/^([A-Z]{3}|UNKNOWN)$/.test(currency)) {
    throw invalidQuery('"currency" must be a 3-letter upper-case code or UNKNOWN.');
  }
  const search = textParam(query, 'search', ROWS_MAX_SEARCH_LENGTH);
  const productId = textParam(query, 'productId', 200);
  const nodeId = textParam(query, 'nodeId', 200);
  return {
    sort,
    order,
    limit: integerParam(query, 'limit', ROWS_DEFAULT_LIMIT, 1, ROWS_MAX_LIMIT),
    offset: integerParam(query, 'offset', 0, 0, ROWS_MAX_OFFSET),
    ...(currency === undefined ? {} : { currency }),
    ...(search === undefined ? {} : { search }),
    ...(productId === undefined ? {} : { productId }),
    ...(nodeId === undefined ? {} : { nodeId }),
  };
}

/** @param {{ createReport: Function, getReportStatus: Function, listReports: Function }} service */
export function createReportsHandlers(service) {
  return {
    list: async (req, res) => {
      const query = parseReportListQuery(req.query);
      try {
        const result = await service.listReports(query);
        sendSuccess(res, result.data, { meta: result.meta });
      } catch (error) {
        throw toReportApiError(error);
      }
    },

    create: async (req, res) => {
      rejectQuery(req);
      try {
        const result = await service.createReport({
          body: req.body,
          requestId: res.locals.requestId,
        });
        sendSuccess(res, result.data, { status: 202, meta: result.meta });
      } catch (error) {
        throw toReportApiError(error);
      }
    },

    detail: async (req, res) => {
      rejectQuery(req);
      const { reportId } = req.params;
      if (!isReportId(reportId)) {
        throw new ApiError(400, 'INVALID_REPORT_ID', 'The report id is not valid.');
      }
      try {
        const result = await service.getReport({ reportId });
        sendSuccess(res, result.data);
      } catch (error) {
        throw toReportApiError(error);
      }
    },

    rows: async (req, res) => {
      const { reportId } = req.params;
      if (!isReportId(reportId)) {
        throw new ApiError(400, 'INVALID_REPORT_ID', 'The report id is not valid.');
      }
      const query = parseReportRowsQuery(req.query);
      try {
        const result = await service.getReportRows({ reportId, query });
        sendSuccess(res, result.data, { meta: result.meta });
      } catch (error) {
        throw toReportApiError(error);
      }
    },

    /**
     * Streams the saved report as an .xlsx download. Everything that can fail with a normal JSON error
     * (bad id, unknown/unfinished report, too large, failed integrity check) happens before the first
     * byte. A failure after streaming has begun cannot change the status code, so the connection is
     * destroyed: the client gets an incomplete file that Excel refuses to open, never a quietly
     * truncated "valid" workbook.
     */
    exportWorkbook: async (req, res) => {
      rejectQuery(req);
      const { reportId } = req.params;
      if (!isReportId(reportId)) {
        throw new ApiError(400, 'INVALID_REPORT_ID', 'The report id is not valid.');
      }
      let prepared;
      try {
        prepared = await service.prepareExport({ reportId });
      } catch (error) {
        throw toReportApiError(error);
      }

      let clientGone = false;
      res.on('close', () => {
        if (!res.writableFinished) clientGone = true;
      });
      res.status(200);
      res.setHeader('Content-Type', prepared.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${prepared.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        await prepared.write(res, { isAborted: () => clientGone });
      } catch (error) {
        logger.error('Excel export failed', {
          requestId: res.locals.requestId,
          reportId,
          errorName: error?.name,
          errorCode: error?.code,
          problems: error?.problems,
        });
        if (!res.headersSent) {
          for (const name of ['Content-Type', 'Content-Disposition', 'Cache-Control']) {
            res.removeHeader(name);
          }
          throw toReportApiError(error);
        }
        res.destroy();
      }
    },

    cancel: async (req, res) => {
      rejectQuery(req);
      const { reportId } = req.params;
      if (!isReportId(reportId)) {
        throw new ApiError(400, 'INVALID_REPORT_ID', 'The report id is not valid.');
      }
      try {
        const result = await service.cancelReport({ reportId });
        sendSuccess(res, result.data);
      } catch (error) {
        throw toReportApiError(error);
      }
    },

    status: async (req, res) => {
      rejectQuery(req);
      const { reportId } = req.params;
      if (!isReportId(reportId)) {
        throw new ApiError(400, 'INVALID_REPORT_ID', 'The report id is not valid.');
      }
      try {
        const result = await service.getReportStatus({ reportId });
        sendSuccess(res, result.data);
      } catch (error) {
        throw toReportApiError(error);
      }
    },
  };
}
