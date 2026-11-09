import {
  FINANCIAL_AGGREGATION_VERSION,
  SALES_LINE_NORMALIZATION_VERSION,
  CURRENCY_RESOLVER_VERSION,
  ELIGIBILITY_RULES_VERSION,
  GAAP_ERROR_CODES,
  GaapError,
  SALES_MAX_QUERIES,
  aggregateFinancials,
  applyEligibility,
  classifyLineCurrencies,
  normalizeSalesLines,
} from '../gaap/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Report generation (Feature 20): one lifecycle from a validated request to computed results.
 *
 *   fetch (Feature 14) -> select -> normalize (15) -> currency (16) -> eligibility (17)
 *   -> aggregate (18) -> reconcile -> persist -> `completed`; any failure -> `failed`.
 *
 * A report is `completed` only if every step succeeded: an incomplete extraction, an unusable
 * source line, a failed reconciliation or a failed save all end in `failed` with a code and a
 * safe message. Nothing is "partially" completed and nothing is silently left out.
 */

export const FAILURE_CODES = Object.freeze({
  SOURCE_INCOMPLETE: 'SOURCE_INCOMPLETE',
  SOURCE_DATA_INVALID: 'SOURCE_DATA_INVALID',
  SOURCE_TIMEOUT: 'SOURCE_TIMEOUT',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_REQUEST_REJECTED: 'SOURCE_REQUEST_REJECTED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  SNAPSHOT_SAVE_FAILED: 'SNAPSHOT_SAVE_FAILED',
  GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',
  GENERATION_INTERRUPTED: 'GENERATION_INTERRUPTED',
  GENERATION_FAILED: 'GENERATION_FAILED',
});

/** Abort reasons the runner uses; they select the failure code. */
export const ABORT_REASONS = Object.freeze({
  TIMEOUT: 'timeout',
  SHUTDOWN: 'shutdown',
  CANCELLED: 'cancelled',
});

