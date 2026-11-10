import { decimalSign, toDecimalString } from './decimal-string.js';

/**
 * Sales line normalization (Feature 15): raw GAAP `GET /sales` records (Feature 14 output) ->
 * one canonical record per sale item (a "sales line"). Pure: no I/O, no logging, no rounding,
 * no arithmetic on money.
 *
 * FIELD MAPPING, observed on the live API 2026-11-08 (read-only; paths, types and counts only;
 * 200 TENDERED sales / 354 lines, plus 6 negative sales / 8 lines; one tenant, one day):
 *  - sale: `_id`, `createdDate` (ISO 8601 UTC), `closedDate`, `nodeId`, `node` (string name),
 *    `status`, `isNegative`, `invoiceNumber`, `orderNumber`, `forex.{selected,base}Currency.currency`.
 *  - line (`items[]`): `lineId` (unique within every observed sale), `product._id` and
 *    `product.name`, `qty` (number; one fractional value seen), `priceIncl`, `priceExcl`,
 *    `discountAmount`, `promoDiscountAmount`, `discountPercentage`, `addOnsPriceIncl`,
 *    `addOnsDiscountAmount`, `activePromotion.discountAmount`, `lineTotals.{turnover,tax,nonTurnover}`.
 *    `itemPriceIncl` (used by sample.js) and `productId` do NOT exist on lines and are not read.
 *  - `lineTotals.turnover` is the reported measure: present on 100% of lines, equal to
 *    `priceIncl * qty` on 354/354, and its sum per sale equalled `totals.turnover` on 206/206
 *    sales. `productTotals.turnover` differs from it on 39 lines and its per-sale sum matched
 *    `totals.turnover` on only 146/200, so it is NOT used. No fallback to `priceIncl * qty` exists:
 *    a missing turnover is flagged, never derived.
 *
 * OWNER DECISIONS (2026-11-08): turnover is tax-inclusive, and turnover is net of discounts; no
 * discounts are applied in practice. So a non-zero discount field is unexpected and is flagged
 * (`UNEXPECTED_DISCOUNT`); turnover is never adjusted for it.
 *
 * NOT VERIFIED (flagged on the line, recorded as blockers in docs/sales-line-normalization.md):
 *  whether add-on prices are inside turnover (all observed add-ons were priced 0), and the
 *  currency of the amounts (Feature 16 decides; both raw currency fields are carried untouched).
 *
 * Version history: 2 renamed DISCOUNT_BASIS_UNVERIFIED to UNEXPECTED_DISCOUNT (owner decision).
 */

export const SALES_LINE_NORMALIZATION_VERSION = 2;

const MAX_SOURCE_KEY_LENGTH = 200; // ReportRow.sourceLineKey maxlength
const SOURCE_KEY_SEPARATOR = '/';

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning' });

/** `error` issues make a line unusable (`usable: false`); warnings only annotate it. */
export const ISSUE_CODES = Object.freeze({
  // errors
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  MISSING_SALE_ID: 'MISSING_SALE_ID',
  MISSING_LINE_ID: 'MISSING_LINE_ID',
  INVALID_SOURCE_ID: 'INVALID_SOURCE_ID',
  DUPLICATE_SOURCE_LINE: 'DUPLICATE_SOURCE_LINE',
  MISSING_NODE_ID: 'MISSING_NODE_ID',
  MISSING_PRODUCT_ID: 'MISSING_PRODUCT_ID',
  MISSING_TIMESTAMP: 'MISSING_TIMESTAMP',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  MISSING_QUANTITY: 'MISSING_QUANTITY',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  MISSING_TURNOVER: 'MISSING_TURNOVER',
  INVALID_TURNOVER: 'INVALID_TURNOVER',
  // warnings
  ZERO_QUANTITY: 'ZERO_QUANTITY',
  NEGATIVE_QUANTITY: 'NEGATIVE_QUANTITY',
  NEGATIVE_TURNOVER: 'NEGATIVE_TURNOVER',
  SIGN_MISMATCH: 'SIGN_MISMATCH',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_CLOSED_TIMESTAMP: 'INVALID_CLOSED_TIMESTAMP',
  UNEXPECTED_DISCOUNT: 'UNEXPECTED_DISCOUNT',
  ADD_ON_PRICE_BASIS_UNVERIFIED: 'ADD_ON_PRICE_BASIS_UNVERIFIED',
  CURRENCY_FIELD_MISSING: 'CURRENCY_FIELD_MISSING',
  CURRENCY_FIELDS_DIFFER: 'CURRENCY_FIELDS_DIFFER',
});

