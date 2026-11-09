import { decimalSign } from './decimal-string.js';
import { ISSUE_CODES as LINE_ISSUE } from './sales-line.normalizer.js';

/**
 * Transaction eligibility (Feature 17): decides whether a normalized sales line is counted in
 * reports and exports. ONE pure function, `evaluateLineEligibility`, holds every rule; reports and
 * exports must call it (or `applyEligibility`) and never re-implement a filter. Pure: no I/O, no
 * arithmetic on money, no currency handling (UNKNOWN-currency lines stay eligible and visible; that
 * is Feature 16's concern and nothing is combined across currencies here).
 *
 * Every exclusion carries a stable reason code. Ineligible lines are kept, never dropped, so the
 * reasons can be audited. Evidence (read-only live probes, 2026-11-08, one tenant, one day):
 *  - 200 TENDERED sales / 354 lines; `CANCELED` sales exist; 6 sales with `isNegative: true`
 *    (8 lines). Feature 14 already requests TENDERED + `isNegative false`; this module re-checks.
 *
 * OWNER DECISIONS (2026-11-08): TENDERED sales are included, CANCELED sales are not, and
 * non-turnover is not included (a line with non-zero `lineTotals.nonTurnover` is excluded).
 *
 * NOT OWNER-CONFIRMED (see RULES, `verified: false`, and docs/transaction-eligibility.md): other
 * statuses (void), and whether negative sales / negative lines are refunds or returns and whether
 * they should net against turnover.
 * The conservative choice is made in each case (exclude, with a reason) and `getEligibilityReadiness`
 * reports `productionReady: false` while any applied rule is unverified.
 */

export const ELIGIBILITY_RULES_VERSION = 1;

export const ELIGIBLE_STATUS = 'TENDERED';

/** Exclusion reasons. A line is eligible exactly when it has none. */
export const ELIGIBILITY_REASONS = Object.freeze({
  INVALID_LINE: 'INVALID_LINE',
  LINE_UNUSABLE: 'LINE_UNUSABLE',
  DUPLICATE_LINE: 'DUPLICATE_LINE',
  STATUS_MISSING: 'STATUS_MISSING',
  STATUS_CANCELED: 'STATUS_CANCELED',
  STATUS_NOT_TENDERED: 'STATUS_NOT_TENDERED',
  NEGATIVE_FLAG_MISSING: 'NEGATIVE_FLAG_MISSING',
  NEGATIVE_SALE: 'NEGATIVE_SALE',
  ZERO_QUANTITY: 'ZERO_QUANTITY',
  NEGATIVE_QUANTITY: 'NEGATIVE_QUANTITY',
  NEGATIVE_TURNOVER: 'NEGATIVE_TURNOVER',
  SIGN_MISMATCH: 'SIGN_MISMATCH',
  NON_TURNOVER_LINE: 'NON_TURNOVER_LINE',
});

/** Informational notes on eligible (or ineligible) lines. They never change eligibility. */
export const ELIGIBILITY_NOTES = Object.freeze({
  ZERO_TURNOVER: 'ZERO_TURNOVER',
  UNEXPECTED_DISCOUNT: 'UNEXPECTED_DISCOUNT',
  ADD_ON_PRICE_BASIS_UNVERIFIED: 'ADD_ON_PRICE_BASIS_UNVERIFIED',
});

/**
 * Rule register. `verified: true` only for data-integrity rules that need no business decision.
 * Everything that interprets GAAP status or sign semantics is unverified until the owner confirms.
 */
