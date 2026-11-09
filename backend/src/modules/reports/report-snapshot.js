import { createHash } from 'node:crypto';
import { createDecimalSum, isDecimalString } from '../gaap/decimal-sum.js';

/**
 * Pure rules for a report snapshot (Feature 21): what a stored row looks like, how a snapshot is
 * fingerprinted, and how rows reconcile with the saved totals. No I/O: the repository feeds rows
 * through here both before writing (inputs) and after writing (rows read back from MongoDB), so one
 * set of rules decides whether a snapshot is whole.
 *
 * Money is never handled as a float: quantities and turnover are decimal STRINGS summed exactly,
 * and currencies are summed independently of one another.
 */

export const SNAPSHOT_CHECKSUM_ALGORITHM = 'sha256';

/** MongoDB Decimal128 keeps 34 significant digits; more would be rounded silently, so it is refused. */
export const MAX_DECIMAL_DIGITS = 34;

/** Problem codes. Only codes and counts are ever reported: never source values. */
export const SNAPSHOT_PROBLEMS = Object.freeze({
  ROW_INVALID: 'ROW_INVALID',
  ROW_INDEX_SEQUENCE: 'ROW_INDEX_SEQUENCE',
  ROW_DUPLICATE_KEY: 'ROW_DUPLICATE_KEY',
  ROW_CURRENCY_INVALID: 'ROW_CURRENCY_INVALID',
  ROW_DECIMAL_INVALID: 'ROW_DECIMAL_INVALID',
  ROW_TIMESTAMP_INVALID: 'ROW_TIMESTAMP_INVALID',
  ROW_TOO_LARGE: 'ROW_TOO_LARGE',
  REPORT_DOCUMENT_TOO_LARGE: 'REPORT_DOCUMENT_TOO_LARGE',
  TOTALS_INVALID: 'TOTALS_INVALID',
  TOTALS_CURRENCY_MISSING: 'TOTALS_CURRENCY_MISSING',
  TOTALS_LINECOUNT_MISMATCH: 'TOTALS_LINECOUNT_MISMATCH',
  TOTALS_QUANTITY_MISMATCH: 'TOTALS_QUANTITY_MISMATCH',
  TOTALS_TURNOVER_MISMATCH: 'TOTALS_TURNOVER_MISMATCH',
  ROW_COUNT_MISMATCH: 'ROW_COUNT_MISMATCH',
  READBACK_MISMATCH: 'READBACK_MISMATCH',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
});

/** The snapshot is not whole or not consistent, so it must not be (or stay) completed. */
export class SnapshotIntegrityError extends Error {
  /** @param {string[]} problems codes from {@link SNAPSHOT_PROBLEMS} */
  constructor(problems) {
    super(`Report snapshot failed integrity checks: ${problems.join(', ')}`);
    this.name = 'SnapshotIntegrityError';
    this.code = 'SNAPSHOT_INTEGRITY_FAILED';
    this.problems = problems;
  }
}

const NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i;
const CURRENCY_PATTERN = /^([A-Z]{3}|UNKNOWN)$/;
const MAX_EXPANDED_LENGTH = 100;

/**
 * Plain decimal text for a number, expanding the exponent form MongoDB Decimal128 prints for some
 * values ("1E-7" -> "0.0000001"). Digits are never changed. Null when not a finite decimal.
 * @param {unknown} value a string or a Decimal128 (anything whose `String()` is decimal text)
 */