/** Sale-level problems (no line to attach them to). */
export const SALE_ISSUE_CODES = Object.freeze({
  SALE_NOT_AN_OBJECT: 'SALE_NOT_AN_OBJECT',
  SALE_ITEMS_MISSING: 'SALE_ITEMS_MISSING',
  SALE_HAS_NO_ITEMS: 'SALE_HAS_NO_ITEMS',
});

const ERROR_CODES = new Set([
  ISSUE_CODES.NOT_AN_OBJECT,
  ISSUE_CODES.MISSING_SALE_ID,
  ISSUE_CODES.MISSING_LINE_ID,
  ISSUE_CODES.INVALID_SOURCE_ID,
  ISSUE_CODES.DUPLICATE_SOURCE_LINE,
  ISSUE_CODES.MISSING_NODE_ID,
  ISSUE_CODES.MISSING_PRODUCT_ID,
  ISSUE_CODES.MISSING_TIMESTAMP,
  ISSUE_CODES.INVALID_TIMESTAMP,
  ISSUE_CODES.MISSING_QUANTITY,
  ISSUE_CODES.INVALID_QUANTITY,
  ISSUE_CODES.MISSING_TURNOVER,
  ISSUE_CODES.INVALID_TURNOVER,
]);

/**
 * Informational money fields. Carried as decimal strings (or null), never interpreted or summed.
 * `path` is only used to name the field in an `INVALID_AMOUNT` issue.
 */
const AMOUNT_FIELDS = [
  { name: 'tax', read: (item) => item.lineTotals?.tax },
  { name: 'nonTurnover', read: (item) => item.lineTotals?.nonTurnover },
  { name: 'unitPriceIncl', read: (item) => item.priceIncl },
  { name: 'unitPriceExcl', read: (item) => item.priceExcl },
  { name: 'discountAmount', read: (item) => item.discountAmount },
  { name: 'promoDiscountAmount', read: (item) => item.promoDiscountAmount },
  { name: 'activePromotionDiscountAmount', read: (item) => item.activePromotion?.discountAmount },
  { name: 'discountPercentage', read: (item) => item.discountPercentage },
  { name: 'addOnsPriceIncl', read: (item) => item.addOnsPriceIncl },
  { name: 'addOnsDiscountAmount', read: (item) => item.addOnsDiscountAmount },
];

const DISCOUNT_FIELDS = [
  'discountAmount',
  'promoDiscountAmount',
  'activePromotionDiscountAmount',
  'discountPercentage',
  'addOnsDiscountAmount',
];

/**
 * @typedef {object} SalesLineIssue
 * @property {string} code One of {@link ISSUE_CODES}.
 * @property {'error' | 'warning'} severity
 * @property {string} field Internal field name the issue is about. Source values are never echoed.
 *
 * @typedef {object} NormalizedSalesLine
 * @property {number} normalizationVersion {@link SALES_LINE_NORMALIZATION_VERSION}.
 * @property {string | null} sourceLineKey `<saleId>/<lineId>`; the de-duplication key. Null when an id is missing.
 * @property {{ saleId: string | null, lineId: string | null, lineIndex: number, invoiceNumber: string | null, orderNumber: string | null }} source
 *   `lineIndex` is the position in the sale's `items` array: traceability only, never part of the key.
 * @property {string | null} transactionAt ISO 8601 UTC instant from `createdDate`; null if absent/invalid.
 * @property {string | null} closedAt ISO 8601 UTC instant from `closedDate`; optional.
 * @property {string | null} nodeId
 * @property {string | null} nodeName
 * @property {string | null} productId `items[].product._id`.
 * @property {string | null} productName
 * @property {string | null} quantity Signed decimal string; null if missing/invalid (never defaulted to 1 or 0).
 * @property {string | null} turnover Signed decimal string from `lineTotals.turnover`; null if missing/invalid.
 * @property {Record<string, string | null>} amounts Other source amounts, uninterpreted (see AMOUNT_FIELDS).
 * @property {{ status: string | null, isNegative: boolean | null }} sale Raw sale flags for Feature 17.
 * @property {{ selectedCurrency: string | null, baseCurrency: string | null }} currencySource
 *   Raw currency codes exactly as GAAP sent them. NOT a classification: Feature 16 resolves currency.
 * @property {SalesLineIssue[]} issues
 * @property {boolean} usable False if any `error` issue exists. Unusable lines must not be counted.
 *
 * @typedef {object} SaleIssue
 * @property {number} saleIndex Position of the sale in the input array.
 * @property {string | null} saleId
 * @property {string} code One of {@link SALE_ISSUE_CODES}.
 * @property {'error' | 'warning'} severity
 *
 * @typedef {object} SalesLineNormalization
 * @property {number} normalizationVersion
 * @property {NormalizedSalesLine[]} lines One per sale item, in input order. Nothing is dropped.
 * @property {SaleIssue[]} saleIssues
 * @property {{ saleCount: number, lineCount: number, usableCount: number, unusableCount: number,
 *   issueCounts: Record<string, number> }} summary Counts of lines per issue code (and sale issues by code).
 */