export const RULES = Object.freeze(
  [
    {
      reasons: [ELIGIBILITY_REASONS.INVALID_LINE, ELIGIBILITY_REASONS.LINE_UNUSABLE],
      verified: true,
      rule: 'Lines Feature 15 marked unusable (missing ids, quantity, turnover, timestamp) are never counted.',
    },
    {
      reasons: [ELIGIBILITY_REASONS.DUPLICATE_LINE],
      verified: true,
      rule: 'A repeated sourceLineKey is never counted twice.',
    },
    {
      reasons: [ELIGIBILITY_REASONS.STATUS_CANCELED],
      verified: true,
      rule: `Owner (2026-11-08): ${ELIGIBLE_STATUS} sales are included and CANCELED sales are never included.`,
    },
    {
      reasons: [ELIGIBILITY_REASONS.STATUS_MISSING, ELIGIBILITY_REASONS.STATUS_NOT_TENDERED],
      verified: false,
      rule: `A missing status, or any status other than TENDERED and CANCELED (e.g. void), is excluded; other statuses are not owner-confirmed.`,
    },
    {
      reasons: [ELIGIBILITY_REASONS.NON_TURNOVER_LINE],
      verified: true,
      rule: 'Owner (2026-11-08): non-turnover is not included; a line with a non-zero lineTotals.nonTurnover is excluded.',
    },
    {
      reasons: [ELIGIBILITY_REASONS.NEGATIVE_FLAG_MISSING, ELIGIBILITY_REASONS.NEGATIVE_SALE],
      verified: false,
      rule: 'Sales flagged isNegative (refund/return semantics unconfirmed) are excluded, not netted against turnover; a missing flag is excluded.',
    },
    {
      reasons: [
        ELIGIBILITY_REASONS.ZERO_QUANTITY,
        ELIGIBILITY_REASONS.NEGATIVE_QUANTITY,
        ELIGIBILITY_REASONS.NEGATIVE_TURNOVER,
        ELIGIBILITY_REASONS.SIGN_MISMATCH,
      ],
      verified: false,
      rule: 'Lines with zero or negative quantity, negative turnover, or opposite signs are excluded (return/refund line semantics unconfirmed).',
    },
  ].map((entry) => Object.freeze({ ...entry, reasons: Object.freeze(entry.reasons) })),
);

/**
 * @typedef {object} EligibilityReason
 * @property {string} code One of {@link ELIGIBILITY_REASONS}.
 * @property {string[]} [issueCodes] For LINE_UNUSABLE: the Feature 15 error codes (codes only, no values).
 *
 * @typedef {object} LineEligibility
 * @property {boolean} eligible True exactly when `reasons` is empty.
 * @property {EligibilityReason[]} reasons Exclusion reasons in a fixed order.
 * @property {string[]} notes Informational {@link ELIGIBILITY_NOTES}; never affect `eligible`.
 * @property {number} rulesVersion {@link ELIGIBILITY_RULES_VERSION}.
 */

/**
 * The single eligibility rule. Reads only fields of a Feature 15 normalized line; never mutates it.
 * @param {unknown} line A line from `normalizeSalesLines().lines`.
 * @returns {LineEligibility}
 */
export function evaluateLineEligibility(line) {
  if (line === null || typeof line !== 'object' || Array.isArray(line)) {
    return result([{ code: ELIGIBILITY_REASONS.INVALID_LINE }], []);
  }

  const reasons = [];
  const notes = [];
  const issues = Array.isArray(line.issues) ? line.issues : [];

  // Integrity. A line without a boolean `usable: true` is not trusted.
  const hasDuplicate = issues.some((issue) => issue?.code === LINE_ISSUE.DUPLICATE_SOURCE_LINE);
  if (hasDuplicate) reasons.push({ code: ELIGIBILITY_REASONS.DUPLICATE_LINE });
  const otherErrors = issues
    .filter(
      (issue) => issue?.severity === 'error' && issue.code !== LINE_ISSUE.DUPLICATE_SOURCE_LINE,
    )
    .map((issue) => issue.code);
  if (line.usable !== true && (otherErrors.length > 0 || !hasDuplicate)) {
    reasons.push({
      code: ELIGIBILITY_REASONS.LINE_UNUSABLE,
      issueCodes: [...new Set(otherErrors)],
    });
  }

  // Sale status.
  const status = line.sale?.status;
  if (typeof status !== 'string' || status === '') {
    reasons.push({ code: ELIGIBILITY_REASONS.STATUS_MISSING });
  } else if (status === 'CANCELED') {
    reasons.push({ code: ELIGIBILITY_REASONS.STATUS_CANCELED });
  } else if (status !== ELIGIBLE_STATUS) {
    reasons.push({ code: ELIGIBILITY_REASONS.STATUS_NOT_TENDERED });
  }

  // Negative-sale flag.
  const isNegative = line.sale?.isNegative;
  if (typeof isNegative !== 'boolean') {
    reasons.push({ code: ELIGIBILITY_REASONS.NEGATIVE_FLAG_MISSING });
  } else if (isNegative) {
    reasons.push({ code: ELIGIBILITY_REASONS.NEGATIVE_SALE });
  }

  // Line signs, compared on decimal text. A missing value is already LINE_UNUSABLE.
  const quantitySign = signOf(line.quantity);
  const turnoverSign = signOf(line.turnover);
  if (quantitySign === 0) reasons.push({ code: ELIGIBILITY_REASONS.ZERO_QUANTITY });
  if (quantitySign === -1) reasons.push({ code: ELIGIBILITY_REASONS.NEGATIVE_QUANTITY });
  if (turnoverSign === -1) reasons.push({ code: ELIGIBILITY_REASONS.NEGATIVE_TURNOVER });
  if (quantitySign !== null && turnoverSign !== null) {
    if (quantitySign !== 0 && turnoverSign !== 0 && quantitySign !== turnoverSign) {
      reasons.push({ code: ELIGIBILITY_REASONS.SIGN_MISMATCH });
    }
  }

  // Non-turnover is not included (owner): any non-zero amount excludes the line.
  const nonTurnoverSign = signOf(line.amounts?.nonTurnover);
  if (nonTurnoverSign !== null && nonTurnoverSign !== 0) {
    reasons.push({ code: ELIGIBILITY_REASONS.NON_TURNOVER_LINE });
  }

  // Notes.
  if (turnoverSign === 0) notes.push(ELIGIBILITY_NOTES.ZERO_TURNOVER);
  if (issues.some((issue) => issue?.code === LINE_ISSUE.UNEXPECTED_DISCOUNT)) {
    notes.push(ELIGIBILITY_NOTES.UNEXPECTED_DISCOUNT);
  }
  if (issues.some((issue) => issue?.code === LINE_ISSUE.ADD_ON_PRICE_BASIS_UNVERIFIED)) {
    notes.push(ELIGIBILITY_NOTES.ADD_ON_PRICE_BASIS_UNVERIFIED);
  }

  return result(reasons, notes);
}

