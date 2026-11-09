import mongoose from 'mongoose';
import { REPORT_STATUSES, Report } from '../../models/report.model.js';
import { ROW_ROLLBACK_OPTION, ReportRow } from '../../models/report-row.model.js';
import { createDecimalSum, isDecimalString } from '../gaap/decimal-sum.js';
import { logger } from '../../utils/logger.js';
import {
  SNAPSHOT_CHECKSUM_ALGORITHM,
  SNAPSHOT_PROBLEMS,
  SnapshotIntegrityError,
  createSnapshotVerifier,
  prepareSnapshot,
  reconcileWithTotals,
  toPlainDecimal,
  toRowView,
} from './report-snapshot.js';
import { createGroupAccumulator } from './report-groups.js';
import { buildReportSummary } from './report-summary.js';
import { buildReportName } from './report-name.js';

/** Rows are written in bounded batches so one report never builds one huge insert. */
export const ROW_INSERT_BATCH_SIZE = 1000;

/** Hard bounds that keep every MongoDB document and write far below the 16 MiB / 48 MB limits. */
export const SNAPSHOT_SIZE_LIMITS = Object.freeze({
  /** One stored row (a row is a few hundred bytes; this only catches pathological text). */
  maxRowBytes: 16 * 1024,
  /** One insert batch. */
  maxBatchBytes: 8 * 1024 * 1024,
  /** The report document (filters, totals, provenance): far below the 16 MiB limit. */
  maxReportBytes: 1024 * 1024,
});

/** Largest page of rows a reader can ask for. */
export const MAX_ROW_PAGE_SIZE = 1000;

/** Saved Reports list paging and sort whitelist (public name -> stored field). */
export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;
export const LIST_SORT_FIELDS = Object.freeze({
  createdAt: 'createdAt',
  startDate: 'filters.startDate',
  status: 'status',
});

/**
 * Report detail table (Feature 24): page size, offset and search bounds, and the sort allowlist
 * (public name -> stored field). Nothing outside this list ever reaches a MongoDB query.
 */
export const ROWS_DEFAULT_LIMIT = 50;
export const ROWS_MAX_LIMIT = 200;
export const ROWS_MAX_OFFSET = 1_000_000;
export const ROWS_MAX_SEARCH_LENGTH = 100;
export const ROWS_SORT_FIELDS = Object.freeze({
  lineIndex: 'lineIndex',
  transactionAt: 'transactionAt',
  productName: 'productName',
  nodeName: 'nodeName',
  currency: 'currency',
  quantity: 'quantity',
  turnover: 'turnover',
});

const CURRENCY_FILTER = /^([A-Z]{3}|UNKNOWN)$/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** USD, ZWG and others alphabetically, UNKNOWN last (as the report summary orders them). */
const byCurrency = (a, b) =>
  (a.currency === 'UNKNOWN') - (b.currency === 'UNKNOWN') ||
  (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0);

/** Canonical decimal text (no trailing fraction zeros); `null` when the value is not a plain decimal. */
function canonicalDecimal(value) {
  const plain = toPlainDecimal(value);
  return isDecimalString(plain) ? createDecimalSum().add(plain).toString() : null;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** The full saved filter selection (id lists included), as stored. */
function toFilterView(filters) {
  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    departmentIds: [...(filters.departmentIds ?? [])],
    productIds: [...(filters.productIds ?? [])],
    brandIds: [...(filters.brandIds ?? [])],
    nodeIds: [...(filters.nodeIds ?? [])],
    currencies: [...(filters.currencies ?? [])],
  };
}

/** Maps one aggregated metadata document to the list item contract; missing parts become null. */
function toListItem(document) {
  const provenance = document.provenance ?? null;
  const count = (value) => (Number.isInteger(value) ? value : null);
  return {
    reportId: String(document._id),
    status: document.status ?? null,
    filters: {
      startDate: document.filters?.startDate ?? null,
      endDate: document.filters?.endDate ?? null,
      productCount: count(document.productCount),
      nodeCount: count(document.nodeCount),
      brandCount: count(document.brandCount),
    },
    rowCount: count(document.rowCount),
    calculationVersion: document.calculationVersion ?? null,
    provenance:
      provenance === null
        ? null
        : {
            source: provenance.source ?? null,
            sourceStartedAt: iso(provenance.sourceStartedAt),
            fetchedAt: iso(provenance.fetchedAt),
            usedCache: provenance.usedCache ?? null,
            cacheFreshness: provenance.cacheFreshness ?? null,
            complete: provenance.complete ?? null,
          },
    error: document.error?.code
      ? { code: document.error.code, message: document.error.message ?? null }
      : null,
    startedAt: iso(document.startedAt),
    completedAt: iso(document.completedAt),
    failedAt: iso(document.failedAt),
    createdAt: iso(document.createdAt),
  };
}

