import { GAAP_ERROR_CODES, GaapError } from './gaap.errors.js';

/**
 * GAAP `GET /sales` paging adapter (Feature 14).
 *
 * OBSERVED on the live API (2026-11-08, read-only, structure and counts only):
 *  - `match` is a JSON array of `[path, operator, value]` triples; `limit`, `skip` and `sort`
 *    (`[("createdDate","asc")]`, as in sample.js) are accepted; response is `{ totalRecords, data }`.
 *  - `totalRecords` is NOT the match count (it equals the page size), so it is never used for
 *    completeness. A page is the last one only when it is shorter than `limit`.
 *  - A sale's `_id` is a unique string and is the stable source identifier used for deduplication.
 *  - A single-day `createdDate` gte/lte filter on "YYYYMMDD" returned sales starting at 22:00:00Z the
 *    previous day, i.e. GAAP read the date as a Harare (UTC+2) day. See docs/gaap-sales-extraction.md.
 *
 * Not verified here (see the doc): behaviour when GAAP reorders between pages, ties on `createdDate`
 * under skip paging, and the meaning of currency fields. Raw sale records are returned untouched for
 * the later normalization step; they may contain customer data and must never be logged.
 */

export const SALES_PATH = '/sales';
export const SALES_PAGE_SIZE = 500;
export const SALES_MAX_PAGES = 200;
export const SALES_PAGE_RETRIES = 1;
/** Cap on product x node GAAP queries for one extraction. */
export const SALES_MAX_QUERIES = 200;
export const SALES_SORT = '[("createdDate","asc")]';
export const ELIGIBLE_STATUS = 'TENDERED';

/** Why a record was kept out of `sales`. */
export const EXCLUSION_REASONS = Object.freeze({
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  MISSING_ID: 'MISSING_ID',
  NOT_TENDERED: 'NOT_TENDERED',
  NEGATIVE: 'NEGATIVE',
  OUTSIDE_NODE_FILTER: 'OUTSIDE_NODE_FILTER',
  OUTSIDE_PRODUCT_FILTER: 'OUTSIDE_PRODUCT_FILTER',
});

/** Reasons that mean a record GAAP returned could not be used to count it (not a filter echo). */
const UNUSABLE_REASONS = new Set([EXCLUSION_REASONS.NOT_AN_OBJECT, EXCLUSION_REASONS.MISSING_ID]);

/**
 * @typedef {object} SalesQuery
 * @property {string} startDate YYYYMMDD, inclusive.
 * @property {string} endDate YYYYMMDD, inclusive.
 * @property {string[]} [productIds] Empty/omitted = no product filter.
 * @property {string[]} [nodeIds] Empty/omitted = no node filter (all nodes).
 *
 * @typedef {object} SalesPageStat
 * @property {number} query Index of the GAAP query (one per filter value).
 * @property {number} skip
 * @property {number} received Records on the page.
 * @property {number} attempts Page attempts, including retries.
 *
 * @typedef {object} SalesExtraction
 * @property {object[]} sales De-duplicated raw sale records, sorted by createdDate then _id.
 * @property {boolean} complete True only if every query ended on a short/empty page, no page failed
 *   and no record was unusable. A partial result must never be reported as a complete report.
 * @property {boolean} partial Inverse of `complete`.
 * @property {{ code: string, message: string, query: number, skip: number }[]} failures
 * @property {string[]} incompleteReasons Machine-readable causes when `complete` is false.
 * @property {number} pageCount Pages successfully received.
 * @property {number} queryCount GAAP queries planned.
 * @property {SalesPageStat[]} pages
 * @property {number} receivedCount Records received across pages.
 * @property {number} duplicateCount Records dropped because their `_id` was already kept.
 * @property {Record<string, number>} excluded Counts by {@link EXCLUSION_REASONS}.
 * @property {string} fetchedAt ISO 8601 instant when extraction finished.
 * @property {string} sourceStartedAt ISO 8601 instant when extraction began.
 * @property {{ startDate: string, endDate: string }} range
 */

const COMPACT_DATE = /^\d{8}$/;