/**
 * Normalizes raw sales into per-product sales lines. Every item yields exactly one line (bad ones
 * are flagged `usable: false`, never silently dropped), so callers can show what was excluded.
 * A repeated `sourceLineKey` is flagged so the same line cannot be counted twice.
 * @param {unknown[]} sales Raw records from `fetchSales().sales`.
 * @returns {SalesLineNormalization}
 */
export function normalizeSalesLines(sales) {
  if (!Array.isArray(sales)) throw new TypeError('sales must be an array');
  const lines = [];
  const saleIssues = [];
  const seenKeys = new Set();

  sales.forEach((sale, saleIndex) => {
    if (sale === null || typeof sale !== 'object' || Array.isArray(sale)) {
      saleIssues.push(saleIssue(saleIndex, null, SALE_ISSUE_CODES.SALE_NOT_AN_OBJECT, 'error'));
      return;
    }
    const header = readSaleHeader(sale);
    if (!Array.isArray(sale.items)) {
      saleIssues.push(
        saleIssue(saleIndex, header.saleId, SALE_ISSUE_CODES.SALE_ITEMS_MISSING, 'error'),
      );
      return;
    }
    if (sale.items.length === 0) {
      saleIssues.push(
        saleIssue(saleIndex, header.saleId, SALE_ISSUE_CODES.SALE_HAS_NO_ITEMS, 'warning'),
      );
      return;
    }
    sale.items.forEach((item, lineIndex) => {
      lines.push(normalizeLine(item, lineIndex, header, seenKeys));
    });
  });

  return {
    normalizationVersion: SALES_LINE_NORMALIZATION_VERSION,
    lines,
    saleIssues,
    summary: summarize(sales.length, lines, saleIssues),
  };
}

function saleIssue(saleIndex, saleId, code, severity) {
  return { saleIndex, saleId, code, severity };
}

/** Sale-level fields shared by every line of a sale. Only what traceability and later rules need. */
function readSaleHeader(sale) {
  const transactionAt = readInstant(sale.createdDate);
  const closedAt = readInstant(sale.closedDate);
  return {
    saleId: nonBlankString(sale._id),
    invoiceNumber: nonBlankString(sale.invoiceNumber),
    orderNumber: nonBlankString(sale.orderNumber),
    nodeId: nonBlankString(sale.nodeId),
    nodeName: nonBlankString(sale.node),
    transactionAt,
    closedAt,
    status: typeof sale.status === 'string' ? sale.status : null,
    isNegative: typeof sale.isNegative === 'boolean' ? sale.isNegative : null,
    currencySource: {
      selectedCurrency: nonBlankString(sale.forex?.selectedCurrency?.currency),
      baseCurrency: nonBlankString(sale.forex?.baseCurrency?.currency),
      // Rate of the SELECTED currency, taken from the matching `forex.forexRates[]` entry
      // (owner decision 2026-11-10): base turnover x its `fromBaseToForeign` (26.688 for ZWG; owner-verified 2026-11-10).
      selectedRate: readSelectedRate(sale.forex),
    },
  };
}