export function toPlainDecimal(value) {
  // A JS number is a float: money and quantities must arrive as decimal text (or Decimal128).
  if (typeof value === 'number') return null;
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  const match = NUMBER_PATTERN.exec(text);
  if (match === null) return null;
  const [, sign, whole, fraction = '', exponent] = match;
  if (exponent === undefined) return text;

  const digits = (whole + fraction).replace(/^0+(?=\d)/, '');
  const point = whole.replace(/^0+(?=\d)/, '').length + Number(exponent);
  let plain;
  if (Math.abs(point) > MAX_EXPANDED_LENGTH) return null;
  if (point <= 0) plain = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) plain = digits + '0'.repeat(point - digits.length);
  else plain = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${sign}${plain}`;
}

/** True when the text can be stored in Decimal128 without losing a digit. */
function isStorableDecimal(text) {
  if (!isDecimalString(text)) return false;
  const significant = text
    .replace('-', '')
    .replace('.', '')
    .replace(/^0+(?=\d)/, '');
  return significant.length <= MAX_DECIMAL_DIGITS;
}

function canonicalSum(value) {
  const plain = toPlainDecimal(value);
  return plain !== null && isDecimalString(plain) ? createDecimalSum().add(plain).toString() : null;
}

const OPTIONAL_TEXT_FIELDS = Object.freeze(['nodeName', 'productName', 'departmentId', 'brandId']);
const REQUIRED_TEXT_FIELDS = Object.freeze(['sourceLineKey', 'nodeId', 'productId']);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Brings one row (an input row, or a row read back from MongoDB) into its canonical stored shape:
 * strings trimmed exactly as the model trims them, blank optional text omitted, dates as ISO text,
 * decimals as plain text. Returns the row and the problems found; it never throws and never invents a
 * value. Unusable fields are left as received so the problem can be reported.
 * @returns {{ row: object, problems: string[] }}
 */
export function normalizeStoredRow(raw) {
  const problems = [];
  if (raw === null || typeof raw !== 'object') {
    return { row: {}, problems: [SNAPSHOT_PROBLEMS.ROW_INVALID] };
  }

  const row = { lineIndex: raw.lineIndex };
  for (const field of REQUIRED_TEXT_FIELDS) {
    row[field] = trimmed(raw[field]);
    if (typeof row[field] !== 'string' || row[field] === '')
      problems.push(SNAPSHOT_PROBLEMS.ROW_INVALID);
  }

  const at = raw.transactionAt;
  if (at instanceof Date && !Number.isNaN(at.getTime())) row.transactionAt = at.toISOString();
  else {
    row.transactionAt = null;
    problems.push(SNAPSHOT_PROBLEMS.ROW_TIMESTAMP_INVALID);
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = trimmed(raw[field]);
    if (typeof value === 'string' && value !== '') row[field] = value;
    else if (value !== undefined && value !== null && value !== '') {
      problems.push(SNAPSHOT_PROBLEMS.ROW_INVALID);
    }
  }

  row.currency = raw.currency;
  if (typeof raw.currency !== 'string' || !CURRENCY_PATTERN.test(raw.currency)) {
    problems.push(SNAPSHOT_PROBLEMS.ROW_CURRENCY_INVALID);
  }

  for (const field of ['quantity', 'turnover']) {
    const plain = toPlainDecimal(raw[field]);
    row[field] = plain ?? raw[field];
    if (plain === null || !isStorableDecimal(plain))
      problems.push(SNAPSHOT_PROBLEMS.ROW_DECIMAL_INVALID);
  }

  const warnings = raw.warnings === undefined ? [] : raw.warnings;
  if (Array.isArray(warnings) && warnings.every((w) => typeof w === 'string')) {
    row.warnings = [...warnings];
  } else {
    row.warnings = [];
    problems.push(SNAPSHOT_PROBLEMS.ROW_INVALID);
  }
  if (!Number.isInteger(raw.lineIndex) || raw.lineIndex < 0) {
    problems.push(SNAPSHOT_PROBLEMS.ROW_INVALID);
  }
  return { row, problems };
}

/** The fixed-order text that is hashed for a normalized row. */
function fingerprintOf(row) {
  return JSON.stringify([
    row.lineIndex,
    row.sourceLineKey,
    row.transactionAt,
    row.nodeId,
    row.nodeName ?? null,
    row.productId,
    row.productName ?? null,
    row.departmentId ?? null,
    row.brandId ?? null,
    row.currency,
    row.quantity,
    row.turnover,
    row.warnings,
  ]);
}

/**
 * Accumulates rows (in `lineIndex` order) into a count, a checksum over every row's content, and
 * exact per-currency sums. Feed it the rows that will be written, then the rows read back: equal
 * results mean the snapshot reloads identically.
 * @param {{ checkDuplicateKeys?: boolean }} [options]
 */
export function createSnapshotVerifier({ checkDuplicateKeys = false } = {}) {
  const hash = createHash(SNAPSHOT_CHECKSUM_ALGORITHM);
  const byCurrency = new Map();
  const keys = checkDuplicateKeys ? new Set() : null;
  const problems = new Set();
  let rowCount = 0;

  return {
    /** @param {object} raw a row, in order @returns {object} the canonical row */
    add(raw) {
      const { row, problems: found } = normalizeStoredRow(raw);
      for (const problem of found) problems.add(problem);
      if (row.lineIndex !== rowCount) problems.add(SNAPSHOT_PROBLEMS.ROW_INDEX_SEQUENCE);
      if (keys !== null) {
        if (keys.has(row.sourceLineKey)) problems.add(SNAPSHOT_PROBLEMS.ROW_DUPLICATE_KEY);
        keys.add(row.sourceLineKey);
      }

      hash.update(`${fingerprintOf(row)}\n`);
      rowCount += 1;

      if (typeof row.currency === 'string') {
        const entry = byCurrency.get(row.currency) ?? {
          lineCount: 0,
          quantity: createDecimalSum(),
          turnover: createDecimalSum(),
        };
        entry.lineCount += 1;
        // An unreadable amount is already a problem; it is not summed (and the result is not ok).
        if (isDecimalString(row.quantity)) entry.quantity.add(row.quantity);
        if (isDecimalString(row.turnover)) entry.turnover.add(row.turnover);
        byCurrency.set(row.currency, entry);
      }
      return row;
    },
    /** Final result; call once. */
    result() {
      const currencies = [...byCurrency.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([currency, entry]) => ({
          currency,
          lineCount: entry.lineCount,
          quantity: entry.quantity.toString(),
          turnover: entry.turnover.toString(),
        }));
      return {
        rowCount,
        checksum: hash.digest('hex'),
        currencies,
        problems: [...problems].sort(),
      };
    },
  };
}

/**
 * Compares rows with the saved totals: the same currencies, and per currency the same line count,
 * quantity and turnover (exact decimal comparison, "12.50" equals "12.5"). Returns problem codes.
 * @param {{ rowCount: number, currencies: object[] }} summary a verifier result
 * @param {{ totals: object[], rowCount: number }} saved
 */
export function reconcileWithTotals(summary, { totals, rowCount }) {
  const problems = [];
  if (summary.rowCount !== rowCount) problems.push(SNAPSHOT_PROBLEMS.ROW_COUNT_MISMATCH);
  if (!Array.isArray(totals)) return [...problems, SNAPSHOT_PROBLEMS.TOTALS_INVALID];

  const savedByCurrency = new Map();
  for (const total of totals) {
    if (total === null || typeof total !== 'object' || savedByCurrency.has(total.currency)) {
      problems.push(SNAPSHOT_PROBLEMS.TOTALS_INVALID);
      continue;
    }
    savedByCurrency.set(total.currency, total);
  }

  const rowsByCurrency = new Map(summary.currencies.map((entry) => [entry.currency, entry]));
  for (const currency of rowsByCurrency.keys()) {
    if (!savedByCurrency.has(currency)) problems.push(SNAPSHOT_PROBLEMS.TOTALS_CURRENCY_MISSING);
  }
  for (const [currency, total] of savedByCurrency) {
    const actual = rowsByCurrency.get(currency) ?? { lineCount: 0, quantity: '0', turnover: '0' };
    if (total.lineCount !== actual.lineCount) {
      problems.push(SNAPSHOT_PROBLEMS.TOTALS_LINECOUNT_MISMATCH);
    }
    const quantity = canonicalSum(total.quantity);
    const turnover = canonicalSum(total.turnover);
    if (quantity === null || turnover === null) problems.push(SNAPSHOT_PROBLEMS.TOTALS_INVALID);
    if (quantity !== null && quantity !== actual.quantity) {
      problems.push(SNAPSHOT_PROBLEMS.TOTALS_QUANTITY_MISMATCH);
    }
    if (turnover !== null && turnover !== actual.turnover) {
      problems.push(SNAPSHOT_PROBLEMS.TOTALS_TURNOVER_MISMATCH);
    }
  }
  return [...new Set(problems)].sort();
}

/**
 * Validates a snapshot about to be saved: every row is well formed, `lineIndex` runs 0..n-1 with no
 * repeated source line, and the rows reconcile with the totals. Throws {@link SnapshotIntegrityError}
 * (problem codes only) rather than returning a half-valid snapshot.
 * @param {{ totals: object[], rows: object[] }} snapshot
 * @returns {{ rows: object[], rowCount: number, checksum: string, currencies: object[] }}
 *   `rows` are the canonical rows to store, in order.
 */
export function prepareSnapshot({ totals, rows }) {
  if (!Array.isArray(rows)) throw new SnapshotIntegrityError([SNAPSHOT_PROBLEMS.ROW_INVALID]);
  const verifier = createSnapshotVerifier({ checkDuplicateKeys: true });
  const canonical = rows.map((raw) => verifier.add(raw));
  const summary = verifier.result();
  const problems = [
    ...summary.problems,
    ...reconcileWithTotals(summary, { totals, rowCount: rows.length }),
  ];
  if (problems.length > 0) throw new SnapshotIntegrityError([...new Set(problems)].sort());
  return {
    rows: canonical.map(toStoredRow),
    rowCount: summary.rowCount,
    checksum: summary.checksum,
    currencies: summary.currencies,
  };
}

/** A canonical row as it is written: dates back to Date, optional fields only when present. */
function toStoredRow(row) {
  return { ...row, transactionAt: new Date(row.transactionAt) };
}

/** Public, API-safe form of a stored row (canonical text amounts, ISO timestamp). */
export function toRowView(raw) {
  return normalizeStoredRow(raw).row;
}