/** Plan: one GAAP query per product x node combination GAAP is asked about (see buildQueries). */
export function buildMatch({ startDate, endDate, productId, nodeId }) {
  const match = [
    ['createdDate', 'gte', startDate],
    ['createdDate', 'lte', endDate],
    ['status', 'eq', ELIGIBLE_STATUS],
    ['isNegative', 'eq', false],
  ];
  if (productId !== undefined) match.push(['items.product._id', 'eq', productId]);
  if (nodeId !== undefined) match.push(['nodeId', 'eq', nodeId]);
  // GAAP's documented format: a list of (path, operator, value) tuples, e.g.
  // [("createdDate", "gte", "20261105"), ("isNegative", "eq", false)]. Each part is JSON-encoded, so
  // quotes in a value are escaped and `false` stays a boolean.
  const tuples = match.map(
    (condition) => `(${condition.map((part) => JSON.stringify(part)).join(', ')})`,
  );
  return `[${tuples.join(', ')}]`;
}

/**
 * Only `eq` has been demonstrated for product and node filters, so several values become several
 * queries whose results are merged and de-duplicated by `_id` (a sale can contain many products).
 * Node filtering is done server-side (`nodeId eq` verified); when there are more nodes than
 * `maxNodeQueries` the node filter is applied locally instead of exploding the query count.
 */
export function buildQueries(query, { maxQueries }) {
  const products = unique(query.productIds ?? []);
  const nodes = unique(query.nodeIds ?? []);
  const productValues = products.length > 0 ? products : [undefined];
  const nodeValues = nodes.length > 0 ? nodes : [undefined];
  const queries = [];
  for (const productId of productValues) {
    for (const nodeId of nodeValues) {
      queries.push({ startDate: query.startDate, endDate: query.endDate, productId, nodeId });
    }
  }
  if (queries.length > maxQueries) {
    throw new GaapError({
      code: GAAP_ERROR_CODES.INVALID_REQUEST,
      message: `The selection needs ${queries.length} GAAP queries; the maximum is ${maxQueries}.`,
      method: 'GET',
      path: SALES_PATH,
    });
  }
  return queries;
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * @param {object} options
 * @param {{ get: Function }} options.client GAAP client from `createGaapClient`.
 * @param {number} [options.pageSize]
 * @param {number} [options.maxPages] Cap on pages per query.
 * @param {number} [options.maxQueries] Cap on product x node queries.
 * @param {number} [options.pageRetries] Extra attempts per page on a transient failure.
 * @param {() => Date} [options.now]
 */
export function createSalesAdapter({
  client,
  pageSize = SALES_PAGE_SIZE,
  maxPages = SALES_MAX_PAGES,
  maxQueries = SALES_MAX_QUERIES,
  pageRetries = SALES_PAGE_RETRIES,
  now = () => new Date(),
}) {
  async function fetchPage(match, skip, { signal, requestId }) {
    let lastError;
    for (let attempt = 1; attempt <= pageRetries + 1; attempt += 1) {
      try {
        const response = await client.get(
          SALES_PATH,
          { match, limit: pageSize, skip, sort: SALES_SORT },
          { signal, requestId },
        );
        return { records: parsePage(response.data), attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt > pageRetries) break;
      }
    }
    throw lastError;
  }

  /**
   * Fetches every page of every query (bounded), de-duplicates by `_id` and reports completeness.
   * Never throws for page failures: they are returned as `failures` with `complete: false`.
   * Throws only for invalid input, or when the caller aborts.
   * @param {SalesQuery & { signal?: AbortSignal, requestId?: string }} input
   * @returns {Promise<SalesExtraction>}
   */
  async function fetchSales(input) {
    assertQuery(input);
    const { signal, requestId } = input;
    const queries = buildQueries(input, { maxQueries });
    const nodeFilter = new Set(input.nodeIds ?? []);
    const productFilter = new Set(input.productIds ?? []);
    const sourceStartedAt = now().toISOString();

    const kept = new Map();
    const pages = [];
    const failures = [];
    const incompleteReasons = new Set();
    const excluded = Object.fromEntries(Object.values(EXCLUSION_REASONS).map((r) => [r, 0]));
    let receivedCount = 0;
    let duplicateCount = 0;

    for (let q = 0; q < queries.length; q += 1) {
      const match = buildMatch(queries[q]);
      let endedNaturally = false;

      for (let page = 0; page < maxPages; page += 1) {
        const skip = page * pageSize;
        let result;
        try {
          result = await fetchPage(match, skip, { signal, requestId });
        } catch (error) {
          if (signal?.aborted || error?.code === GAAP_ERROR_CODES.ABORTED) throw error;
          failures.push({
            code: error?.code ?? 'UNKNOWN',
            message: safeMessage(error),
            query: q,
            skip,
          });
          incompleteReasons.add('PAGE_FAILED');
          break; // a gap in skip paging cannot be skipped over safely
        }

        pages.push({ query: q, skip, received: result.records.length, attempts: result.attempts });
        receivedCount += result.records.length;
        for (const record of result.records) {
          const outcome = admit(record, { nodeFilter, productFilter });
          if (outcome.reason !== null) {
            excluded[outcome.reason] += 1;
          } else if (kept.has(outcome.id)) {
            duplicateCount += 1;
          } else {
            kept.set(outcome.id, record);
          }
        }

        if (result.records.length < pageSize) {
          endedNaturally = true;
          break;
        }
      }

      if (!endedNaturally && !failures.some((f) => f.query === q)) {
        incompleteReasons.add('PAGE_CAP_REACHED');
      }
    }

    if ([...UNUSABLE_REASONS].some((reason) => excluded[reason] > 0)) {
      incompleteReasons.add('UNUSABLE_RECORDS');
    }

    const complete = incompleteReasons.size === 0;
    return {
      sales: [...kept.values()].sort(compareSales),
      complete,
      partial: !complete,
      failures,
      incompleteReasons: [...incompleteReasons].sort(),
      pageCount: pages.length,
      queryCount: queries.length,
      pages,
      receivedCount,
      duplicateCount,
      excluded,
      fetchedAt: now().toISOString(),
      sourceStartedAt,
      range: { startDate: input.startDate, endDate: input.endDate },
    };
  }

  return Object.freeze({ fetchSales });
}

function assertQuery(input) {
  const bad = (message) =>
    new GaapError({
      code: GAAP_ERROR_CODES.INVALID_REQUEST,
      message,
      method: 'GET',
      path: SALES_PATH,
    });
  if (!COMPACT_DATE.test(input?.startDate ?? '') || !COMPACT_DATE.test(input?.endDate ?? '')) {
    throw bad('startDate and endDate must be YYYYMMDD.');
  }
  if (input.startDate > input.endDate) throw bad('startDate must not be after endDate.');
  for (const name of ['productIds', 'nodeIds']) {
    const list = input[name];
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || v === ''))
    ) {
      throw bad(`${name} must be an array of non-empty strings.`);
    }
  }
}