function normalizeLine(item, lineIndex, header, seenKeys) {
  const issues = [];
  const flag = (code, field) => {
    const severity = ERROR_CODES.has(code) ? SEVERITY.ERROR : SEVERITY.WARNING;
    issues.push({ code, severity, field });
  };

  const base = {
    normalizationVersion: SALES_LINE_NORMALIZATION_VERSION,
    sale: { status: header.status, isNegative: header.isNegative },
    currencySource: { ...header.currencySource },
  };

  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    flag(ISSUE_CODES.NOT_AN_OBJECT, 'item');
    return finish({
      ...base,
      sourceLineKey: null,
      source: sourceRef(header, null, lineIndex),
      transactionAt: header.transactionAt.iso,
      closedAt: header.closedAt.iso,
      nodeId: header.nodeId,
      nodeName: header.nodeName,
      productId: null,
      productName: null,
      quantity: null,
      turnover: null,
      amounts: emptyAmounts(),
      issues,
    });
  }

  const lineId = nonBlankString(item.lineId);
  const productId = nonBlankString(item.product?._id);
  const sourceLineKey = buildSourceKey(header.saleId, lineId, flag, seenKeys);

  if (header.nodeId === null) flag(ISSUE_CODES.MISSING_NODE_ID, 'nodeId');
  if (productId === null) flag(ISSUE_CODES.MISSING_PRODUCT_ID, 'productId');
  flagInstant(header.transactionAt, flag, 'transactionAt', {
    missing: ISSUE_CODES.MISSING_TIMESTAMP,
    invalid: ISSUE_CODES.INVALID_TIMESTAMP,
  });
  if (header.closedAt.problem === 'invalid') {
    flag(ISSUE_CODES.INVALID_CLOSED_TIMESTAMP, 'closedAt');
  }

  const quantity = readRequiredDecimal(item.qty, flag, 'quantity', {
    missing: ISSUE_CODES.MISSING_QUANTITY,
    invalid: ISSUE_CODES.INVALID_QUANTITY,
  });
  const turnover = readRequiredDecimal(item.lineTotals?.turnover, flag, 'turnover', {
    missing: ISSUE_CODES.MISSING_TURNOVER,
    invalid: ISSUE_CODES.INVALID_TURNOVER,
  });
  const amounts = readAmounts(item, flag);

  flagSigns(quantity, turnover, flag);
  flagUnverifiedBasis(amounts, flag);
  flagCurrencyFields(header.currencySource, flag);

  return finish({
    ...base,
    sourceLineKey,
    source: sourceRef(header, lineId, lineIndex),
    transactionAt: header.transactionAt.iso,
    closedAt: header.closedAt.iso,
    nodeId: header.nodeId,
    nodeName: header.nodeName,
    productId,
    productName: nonBlankString(item.product?.name),
    quantity,
    turnover,
    amounts,
    issues,
  });
}

function finish(line) {
  return { ...line, usable: !line.issues.some((issue) => issue.severity === SEVERITY.ERROR) };
}

function sourceRef(header, lineId, lineIndex) {
  return {
    saleId: header.saleId,
    lineId,
    lineIndex,
    invoiceNumber: header.invoiceNumber,
    orderNumber: header.orderNumber,
  };
}

/**
 * `<saleId>/<lineId>`, built only from real source ids. Position is not an id, so a missing id
 * leaves the key null rather than inventing one. Ids containing the separator, or keys longer
 * than the stored column, could collide or be truncated, so they are refused.
 */
function buildSourceKey(saleId, lineId, flag, seenKeys) {
  if (saleId === null) flag(ISSUE_CODES.MISSING_SALE_ID, 'saleId');
  if (lineId === null) flag(ISSUE_CODES.MISSING_LINE_ID, 'lineId');
  if (saleId === null || lineId === null) return null;

  const key = `${saleId}${SOURCE_KEY_SEPARATOR}${lineId}`;
  if (
    saleId.includes(SOURCE_KEY_SEPARATOR) ||
    lineId.includes(SOURCE_KEY_SEPARATOR) ||
    key.length > MAX_SOURCE_KEY_LENGTH
  ) {
    flag(ISSUE_CODES.INVALID_SOURCE_ID, 'sourceLineKey');
    return null;
  }
  if (seenKeys.has(key)) {
    flag(ISSUE_CODES.DUPLICATE_SOURCE_LINE, 'sourceLineKey');
  } else {
    seenKeys.add(key);
  }
  return key;
}

function readRequiredDecimal(value, flag, field, codes) {
  if (value === undefined || value === null) {
    flag(codes.missing, field);
    return null;
  }
  const text = toDecimalString(value);
  if (text === null) flag(codes.invalid, field);
  return text;
}

function readAmounts(item, flag) {
  const amounts = {};
  for (const { name, read } of AMOUNT_FIELDS) {
    const raw = read(item);
    if (raw === undefined || raw === null) {
      amounts[name] = null; // absent stays absent: never treated as 0
      continue;
    }
    const text = toDecimalString(raw);
    if (text === null) flag(ISSUE_CODES.INVALID_AMOUNT, name);
    amounts[name] = text;
  }
  return amounts;
}

function emptyAmounts() {
  return Object.fromEntries(AMOUNT_FIELDS.map(({ name }) => [name, null]));
}