/** A failure with a stable code and a message that is safe to store and show (no source values). */
export class GenerationError extends Error {
  /** @param {string} code one of {@link FAILURE_CODES} @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
  }
}

const SAFE_MESSAGES = Object.freeze({
  [FAILURE_CODES.SOURCE_TIMEOUT]: 'GAAP did not answer in time. No report was produced; try again.',
  [FAILURE_CODES.SOURCE_UNAVAILABLE]:
    'GAAP could not be reached or returned an error. No report was produced; try again.',
  [FAILURE_CODES.SOURCE_REQUEST_REJECTED]:
    'The selection cannot be fetched from GAAP as one request. Narrow the products or nodes.',
  [FAILURE_CODES.GENERATION_TIMEOUT]:
    'The report took longer than the allowed time and was stopped. Narrow the date range or selection.',
  [FAILURE_CODES.GENERATION_INTERRUPTED]:
    'The report was interrupted because the service was stopping. Generate it again.',
  [FAILURE_CODES.GENERATION_FAILED]:
    'The report could not be generated because of an internal error.',
  [FAILURE_CODES.SNAPSHOT_SAVE_FAILED]:
    'The computed report could not be saved, so no report was completed.',
});

/**
 * Sales are never cached in v1 (see `loadSalesCachePolicy`), so every report reads GAAP live
 * whatever the request's `cachePolicy` says. Kept as one function so that the decision, and what
 * is recorded about it, live in one place.
 * @param {{ cachePolicy?: string }} request
 * @param {{ enabled: boolean }} salesCachePolicy
 */
export function decideSalesSource(request, salesCachePolicy) {
  if (salesCachePolicy?.enabled === true) {
    throw new Error('A sales cache is not approved; refusing to use one');
  }
  return Object.freeze({
    source: 'live',
    usedCache: false,
    cacheFreshness: 'not_applicable',
    requestedCachePolicy: request.cachePolicy ?? null,
  });
}

/** Calculation version recorded on each report: the version of every stage that shaped its numbers. */
export function buildCalculationVersion({ rulesVerified }) {
  const base = [
    `lines${SALES_LINE_NORMALIZATION_VERSION}`,
    `cur${CURRENCY_RESOLVER_VERSION}`,
    `elig${ELIGIBILITY_RULES_VERSION}`,
    `agg${FINANCIAL_AGGREGATION_VERSION}`,
  ].join('.');
  return rulesVerified ? base : `${base}+unverified-rules`;
}

/**
 * @typedef {object} ReportRepository
 * @property {(args: { request: object, startedAt: Date }) => Promise<{ reportId: string }>} createPending
 * @property {(args: { reportId: string, totals: object[], rows: object[], provenance: object,
 *   calculationVersion: string, completedAt: Date }) => Promise<void>} markCompleted
 * @property {(args: { reportId: string, code: string, message: string, failedAt: Date,
 *   provenance?: object }) => Promise<void>} markFailed
 */

/**
 * @param {object} deps
 * @param {{ fetchSales: Function }} deps.salesAdapter
 * @param {ReportRepository} deps.repository
 * @param {{ enabled: boolean }} deps.salesCachePolicy
 * @param {boolean} deps.rulesVerified Whether the eligibility rules are owner-verified (recorded).
 * @param {'base' | 'unknown'} [deps.differingCurrencyPolicy]
 * @param {number} [deps.maxQueries]
 * @param {() => Date} [deps.now]
 */
export function createReportGenerator({
  salesAdapter,
  repository,
  salesCachePolicy,
  rulesVerified,
  differingCurrencyPolicy,
  maxQueries = SALES_MAX_QUERIES,
  now = () => new Date(),
}) {
  /**
   * Computes results; throws a {@link GenerationError} for anything that must not complete.
   * Does not persist.
   */
  async function compute({ request, requestId, signal }) {
    const sourceDecision = decideSalesSource(request, salesCachePolicy);
    throwIfAborted(signal);

    const productIds = request.productIds;
    const nodeIds = request.nodes.nodeIds;
    // GAAP can filter by node only via one query per product x node (Feature 14). When that would
    // exceed the cap, fetch per product and apply the (exact, resolved) node set locally.
    const filterNodesAtSource = productIds.length * nodeIds.length <= maxQueries;
    const extraction = await salesAdapter.fetchSales({
      startDate: request.startDate,
      endDate: request.endDate,
      productIds,
      nodeIds: filterNodesAtSource ? nodeIds : undefined,
      signal,
      requestId,
    });
    throwIfAborted(signal);

    if (extraction.complete !== true) {
      throw new GenerationError(
        FAILURE_CODES.SOURCE_INCOMPLETE,
        `GAAP data could not be fetched completely (${extraction.incompleteReasons.join(', ') || 'unknown reason'}; ` +
          `${extraction.failures.length} failed page(s)). No report was produced; try again.`,
      );
    }

    const normalization = normalizeSalesLines(extraction.sales);
    const saleErrors = normalization.saleIssues.filter((issue) => issue.severity === 'error');
    if (saleErrors.length > 0) {
      throw new GenerationError(
        FAILURE_CODES.SOURCE_DATA_INVALID,
        `${saleErrors.length} sale record(s) from GAAP could not be read, so the totals could not be guaranteed.`,
      );
    }

    // A sale lists every product on it; only the selected products at the selected nodes count.
    // A line whose product or node is unknown cannot be ruled out, so it stays (and fails below).
    const productSet = new Set(productIds);
    const nodeSet = new Set(nodeIds);
    const selected = normalization.lines.filter(
      (line) =>
        (line.productId === null || productSet.has(line.productId)) &&
        (line.nodeId === null || nodeSet.has(line.nodeId)),
    );
    const outOfSelectionLineCount = normalization.lines.length - selected.length;

    const unusable = selected.filter((line) => line.usable !== true);
    if (unusable.length > 0) {
      throw new GenerationError(
        FAILURE_CODES.SOURCE_DATA_INVALID,
        `${unusable.length} sales line(s) from GAAP could not be read, so the totals could not be guaranteed.`,
      );
    }

    const currencyOptions =
      differingCurrencyPolicy === undefined ? {} : { differingPolicy: differingCurrencyPolicy };
    const classified = classifyLineCurrencies(selected, currencyOptions).lines;
    const evaluated = applyEligibility(classified);
    const aggregation = aggregateFinancials(evaluated.lines);

    if (aggregation.reconciliation.ok !== true) {
      throw new GenerationError(
        FAILURE_CODES.RECONCILIATION_FAILED,
        'The computed totals did not reconcile with their detail, so the report was not completed.',
      );
    }
    const eligibleLines = evaluated.lines.filter((line) => line.eligibility.eligible === true);
    if (eligibleLines.length !== aggregation.summary.eligibleLineCount) {
      throw new GenerationError(
        FAILURE_CODES.RECONCILIATION_FAILED,
        'The saved lines would not match the computed totals, so the report was not completed.',
      );
    }

    const rows = buildRows(eligibleLines);
    const totals = aggregation.currencies.map(({ currency, totals: t }) => ({
      currency,
      lineCount: t.lineCount,
      quantity: t.quantity,
      turnover: t.turnover,
    }));

    return {
      totals,
      rows,
      provenance: {
        source: 'GAAP_UNITY',
        sourceStartedAt: new Date(extraction.sourceStartedAt),
        fetchedAt: new Date(extraction.fetchedAt),
        usedCache: sourceDecision.usedCache,
        cacheFreshness: sourceDecision.cacheFreshness,
        complete: true,
      },
      calculationVersion: buildCalculationVersion({ rulesVerified }),
      stats: {
        saleCount: extraction.sales.length,
        pageCount: extraction.pageCount,
        queryCount: extraction.queryCount,
        duplicateSaleCount: extraction.duplicateCount,
        lineCount: normalization.lines.length,
        outOfSelectionLineCount,
        excludedLineCount: aggregation.summary.excludedLineCount,
        excludedReasonCounts: aggregation.summary.excludedReasonCounts,
        rowCount: rows.length,
        currencyCodes: aggregation.summary.currencyCodes,
      },
    };
  }

  /**
   * Runs the whole lifecycle for an already-created pending report. Never throws: every outcome is
   * recorded as `completed` or `failed`. (If even recording fails the report stays `pending`; that
   * is logged, never reported as success.)
   * @returns {Promise<{ status: 'completed' | 'failed' | 'cancelled', code?: string }>}
   */
  async function generate({ reportId, request, requestId, signal }) {
    let computed;
    try {
      computed = await compute({ request, requestId, signal });
    } catch (error) {
      if (isCancelled(signal)) return discard({ reportId });
      return fail({ reportId, error, signal });
    }
    // Cancelled while the last step was running: nothing is saved.
    if (isCancelled(signal)) return discard({ reportId });

    try {
      await repository.markCompleted({
        reportId,
        totals: computed.totals,
        rows: computed.rows,
        provenance: computed.provenance,
        calculationVersion: computed.calculationVersion,
        completedAt: now(),
      });
    } catch (error) {
      logger.error('Report snapshot save failed', {
        reportId,
        errorName: error?.name,
        errorCode: error?.code,
      });
      return fail({
        reportId,
        error: new GenerationError(
          FAILURE_CODES.SNAPSHOT_SAVE_FAILED,
          SAFE_MESSAGES[FAILURE_CODES.SNAPSHOT_SAVE_FAILED],
        ),
        signal,
      });
    }

    logger.info('Report completed', { reportId, requestId, ...computed.stats });
    return { status: 'completed' };
  }

  /** A cancelled report is removed, never saved as completed or failed. */
  async function discard({ reportId }) {
    try {
      await repository.discardPending({ reportId });
    } catch (error) {
      logger.error('Could not remove a cancelled report', { reportId, errorName: error?.name });
    }
    logger.info('Report cancelled', { reportId });
    return { status: 'cancelled' };
  }

  async function fail({ reportId, error, signal }) {
    const failure = toFailure(error, signal);
    try {
      await repository.markFailed({
        reportId,
        code: failure.code,
        message: failure.message,
        failedAt: now(),
      });
    } catch (recordError) {
      logger.error('Could not record report failure; report left pending', {
        reportId,
        failureCode: failure.code,
        errorName: recordError?.name,
      });
      return { status: 'failed', code: failure.code, recorded: false };
    }
    logger.warn('Report failed', { reportId, failureCode: failure.code });
    return { status: 'failed', code: failure.code };
  }

  return Object.freeze({ generate, compute });
}

/** Maps any error to a stored failure. Only fixed messages or our own counts are ever stored. */
export function toFailure(error, signal) {
  if (error instanceof GenerationError) return { code: error.code, message: error.message };
  if (signal?.aborted === true) {
    const code =
      signal.reason === ABORT_REASONS.TIMEOUT
        ? FAILURE_CODES.GENERATION_TIMEOUT
        : FAILURE_CODES.GENERATION_INTERRUPTED;
    return { code, message: SAFE_MESSAGES[code] };
  }
  if (error instanceof GaapError) {
    let code = FAILURE_CODES.SOURCE_UNAVAILABLE;
    if (error.code === GAAP_ERROR_CODES.TIMEOUT) code = FAILURE_CODES.SOURCE_TIMEOUT;
    if (error.code === GAAP_ERROR_CODES.INVALID_REQUEST)
      code = FAILURE_CODES.SOURCE_REQUEST_REJECTED;
    return { code, message: SAFE_MESSAGES[code] };
  }
  logger.error('Unexpected report generation error', {
    errorName: error?.name,
    errorCode: error?.code,
  });
  return {
    code: FAILURE_CODES.GENERATION_FAILED,
    message: SAFE_MESSAGES[FAILURE_CODES.GENERATION_FAILED],
  };
}

function isCancelled(signal) {
  return signal?.aborted === true && signal.reason === ABORT_REASONS.CANCELLED;
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw new GenerationError(
      signal.reason === ABORT_REASONS.TIMEOUT
        ? FAILURE_CODES.GENERATION_TIMEOUT
        : FAILURE_CODES.GENERATION_INTERRUPTED,
      SAFE_MESSAGES[
        signal.reason === ABORT_REASONS.TIMEOUT
          ? FAILURE_CODES.GENERATION_TIMEOUT
          : FAILURE_CODES.GENERATION_INTERRUPTED
      ],
    );
  }
}

/**
 * One row per eligible line, in a stable order (time, then source key) so `lineIndex` is
 * reproducible. Warnings carry codes only (line warnings and eligibility notes).
 */
function buildRows(eligibleLines) {
  const ordered = [...eligibleLines].sort(
    (a, b) =>
      compareText(a.transactionAt, b.transactionAt) ||
      compareText(a.sourceLineKey, b.sourceLineKey),
  );
  return ordered.map((line, lineIndex) => ({
    lineIndex,
    sourceLineKey: line.sourceLineKey,
    transactionAt: new Date(line.transactionAt),
    nodeId: line.nodeId,
    ...(line.nodeName ? { nodeName: line.nodeName } : {}),
    productId: line.productId,
    ...(line.productName ? { productName: line.productName } : {}),
    currency: line.currency,
    quantity: line.quantity,
    turnover: line.turnover,
    warnings: [
      ...new Set([
        ...line.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code),
        ...line.eligibility.notes,
      ]),
    ].sort(),
  }));
}

function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