function parsePage(body) {
  const isEnvelope = body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!isEnvelope || !Array.isArray(body.data)) {
    throw new GaapError({
      code: GAAP_ERROR_CODES.INVALID_RESPONSE,
      message: 'GAAP sales response did not contain a data array',
      method: 'GET',
      path: SALES_PATH,
    });
  }
  return body.data;
}

function isRetryable(error) {
  return error?.retryable === true || error?.code === GAAP_ERROR_CODES.INVALID_RESPONSE;
}

/** Never echo GAAP content: only the stable code's own safe message is kept. */
function safeMessage(error) {
  return error instanceof GaapError
    ? error.message
    : 'Unexpected error while fetching a sales page';
}

/** Re-checks the filters GAAP was asked to apply; a mismatch is counted, never silently summed. */
function admit(record, { nodeFilter, productFilter }) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { reason: EXCLUSION_REASONS.NOT_AN_OBJECT, id: null };
  }
  const id = typeof record._id === 'string' && record._id.trim() !== '' ? record._id : null;
  if (id === null) return { reason: EXCLUSION_REASONS.MISSING_ID, id: null };
  if (record.status !== ELIGIBLE_STATUS) return { reason: EXCLUSION_REASONS.NOT_TENDERED, id };
  if (record.isNegative !== false) return { reason: EXCLUSION_REASONS.NEGATIVE, id };
  if (nodeFilter.size > 0 && !nodeFilter.has(record.nodeId)) {
    return { reason: EXCLUSION_REASONS.OUTSIDE_NODE_FILTER, id };
  }
  if (productFilter.size > 0 && !hasSelectedProduct(record, productFilter)) {
    return { reason: EXCLUSION_REASONS.OUTSIDE_PRODUCT_FILTER, id };
  }
  return { reason: null, id };
}

function hasSelectedProduct(record, productFilter) {
  return (
    Array.isArray(record.items) &&
    record.items.some((item) => productFilter.has(item?.product?._id))
  );
}

function compareSales(a, b) {
  const da = String(a.createdDate ?? '');
  const db = String(b.createdDate ?? '');
  if (da !== db) return da < db ? -1 : 1;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}