/** Signs are compared on decimal text, so no floating point is involved. */
function flagSigns(quantity, turnover, flag) {
  const quantitySign = quantity === null ? null : decimalSign(quantity);
  const turnoverSign = turnover === null ? null : decimalSign(turnover);
  if (quantitySign === 0) flag(ISSUE_CODES.ZERO_QUANTITY, 'quantity');
  if (quantitySign === -1) flag(ISSUE_CODES.NEGATIVE_QUANTITY, 'quantity');
  if (turnoverSign === -1) flag(ISSUE_CODES.NEGATIVE_TURNOVER, 'turnover');
  if (quantitySign !== null && turnoverSign !== null) {
    if (quantitySign !== 0 && turnoverSign !== 0 && quantitySign !== turnoverSign) {
      flag(ISSUE_CODES.SIGN_MISMATCH, 'turnover');
    }
  }
}

/**
 * Turnover is net of discounts and none are expected (owner), so any non-zero discount is an
 * anomaly to surface. Add-on pricing inside turnover is still unverified.
 */
function flagUnverifiedBasis(amounts, flag) {
  if (DISCOUNT_FIELDS.some((name) => isNonZero(amounts[name]))) {
    flag(ISSUE_CODES.UNEXPECTED_DISCOUNT, 'turnover');
  }
  if (isNonZero(amounts.addOnsPriceIncl)) {
    flag(ISSUE_CODES.ADD_ON_PRICE_BASIS_UNVERIFIED, 'turnover');
  }
}

function isNonZero(text) {
  return text !== null && decimalSign(text) !== 0;
}

/** Reports what GAAP sent; the meaning of each currency field is Feature 16's job. */
function flagCurrencyFields({ selectedCurrency, baseCurrency }, flag) {
  if (selectedCurrency === null) flag(ISSUE_CODES.CURRENCY_FIELD_MISSING, 'selectedCurrency');
  if (baseCurrency === null) flag(ISSUE_CODES.CURRENCY_FIELD_MISSING, 'baseCurrency');
  if (
    selectedCurrency !== null &&
    baseCurrency !== null &&
    selectedCurrency.toUpperCase() !== baseCurrency.toUpperCase()
  ) {
    flag(ISSUE_CODES.CURRENCY_FIELDS_DIFFER, 'currencySource');
  }
}

function flagInstant(instant, flag, field, codes) {
  if (instant.problem === 'missing') flag(codes.missing, field);
  if (instant.problem === 'invalid') flag(codes.invalid, field);
}

/** `fromBaseToForeign` of the `forexRates` entry whose currency is the selected one, else null. */
function readSelectedRate(forex) {
  const selected = nonBlankString(forex?.selectedCurrency?.currency)?.trim().toUpperCase();
  if (!selected || !Array.isArray(forex?.forexRates)) return null;
  const entry = forex.forexRates.find(
    (rate) => typeof rate?.currency === 'string' && rate.currency.trim().toUpperCase() === selected,
  );
  return readRate(entry?.fromBaseToForeign);
}

/** Positive decimal text or null (a missing, zero, negative or unreadable rate is never guessed). */
function readRate(value) {
  if (value === undefined || value === null) return null;
  const text = toDecimalString(value);
  return text !== null && decimalSign(text) === 1 ? text : null;
}

function nonBlankString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Accepts only ISO 8601 instants that carry an explicit offset (no timezone is assumed) and real
 * calendar values. `Date` alone would roll over `02-30` and `24:00`, so components are checked.
 * @returns {{ iso: string | null, problem: 'missing' | 'invalid' | null }}
 */
function readInstant(value) {
  if (value === undefined || value === null) return { iso: null, problem: 'missing' };
  const match = typeof value === 'string' ? INSTANT.exec(value) : null;
  if (match === null) return { iso: null, problem: 'invalid' };

  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offset = match[7];
  const offsetOk =
    offset === 'Z' || (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59);
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetOk;
  const time = valid ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return { iso: null, problem: 'invalid' };
  return { iso: new Date(time).toISOString(), problem: null };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function summarize(saleCount, lines, saleIssues) {
  const issueCounts = {};
  const bump = (code) => {
    issueCounts[code] = (issueCounts[code] ?? 0) + 1;
  };
  let usableCount = 0;
  for (const line of lines) {
    if (line.usable) usableCount += 1;
    for (const code of new Set(line.issues.map((issue) => issue.code))) bump(code);
  }
  for (const issue of saleIssues) bump(issue.code);
  return {
    saleCount,
    lineCount: lines.length,
    usableCount,
    unusableCount: lines.length - usableCount,
    issueCounts,
  };
}