/**
 * Applies {@link evaluateLineEligibility} to every line. Returns new line objects with an
 * `eligibility` property (inputs are not mutated), same order, nothing dropped. The summary has
 * line counts only: no money is read or summed.
 * @param {object[]} lines
 * @returns {{ rulesVersion: number, lines: object[], summary: { lineCount: number,
 *   eligibleCount: number, ineligibleCount: number, reasonCounts: Record<string, number>,
 *   noteCounts: Record<string, number> } }}
 */
export function applyEligibility(lines) {
  if (!Array.isArray(lines)) throw new TypeError('lines must be an array');
  const reasonCounts = {};
  const noteCounts = {};
  let eligibleCount = 0;

  const evaluated = lines.map((line) => {
    const eligibility = evaluateLineEligibility(line);
    if (eligibility.eligible) eligibleCount += 1;
    for (const code of new Set(eligibility.reasons.map((reason) => reason.code))) {
      reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
    }
    for (const note of eligibility.notes) noteCounts[note] = (noteCounts[note] ?? 0) + 1;
    return { ...(isPlainObject(line) ? line : {}), eligibility };
  });

  return {
    rulesVersion: ELIGIBILITY_RULES_VERSION,
    lines: evaluated,
    summary: {
      lineCount: evaluated.length,
      eligibleCount,
      ineligibleCount: evaluated.length - eligibleCount,
      reasonCounts,
      noteCounts,
    },
  };
}

/**
 * Whether the rules may be used for production reporting. False while any rule is unverified.
 * @returns {{ productionReady: boolean, unverifiedRules: { reasons: string[], rule: string }[] }}
 */
export function getEligibilityReadiness() {
  const unverifiedRules = RULES.filter((entry) => !entry.verified).map(({ reasons, rule }) => ({
    reasons: [...reasons],
    rule,
  }));
  return { productionReady: unverifiedRules.length === 0, unverifiedRules };
}

/** Production code paths call this before reporting; it throws until the owner confirms the rules. */
export function assertEligibilityProductionReady() {
  const { productionReady, unverifiedRules } = getEligibilityReadiness();
  if (!productionReady) {
    const error = new Error(
      `Transaction eligibility rules are not owner-verified (${unverifiedRules.length} unverified)`,
    );
    error.code = 'ELIGIBILITY_RULES_UNVERIFIED';
    throw error;
  }
}

function result(reasons, notes) {
  return {
    eligible: reasons.length === 0,
    reasons,
    notes,
    rulesVersion: ELIGIBILITY_RULES_VERSION,
  };
}

function signOf(text) {
  if (typeof text !== 'string') return null;
  try {
    return decimalSign(text);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
