import { createDecimalSum, isDecimalString } from '../gaap/decimal-sum.js';

/**
 * Pure assembly of the summary view of one SAVED report (Feature 23). The inputs are the saved
 * per-currency totals (from the report document) and per-currency product/node groupings read from
 * the saved rows in MongoDB; nothing here fetches data, calls GAAP or recalculates the saved totals.
 *
 * The saved totals are the authority. The groupings are only checked against them (exact decimal
 * sums, currencies never merged): a disagreement is reported as a problem code, never repaired.
 */

export const SUMMARY_PROBLEMS = Object.freeze({
  ROW_COUNT_MISMATCH: 'ROW_COUNT_MISMATCH',
  PRODUCT_GROUPS_MISMATCH: 'PRODUCT_GROUPS_MISMATCH',
  NODE_GROUPS_MISMATCH: 'NODE_GROUPS_MISMATCH',
  SUMMARY_DATA_INVALID: 'SUMMARY_DATA_INVALID',
});

export const CURRENCY_UNKNOWN = 'UNKNOWN';

/** Alphabetical, with UNKNOWN last (the order Feature 18 uses). */
function compareCurrency(a, b) {
  if (a === b) return 0;
  if (a === CURRENCY_UNKNOWN) return 1;
  if (b === CURRENCY_UNKNOWN) return -1;
  return a < b ? -1 : 1;
}

/** Currency, then name (case-insensitive, unnamed last), then id: a total, deterministic order. */
function compareGroup(a, b) {
  const byCurrency = compareCurrency(a.currency, b.currency);
  if (byCurrency !== 0) return byCurrency;
  if (a.name !== b.name) {
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    if (left !== right) return left < right ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

const isCount = (value) => Number.isInteger(value) && value >= 0;

/** Canonical text of a decimal ("12.50" -> "12.5") or null when it is not decimal text. */
function canonical(value) {
  return isDecimalString(value) ? createDecimalSum().add(value).toString() : null;
}

/**
 * Compares per-currency sums of `groups` with the saved totals. Returns true when they agree on
 * every currency (line count, quantity and turnover). Unreadable data returns `null`.
 */
function groupsMatchTotals(groups, totals) {
  const sums = new Map();
  for (const group of groups) {
    if (!isCount(group.lineCount) || canonical(group.quantity) === null) return null;
    if (canonical(group.turnover) === null) return null;
    const entry = sums.get(group.currency) ?? {
      lineCount: 0,
      quantity: createDecimalSum(),
      turnover: createDecimalSum(),
    };
    entry.lineCount += group.lineCount;
    entry.quantity.add(group.quantity);
    entry.turnover.add(group.turnover);
    sums.set(group.currency, entry);
  }

  const saved = new Map();
  for (const total of totals) {
    const quantity = canonical(total.quantity);
    const turnover = canonical(total.turnover);
    if (!isCount(total.lineCount) || quantity === null || turnover === null) return null;
    saved.set(total.currency, { lineCount: total.lineCount, quantity, turnover });
  }

  for (const currency of sums.keys()) if (!saved.has(currency)) return false;
  for (const [currency, total] of saved) {
    const actual = sums.get(currency);
    if (actual === undefined) {
      // A currency with saved lines must have groups; one with none has nothing to compare.
      if (total.lineCount !== 0) return false;
      continue;
    }
    if (
      actual.lineCount !== total.lineCount ||
      actual.quantity.toString() !== total.quantity ||
      actual.turnover.toString() !== total.turnover
    ) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} input
 * @param {{ currency: string, lineCount: number, quantity: string, turnover: string }[]} input.totals
 *   Saved per-currency totals (decimal text).
 * @param {number} input.rowCount Saved row count.
 * @param {{ currency: string, id: string, name: string|null, lineCount: number, quantity: string, turnover: string }[]} input.products
 * @param {{ currency: string, id: string, name: string|null, lineCount: number, quantity: string, turnover: string }[]} input.nodes
 * @param {{ code: string, rowCount: number }[]} input.warnings Row warning codes with row counts.
 */
export function buildReportSummary({ totals, rowCount, products, nodes, warnings }) {
  const currencies = [...totals]
    .sort((a, b) => compareCurrency(a.currency, b.currency))
    .map((total) => ({
      currency: total.currency,
      lineCount: total.lineCount,
      quantity: total.quantity,
      turnover: total.turnover,
    }));

  const problems = new Set();
  const savedLines = currencies.reduce((sum, total) => sum + (total.lineCount ?? 0), 0);
  if (savedLines !== rowCount) problems.add(SUMMARY_PROBLEMS.ROW_COUNT_MISMATCH);

  for (const [groups, problem] of [
    [products, SUMMARY_PROBLEMS.PRODUCT_GROUPS_MISMATCH],
    [nodes, SUMMARY_PROBLEMS.NODE_GROUPS_MISMATCH],
  ]) {
    const result = groupsMatchTotals(groups, totals);
    if (result === null) problems.add(SUMMARY_PROBLEMS.SUMMARY_DATA_INVALID);
    else if (result === false) problems.add(problem);
  }

  return {
    rowCount,
    currencies,
    products: [...products].sort(compareGroup),
    nodes: [...nodes].sort(compareGroup),
    warnings: [...warnings].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    consistency: { ok: problems.size === 0, problems: [...problems].sort() },
  };
}