export function isReportId(value) {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

const sizeOf = (document) => mongoose.mongo.BSON.calculateObjectSize(document);
const iso = (value) => (value instanceof Date ? value.toISOString() : null);

/** Splits documents into insert batches bounded by row count and by bytes. */
function* batchesOf(documents, { maxRows, maxBytes }) {
  let batch = [];
  let bytes = 0;
  for (const document of documents) {
    const size = sizeOf(document);
    if (batch.length > 0 && (batch.length >= maxRows || bytes + size > maxBytes)) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(document);
    bytes += size;
  }
  if (batch.length > 0) yield batch;
}

/**
 * MongoDB persistence for the report lifecycle and the immutable snapshot (Features 20 and 21).
 * Transitions are only ever `pending -> completed` or `pending -> failed`; a report in any other state is
 * never touched (the model additionally refuses to modify a completed report, and its rows are write-once).
 *
 * Completion (all-or-nothing, as far as MongoDB allows without a multi-document transaction):
 *   1. validate the snapshot in memory (row shape, sequence, no repeated source line, rows reconcile with totals);
 *   2. write rows in bounded batches while the report is still `pending`;
 *   3. read the rows back and compare count, per-currency sums and checksum with what was meant to be written;
 *   4. only then flip the report to `completed` with a conditional update (`status: pending` must still match).
 * Any failure deletes exactly the rows this call wrote, so a non-completed report owns no rows and a
 * completed one always owns all of its rows. The report stays `pending` until step 4 succeeds, and rows
 * are invisible to readers until then (readers only serve completed reports).
 */
export function createReportRepository({
  batchSize = ROW_INSERT_BATCH_SIZE,
  limits = SNAPSHOT_SIZE_LIMITS,
  now = () => new Date(),
} = {}) {
  async function createPending({ request, startedAt }) {
    const report = new Report({
      status: 'pending',
      filters: {
        startDate: request.startDate,
        endDate: request.endDate,
        productIds: request.productIds,
        brandIds: request.nodes.brandIds ?? [],
        nodeIds: request.nodes.nodeIds,
      },
      provenance: {
        source: 'GAAP_UNITY',
        usedCache: false,
        cacheFreshness: 'not_applicable',
        complete: false,
      },
      startedAt,
    });
    await report.save();
    return { reportId: report.id };
  }

  async function loadPending(reportId) {
    if (!isReportId(reportId)) throw new Error('Invalid report id');
    const report = await Report.findById(reportId);
    if (report === null) throw new Error('Report not found');
    if (report.status !== 'pending') {
      throw new Error(`Report is ${report.status}; only a pending report can change state`);
    }
    return report;
  }

  /** Streams a report's rows in `lineIndex` order through a verifier (never holds them all). */
  async function summarizeStoredRows(objectId) {
    const verifier = createSnapshotVerifier();
    const cursor = ReportRow.find({ reportId: objectId })
      .sort({ lineIndex: 1 })
      .lean()
      .cursor({ batchSize });
    for await (const row of cursor) verifier.add(row);
    return verifier.result();
  }

  /** Deletes exactly the rows this call attempted to write; never another call's rows. */
  async function discardRows(objectId, ids) {
    try {
      for (let from = 0; from < ids.length; from += batchSize) {
        await ReportRow.deleteMany({
          reportId: objectId,
          _id: { $in: ids.slice(from, from + batchSize) },
        })
          .setOptions({ [ROW_ROLLBACK_OPTION]: true })
          .exec();
      }
    } catch (error) {
      // The original failure is still thrown; leftover rows belong to a non-completed report.
      logger.error('Could not remove rows of a report that was not completed', {
        reportId: String(objectId),
        errorName: error?.name,
      });
    }
  }

  async function markCompleted({
    reportId,
    totals,
    rows,
    provenance,
    calculationVersion,
    completedAt,
  }) {
    const report = await loadPending(reportId);
    const objectId = new mongoose.Types.ObjectId(reportId);

    // 1. Nothing is written until the snapshot is internally consistent and within size limits.
    const prepared = prepareSnapshot({ totals, rows });
    const documents = prepared.rows.map((row) => ({
      ...row,
      _id: new mongoose.Types.ObjectId(),
      reportId: objectId,
    }));
    if (documents.some((document) => sizeOf(document) > limits.maxRowBytes)) {
      throw new SnapshotIntegrityError([SNAPSHOT_PROBLEMS.ROW_TOO_LARGE]);
    }

    const attemptedIds = [];
    try {
      // 2. Rows, while the report is still pending.
      for (const batch of batchesOf(documents, {
        maxRows: batchSize,
        maxBytes: limits.maxBatchBytes,
      })) {
        // Recorded before the write so a batch that fails halfway is still rolled back.
        for (const document of batch) attemptedIds.push(document._id);
        await ReportRow.insertMany(batch, { ordered: true });
      }

      // 3. Read back and compare with what was meant to be written.
      const stored = await summarizeStoredRows(objectId);
      const readBackProblems = [
        ...stored.problems,
        ...reconcileWithTotals(stored, { totals, rowCount: prepared.rowCount }),
      ];
      if (stored.rowCount !== prepared.rowCount || stored.checksum !== prepared.checksum) {
        readBackProblems.push(SNAPSHOT_PROBLEMS.READBACK_MISMATCH);
      }
      if (readBackProblems.length > 0) {
        throw new SnapshotIntegrityError([...new Set(readBackProblems)].sort());
      }

      // 4. Complete, atomically: the update only matches while the report is still pending.
      report.status = 'completed';
      report.totals = totals;
      report.rowCount = prepared.rowCount;
      report.provenance = provenance;
      report.calculationVersion = calculationVersion;
      report.completedAt = completedAt;
      report.integrity = {
        checksumAlgorithm: SNAPSHOT_CHECKSUM_ALGORITHM,
        rowsChecksum: prepared.checksum,
        verifiedAt: now(),
      };
      await report.validate();
      if (sizeOf(report.toObject()) > limits.maxReportBytes) {
        throw new SnapshotIntegrityError([SNAPSHOT_PROBLEMS.REPORT_DOCUMENT_TOO_LARGE]);
      }
      const result = await Report.updateOne(
        { _id: objectId, status: 'pending' },
        report.$getChanges(),
      );
      if (result.matchedCount !== 1) {
        throw new Error('Report is no longer pending; it was not completed here');
      }
    } catch (error) {
      await discardRows(objectId, attemptedIds);
      throw error;
    }
  }

  async function markFailed({ reportId, code, message, failedAt, provenance }) {
    const report = await loadPending(reportId);
    report.status = 'failed';
    report.failedAt = failedAt;
    report.error = { code, message, occurredAt: failedAt };
    if (provenance !== undefined) report.provenance = provenance;
    await report.save();
  }

  /** Lifecycle view for polling: no totals and no rows. `null` when the report does not exist. */
  function statusView(report) {
    return {
      reportId: String(report._id),
      status: report.status,
      filters: { startDate: report.filters.startDate, endDate: report.filters.endDate },
      startedAt: iso(report.startedAt),
      completedAt: iso(report.completedAt),
      failedAt: iso(report.failedAt),
      rowCount: report.rowCount ?? null,
      calculationVersion: report.calculationVersion ?? null,
      provenance: {
        source: report.provenance.source,
        sourceStartedAt: iso(report.provenance.sourceStartedAt),
        fetchedAt: iso(report.provenance.fetchedAt),
        usedCache: report.provenance.usedCache,
        cacheFreshness: report.provenance.cacheFreshness,
        complete: report.provenance.complete,
      },
      error: report.error
        ? {
            code: report.error.code,
            message: report.error.message ?? null,
            occurredAt: iso(report.error.occurredAt),
          }
        : null,
    };
  }

  /**
   * Removes a report that is still pending, together with any rows written for it. A completed or
   * failed report is never touched. Safe to call twice. Returns whether a report was removed.
   */
  async function discardPending({ reportId }) {
    if (!isReportId(reportId)) return false;
    const objectId = new mongoose.Types.ObjectId(reportId);
    const result = await Report.deleteOne({ _id: objectId, status: 'pending' });
    if (result.deletedCount !== 1) return false;
    await ReportRow.deleteMany({ reportId: objectId })
      .setOptions({ [ROW_ROLLBACK_OPTION]: true })
      .exec();
    return true;
  }

  async function getStatus(reportId) {
    if (!isReportId(reportId)) return null;
    const report = await Report.findById(reportId).lean();
    return report === null ? null : statusView(report);
  }

  /**
   * One saved report for the summary view (Feature 23). Any existing report answers with its
   * metadata and full filters; a COMPLETED one also carries per-currency product and node groupings.
   * Those are built from the saved rows only (never GAAP), in one streamed pass that also re-verifies the
   * snapshot: row count, per-currency sums and checksum must match what was saved at completion, or
   * a {@link SnapshotIntegrityError} is thrown rather than showing numbers that disagree with it.
   * `null` when the report does not exist.
   */
  async function getDetail(reportId) {
    if (!isReportId(reportId)) return null;
    const report = await Report.findById(reportId).lean();
    if (report === null) return null;
    if (report.status !== 'completed') {
      return { ...statusView(report), filters: toFilterView(report.filters) };
    }

    const snapshot = await getSnapshot(reportId);
    if (snapshot === null) return null;
    const verifier = createSnapshotVerifier();
    const groups = createGroupAccumulator();
    const cursor = ReportRow.find({ reportId: report._id })
      .sort({ lineIndex: 1 })
      .lean()
      .cursor({ batchSize });
    for await (const raw of cursor) {
      const row = verifier.add(raw);
      // Unreadable rows are reported as problems below; they are not summed.
      if (
        isDecimalString(row.quantity) &&
        isDecimalString(row.turnover) &&
        typeof row.currency === 'string'
      ) {
        groups.add(row);
      }
    }
    const stored = verifier.result();
    const problems = [
      ...stored.problems,
      ...reconcileWithTotals(stored, { totals: snapshot.totals, rowCount: snapshot.rowCount }),
    ];
    if (stored.checksum !== snapshot.integrity.rowsChecksum) {
      problems.push(SNAPSHOT_PROBLEMS.CHECKSUM_MISMATCH);
    }
    if (problems.length > 0) throw new SnapshotIntegrityError([...new Set(problems)].sort());
    const grouped = groups.result();
    const summary = buildReportSummary({
      totals: snapshot.totals,
      rowCount: snapshot.rowCount,
      ...grouped,
    });
    // Groupings that disagree with the saved totals are never shown.
    if (!summary.consistency.ok) throw new SnapshotIntegrityError(summary.consistency.problems);
    const firstRow = await ReportRow.findOne({ reportId })
      .sort({ lineIndex: 1 })
      .select({ nodeName: 1, productName: 1 })
      .lean();
    const name = buildReportName(firstRow, {
      nodeCount: snapshot.filters.nodeIds.length,
      productCount: snapshot.filters.productIds.length,
    });
    return { ...snapshot, name, summary };
  }

  /**
   * One page of report METADATA for the Saved Reports list. Never returns rows, per-product detail
   * or id lists (only counts), so a page stays small however large the reports are. Every field is
   * read defensively: a damaged or legacy document yields nulls rather than failing the whole page.
   * @param {{ status?: string, sort?: string, order?: 'asc'|'desc', limit?: number, offset?: number }} [query]
   */
  async function list({
    status,
    sort = 'createdAt',
    order = 'desc',
    limit = LIST_DEFAULT_LIMIT,
    offset = 0,
  } = {}) {
    if (!Object.hasOwn(LIST_SORT_FIELDS, sort)) throw new RangeError('Unsupported sort field');
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX_LIMIT) {
      throw new RangeError(`limit must be an integer from 1 to ${LIST_MAX_LIMIT}`);
    }
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError('offset must be >= 0');
    if (status !== undefined && !REPORT_STATUSES.includes(status)) {
      throw new RangeError('Unsupported status');
    }

    const match = status === undefined ? {} : { status };
    const direction = order === 'asc' ? 1 : -1;
    const [total, documents] = await Promise.all([
      Report.countDocuments(match),
      Report.aggregate([
        { $match: match },
        // `_id` makes the order total, so pages never repeat or skip a report.
        { $sort: { [LIST_SORT_FIELDS[sort]]: direction, _id: direction } },
        { $skip: offset },
        { $limit: limit },
        {
          $project: {
            status: 1,
            'filters.startDate': 1,
            'filters.endDate': 1,
            productCount: { $size: { $ifNull: ['$filters.productIds', []] } },
            nodeCount: { $size: { $ifNull: ['$filters.nodeIds', []] } },
            brandCount: { $size: { $ifNull: ['$filters.brandIds', []] } },
            rowCount: 1,
            calculationVersion: 1,
            provenance: 1,
            'error.code': 1,
            'error.message': 1,
            startedAt: 1,
            completedAt: 1,
            failedAt: 1,
            createdAt: 1,
          },
        },
      ]),
    ]);
    // One indexed lookup per completed report for the names on its first saved line.
    const names = await Promise.all(
      documents.map(async (document) => {
        if (document.status !== 'completed') return null;
        const first = await ReportRow.findOne({ reportId: document._id })
          .sort({ lineIndex: 1 })
          .select({ nodeName: 1, productName: 1 })
          .lean();
        return buildReportName(first, document);
      }),
    );
    return {
      items: documents.map((document, index) => ({ ...toListItem(document), name: names[index] })),
      total,
    };
  }

  /**
   * The saved snapshot (metadata, filters, per-currency totals, provenance, integrity) of a COMPLETED
   * report, read from MongoDB only. `null` if the report does not exist or is not completed: a pending
   * or failed report has no snapshot. Rows are read separately with {@link readRows}.
   */
  async function getSnapshot(reportId) {
    if (!isReportId(reportId)) return null;
    const report = await Report.findOne({ _id: reportId, status: 'completed' }).lean();
    if (report === null) return null;
    const { filters, provenance } = report;
    return {
      reportId: String(report._id),
      status: 'completed',
      schemaVersion: report.schemaVersion,
      calculationVersion: report.calculationVersion ?? null,
      filters: toFilterView(filters),
      totals: report.totals.map((total) => ({
        currency: total.currency,
        lineCount: total.lineCount,
        quantity: toPlainDecimal(total.quantity),
        turnover: toPlainDecimal(total.turnover),
      })),
      rowCount: report.rowCount,
      provenance: {
        source: provenance.source,
        sourceStartedAt: iso(provenance.sourceStartedAt),
        fetchedAt: iso(provenance.fetchedAt),
        usedCache: provenance.usedCache,
        cacheFreshness: provenance.cacheFreshness,
        complete: provenance.complete,
      },
      integrity: {
        checksumAlgorithm: report.integrity.checksumAlgorithm,
        rowsChecksum: report.integrity.rowsChecksum,
        verifiedAt: iso(report.integrity.verifiedAt),
      },
      startedAt: iso(report.startedAt),
      completedAt: iso(report.completedAt),
      createdAt: iso(report.createdAt),
    };
  }

  /**
   * One page of a completed report's rows in `lineIndex` order, as stored (decimal text, ISO times).
   * Keyset paging: pass the previous page's `nextAfterLineIndex`. `null` if the report is not completed.
   * @param {string} reportId
   * @param {{ afterLineIndex?: number, limit?: number }} [page]
   */
  async function readRows(reportId, { afterLineIndex = -1, limit = 100 } = {}) {
    if (!isReportId(reportId)) return null;
    if (!Number.isInteger(afterLineIndex) || afterLineIndex < -1) {
      throw new RangeError('afterLineIndex must be an integer >= -1');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROW_PAGE_SIZE) {
      throw new RangeError(`limit must be an integer from 1 to ${MAX_ROW_PAGE_SIZE}`);
    }
    const completed = await Report.exists({ _id: reportId, status: 'completed' });
    if (completed === null) return null;

    const stored = await ReportRow.find({ reportId, lineIndex: { $gt: afterLineIndex } })
      .sort({ lineIndex: 1 })
      .limit(limit + 1)
      .lean();
    const page = stored.slice(0, limit).map(toRowView);
    return {
      rows: page,
      nextAfterLineIndex: stored.length > limit ? page[page.length - 1].lineIndex : null,
    };
  }

  /**
   * Every saved row of a COMPLETED report in `lineIndex` order, streamed from a MongoDB cursor (never
   * all in memory) for the Excel export (Feature 26). Rows are canonical (decimal text, ISO times).
   * The rows are verified as they pass: when the stream ends, their count, per-currency sums and
   * checksum must equal what was saved at completion, otherwise a {@link SnapshotIntegrityError} is
   * thrown, so an export can never silently carry rows that differ from the snapshot. Reads MongoDB only.
   * @param {string} reportId
   * @returns {AsyncGenerator<object>}
   */
  async function* streamRows(reportId) {
    if (!isReportId(reportId)) throw new Error('Invalid report id');
    const report = await Report.findOne({ _id: reportId, status: 'completed' }).lean();
    if (report === null) throw new Error('Report not found or not completed');

    const verifier = createSnapshotVerifier();
    const cursor = ReportRow.find({ reportId: report._id })
      .sort({ lineIndex: 1 })
      .lean()
      .cursor({ batchSize });
    for await (const raw of cursor) yield verifier.add(raw);

    const stored = verifier.result();
    const problems = [
      ...stored.problems,
      ...reconcileWithTotals(stored, { totals: report.totals, rowCount: report.rowCount }),
    ];
    if (stored.checksum !== report.integrity?.rowsChecksum) {
      problems.push(SNAPSHOT_PROBLEMS.CHECKSUM_MISMATCH);
    }
    if (problems.length > 0) throw new SnapshotIntegrityError([...new Set(problems)].sort());
  }

  /**
   * One page of the saved detail rows of ONE report for the detail table (Feature 24). Every query is
   * scoped by `reportId`, so another report's rows can never appear. Sort is limited to
   * {@link ROWS_SORT_FIELDS} and always ends in `lineIndex` (unique per report), so the order is total and
   * pages never repeat or skip (the snapshot is immutable). Filters (all optional, exact unless noted):
   * `currency`, `productId`, `nodeId`, and `search` (case-insensitive text in product/node name or id and the
   * source line key; matched literally, never as a pattern). The page size is capped, so a request can
   * never return the whole collection.
   *
   * `totals` are the exact per-currency sums of ALL rows matching the filters (not just the page), so the
   * table's totals always follow its filters; with no filter they equal the saved report totals.
   * Returns `null` if the report does not exist, `{ completed: false, status }` if it is not completed
   * (it has no rows to show), otherwise `{ completed: true, rows, total, totals, reportTotals, rowCount }`.
   * @param {string} reportId
   * @param {{ sort?: string, order?: 'asc'|'desc', limit?: number, offset?: number,
   *   currency?: string, productId?: string, nodeId?: string, search?: string }} [query]
   */
  async function listRows(
    reportId,
    {
      sort = 'lineIndex',
      order = 'asc',
      limit = ROWS_DEFAULT_LIMIT,
      offset = 0,
      currency,
      productId,
      nodeId,
      search,
    } = {},
  ) {
    if (!isReportId(reportId)) return null;
    if (!Object.hasOwn(ROWS_SORT_FIELDS, sort)) throw new RangeError('Unsupported sort field');
    if (order !== 'asc' && order !== 'desc') throw new RangeError('order must be asc or desc');
    if (!Number.isInteger(limit) || limit < 1 || limit > ROWS_MAX_LIMIT) {
      throw new RangeError(`limit must be an integer from 1 to ${ROWS_MAX_LIMIT}`);
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > ROWS_MAX_OFFSET) {
      throw new RangeError(`offset must be an integer from 0 to ${ROWS_MAX_OFFSET}`);
    }
    if (currency !== undefined && !CURRENCY_FILTER.test(currency)) {
      throw new RangeError('Unsupported currency filter');
    }
    for (const value of [productId, nodeId]) {
      if (
        value !== undefined &&
        (typeof value !== 'string' || value === '' || value.length > 200)
      ) {
        throw new RangeError('Unsupported id filter');
      }
    }
    if (
      search !== undefined &&
      (typeof search !== 'string' || search === '' || search.length > ROWS_MAX_SEARCH_LENGTH)
    ) {
      throw new RangeError('Unsupported search text');
    }

    const report = await Report.findById(reportId)
      .select({ status: 1, totals: 1, rowCount: 1 })
      .lean();
    if (report === null) return null;
    if (report.status !== 'completed') return { completed: false, status: report.status };

    const match = { reportId: report._id };
    if (currency !== undefined) match.currency = currency;
    if (productId !== undefined) match.productId = productId;
    if (nodeId !== undefined) match.nodeId = nodeId;
    if (search !== undefined) {
      const pattern = new RegExp(escapeRegExp(search), 'i');
      match.$or = ['productName', 'nodeName', 'productId', 'nodeId', 'sourceLineKey'].map(
        (field) => ({ [field]: pattern }),
      );
    }

    const direction = order === 'asc' ? 1 : -1;
    const stored = await ReportRow.find(match)
      .sort({ [ROWS_SORT_FIELDS[sort]]: direction, lineIndex: direction })
      .skip(offset)
      .limit(limit)
      .allowDiskUse(true)
      .lean();

    // Exact per-currency sums of the filtered set, summed from the stored decimal text (never floats).
    const sums = new Map();
    const cursor = ReportRow.find(match)
      .select({ currency: 1, quantity: 1, turnover: 1, _id: 0 })
      .lean()
      .cursor({ batchSize });
    for await (const raw of cursor) {
      const quantity = toPlainDecimal(raw.quantity);
      const turnover = toPlainDecimal(raw.turnover);
      if (!isDecimalString(quantity) || !isDecimalString(turnover)) {
        throw new SnapshotIntegrityError([SNAPSHOT_PROBLEMS.ROW_DECIMAL_INVALID]);
      }
      const entry = sums.get(raw.currency) ?? {
        lineCount: 0,
        quantity: createDecimalSum(),
        turnover: createDecimalSum(),
      };
      entry.lineCount += 1;
      entry.quantity.add(quantity);
      entry.turnover.add(turnover);
      sums.set(raw.currency, entry);
    }
    const totals = [...sums.entries()]
      .map(([code, entry]) => ({
        currency: code,
        lineCount: entry.lineCount,
        quantity: entry.quantity.toString(),
        turnover: entry.turnover.toString(),
      }))
      .sort(byCurrency);

    return {
      completed: true,
      rows: stored.map(toRowView),
      total: totals.reduce((n, entry) => n + entry.lineCount, 0),
      totals,
      reportTotals: report.totals
        .map((entry) => ({
          currency: entry.currency,
          lineCount: entry.lineCount,
          // Same canonical text as the summed totals, so equal amounts always read the same.
          quantity: canonicalDecimal(entry.quantity),
          turnover: canonicalDecimal(entry.turnover),
        }))
        .sort(byCurrency),
      rowCount: report.rowCount,
    };
  }

  /**
   * Re-checks a completed snapshot against its own record: row count, per-currency totals and the
   * checksum, from the rows now in MongoDB. Never repairs anything. `null` if not completed.
   * @returns {Promise<{ ok: boolean, problems: string[], rowCount: number } | null>}
   */
  async function verifySnapshot(reportId) {
    if (!isReportId(reportId)) return null;
    const report = await Report.findOne({ _id: reportId, status: 'completed' }).lean();
    if (report === null) return null;
    const stored = await summarizeStoredRows(report._id);
    const problems = [
      ...stored.problems,
      ...reconcileWithTotals(stored, { totals: report.totals, rowCount: report.rowCount }),
    ];
    if (stored.checksum !== report.integrity?.rowsChecksum) {
      problems.push(SNAPSHOT_PROBLEMS.CHECKSUM_MISMATCH);
    }
    const unique = [...new Set(problems)].sort();
    return { ok: unique.length === 0, problems: unique, rowCount: stored.rowCount };
  }

  return Object.freeze({
    createPending,
    markCompleted,
    markFailed,
    discardPending,
    getStatus,
    getDetail,
    list,
    getSnapshot,
    readRows,
    listRows,
    streamRows,
    verifySnapshot,
  });
}
