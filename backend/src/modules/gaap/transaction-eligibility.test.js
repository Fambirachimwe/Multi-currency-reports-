import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ELIGIBILITY_NOTES as NOTES,
  ELIGIBILITY_REASONS as R,
  ELIGIBILITY_RULES_VERSION,
  RULES,
  applyEligibility,
  assertEligibilityProductionReady,
  evaluateLineEligibility,
  getEligibilityReadiness,
} from './transaction-eligibility.js';
import { classifyLineCurrencies } from './currency.resolver.js';
import { normalizeSalesLines } from './sales-line.normalizer.js';
import { fixtureRawLine, fixtureRawSale } from './fixtures/sales-lines.fixture.js';

// FIXTURE-based: proves the rule logic, not GAAP behaviour. The status, negative-sale and
// negative-line rules are not owner-confirmed (see transaction-eligibility.js).

const lineOf = (saleOverrides = {}, itemOverrides = {}) =>
  normalizeSalesLines([fixtureRawSale('s1', [fixtureRawLine('l1', itemOverrides)], saleOverrides)])
    .lines[0];

const codes = (eligibility) => eligibility.reasons.map((reason) => reason.code);

describe('evaluateLineEligibility: tendered', () => {
  it('accepts a normal tendered line with no reasons', () => {
    const eligibility = evaluateLineEligibility(lineOf());
    assert.equal(eligibility.eligible, true);
    assert.deepEqual(eligibility.reasons, []);
    assert.equal(eligibility.rulesVersion, ELIGIBILITY_RULES_VERSION);
  });

  it('does not mutate the line', () => {
    const line = lineOf();
    const before = JSON.stringify(line);
    evaluateLineEligibility(line);
    assert.equal(JSON.stringify(line), before);
  });

  it('keeps a zero-turnover line with positive quantity eligible, with a note', () => {
    const eligibility = evaluateLineEligibility(lineOf({}, { priceIncl: 0, turnover: 0 }));
    assert.equal(eligibility.eligible, true);
    assert.deepEqual(eligibility.notes, [NOTES.ZERO_TURNOVER]);
  });

  it('notes unexpected discount and add-on basis without excluding', () => {
    const line = lineOf({}, { discountAmount: 1, addOnsPriceIncl: 2 });
    const eligibility = evaluateLineEligibility(line);
    assert.equal(eligibility.eligible, true);
    assert.deepEqual(eligibility.notes.sort(), [
      NOTES.ADD_ON_PRICE_BASIS_UNVERIFIED,
      NOTES.UNEXPECTED_DISCOUNT,
    ]);
  });

  it('excludes a line with non-zero non-turnover (owner decision)', () => {
    for (const nonTurnover of [3, -3, 0.01]) {
      const line = lineOf({}, { lineTotals: { turnover: 4.6, tax: 0.6, nonTurnover } });
      assert.deepEqual(
        codes(evaluateLineEligibility(line)),
        [R.NON_TURNOVER_LINE],
        `${nonTurnover}`,
      );
    }
  });

  it('keeps a line with zero or absent non-turnover', () => {
    assert.equal(evaluateLineEligibility(lineOf()).eligible, true);
    const absent = lineOf({}, { lineTotals: { turnover: 4.6, tax: 0.6 } });
    assert.equal(evaluateLineEligibility(absent).eligible, true);
  });

  it('does not look at currency: UNKNOWN currency stays eligible', () => {
    const line = lineOf({ forex: {} });
    const { lines } = classifyLineCurrencies([line]);
    assert.equal(lines[0].currency, 'UNKNOWN');
    assert.equal(evaluateLineEligibility(lines[0]).eligible, true);
  });
});

describe('evaluateLineEligibility: void and other statuses', () => {
  it('excludes CANCELED with its own reason', () => {
    assert.deepEqual(codes(evaluateLineEligibility(lineOf({ status: 'CANCELED' }))), [
      R.STATUS_CANCELED,
    ]);
  });

  it('excludes any other status, including VOID and lower-case tendered', () => {
    for (const status of ['VOID', 'VOIDED', 'OPEN', 'REFUNDED', 'tendered', ' TENDERED']) {
      assert.deepEqual(
        codes(evaluateLineEligibility(lineOf({ status }))),
        [R.STATUS_NOT_TENDERED],
        status,
      );
    }
  });

  it('excludes a missing or non-string status', () => {
    for (const status of [undefined, null, '', 5]) {
      assert.deepEqual(
        codes(evaluateLineEligibility(lineOf({ status }))),
        [R.STATUS_MISSING],
        String(status),
      );
    }
  });
});

describe('evaluateLineEligibility: refund, return and negative', () => {
  it('excludes a negative sale (refund) with every reason that applies', () => {
    const line = lineOf({ isNegative: true }, { qty: -1, priceIncl: 4.6, turnover: -4.6 });
    assert.deepEqual(codes(evaluateLineEligibility(line)), [
      R.NEGATIVE_SALE,
      R.NEGATIVE_QUANTITY,
      R.NEGATIVE_TURNOVER,
    ]);
  });

  it('excludes a negative sale even when the line looks positive', () => {
    assert.deepEqual(codes(evaluateLineEligibility(lineOf({ isNegative: true }))), [
      R.NEGATIVE_SALE,
    ]);
  });

  it('excludes a negative line inside a non-negative sale (return line)', () => {
    const eligibility = evaluateLineEligibility(lineOf({}, { qty: -2, turnover: -9.2 }));
    assert.equal(eligibility.eligible, false);
    assert.deepEqual(codes(eligibility), [R.NEGATIVE_QUANTITY, R.NEGATIVE_TURNOVER]);
  });

  it('excludes zero quantity', () => {
    assert.deepEqual(codes(evaluateLineEligibility(lineOf({}, { qty: 0, turnover: 0 }))), [
      R.ZERO_QUANTITY,
    ]);
  });

  it('excludes negative turnover on positive quantity and flags the sign mismatch', () => {
    assert.deepEqual(codes(evaluateLineEligibility(lineOf({}, { turnover: -4.6 }))), [
      R.NEGATIVE_TURNOVER,
      R.SIGN_MISMATCH,
    ]);
  });

  it('excludes positive turnover on negative quantity', () => {
    assert.deepEqual(codes(evaluateLineEligibility(lineOf({}, { qty: -1, turnover: 4.6 }))), [
      R.NEGATIVE_QUANTITY,
      R.SIGN_MISMATCH,
    ]);
  });

  it('excludes a missing or non-boolean isNegative flag', () => {
    for (const isNegative of [undefined, null, 'false', 0]) {
      assert.deepEqual(
        codes(evaluateLineEligibility(lineOf({ isNegative }))),
        [R.NEGATIVE_FLAG_MISSING],
        String(isNegative),
      );
    }
  });
});

describe('evaluateLineEligibility: duplicates and unusable lines', () => {
  it('counts the first occurrence and excludes the repeat as DUPLICATE_LINE', () => {
    const { lines } = normalizeSalesLines([
      fixtureRawSale('s1', [fixtureRawLine('l1')]),
      fixtureRawSale('s1', [fixtureRawLine('l1')]),
    ]);
    assert.equal(evaluateLineEligibility(lines[0]).eligible, true);
    assert.deepEqual(codes(evaluateLineEligibility(lines[1])), [R.DUPLICATE_LINE]);
  });

  it('excludes a repeated line that also has another error, with both reasons', () => {
    const { lines } = normalizeSalesLines([
      fixtureRawSale('s1', [fixtureRawLine('l1')]),
      fixtureRawSale('s1', [fixtureRawLine('l1', { lineTotals: {} })]),
    ]);
    const eligibility = evaluateLineEligibility(lines[1]);
    assert.deepEqual(codes(eligibility), [R.DUPLICATE_LINE, R.LINE_UNUSABLE]);
    assert.deepEqual(eligibility.reasons[1].issueCodes, ['MISSING_TURNOVER']);
  });

  it('excludes unusable lines and lists the Feature 15 error codes only', () => {
    const sale = fixtureRawSale('s1', [fixtureRawLine('l1', { product: {}, qty: undefined })]);
    const [line] = normalizeSalesLines([sale]).lines;
    const eligibility = evaluateLineEligibility(line);
    assert.equal(eligibility.eligible, false);
    assert.deepEqual(codes(eligibility), [R.LINE_UNUSABLE]);
    assert.deepEqual(eligibility.reasons[0].issueCodes.sort(), [
      'MISSING_PRODUCT_ID',
      'MISSING_QUANTITY',
    ]);
  });

  it('does not trust a line that merely lacks usable: true', () => {
    const line = { ...lineOf(), usable: undefined };
    assert.ok(codes(evaluateLineEligibility(line)).includes(R.LINE_UNUSABLE));
  });

  it('excludes non-object input without throwing', () => {
    for (const value of [null, undefined, 'x', 5, [], true]) {
      const eligibility = evaluateLineEligibility(value);
      assert.deepEqual(codes(eligibility), [R.INVALID_LINE]);
      assert.equal(eligibility.eligible, false);
    }
  });

  it('excludes an empty object (nothing trusted by default)', () => {
    const eligibility = evaluateLineEligibility({});
    assert.equal(eligibility.eligible, false);
    assert.ok(codes(eligibility).includes(R.LINE_UNUSABLE));
    assert.ok(codes(eligibility).includes(R.STATUS_MISSING));
  });
});

describe('applyEligibility: one rule for every report and export', () => {
  const sales = [
    fixtureRawSale('t1', [fixtureRawLine('a'), fixtureRawLine('b', { qty: 2 })]),
    fixtureRawSale('c1', [fixtureRawLine('a')], { status: 'CANCELED' }),
    fixtureRawSale('n1', [fixtureRawLine('a', { qty: -1, turnover: -4.6 })], { isNegative: true }),
    fixtureRawSale('t1', [fixtureRawLine('a')]), // duplicate of t1/a
  ];

  it('keeps every line, in order, and counts reasons per line', () => {
    const normalized = normalizeSalesLines(sales);
    const result = applyEligibility(normalized.lines);
    assert.equal(result.lines.length, normalized.lines.length);
    assert.deepEqual(
      result.lines.map((line) => line.sourceLineKey),
      normalized.lines.map((line) => line.sourceLineKey),
    );
    assert.deepEqual(result.summary, {
      lineCount: 5,
      eligibleCount: 2,
      ineligibleCount: 3,
      reasonCounts: {
        STATUS_CANCELED: 1,
        NEGATIVE_SALE: 1,
        NEGATIVE_QUANTITY: 1,
        NEGATIVE_TURNOVER: 1,
        DUPLICATE_LINE: 1,
      },
      noteCounts: {},
    });
  });

  it('agrees with evaluateLineEligibility for every line (single rule)', () => {
    const { lines } = normalizeSalesLines(sales);
    const result = applyEligibility(lines);
    result.lines.forEach((line, index) => {
      assert.deepEqual(line.eligibility, evaluateLineEligibility(lines[index]));
    });
  });

  it('does not mutate inputs and returns line counts only (no money)', () => {
    const { lines } = normalizeSalesLines(sales);
    const before = JSON.stringify(lines);
    const result = applyEligibility(lines);
    assert.equal(JSON.stringify(lines), before);
    assert.deepEqual(Object.keys(result.summary).sort(), [
      'eligibleCount',
      'ineligibleCount',
      'lineCount',
      'noteCounts',
      'reasonCounts',
    ]);
  });

  it('handles an empty list and rejects non-arrays', () => {
    assert.equal(applyEligibility([]).summary.lineCount, 0);
    assert.throws(() => applyEligibility(null), TypeError);
    assert.throws(() => applyEligibility('x'), TypeError);
  });

  it('keeps non-object entries visible as ineligible', () => {
    const result = applyEligibility([null]);
    assert.equal(result.lines[0].eligibility.eligible, false);
    assert.equal(result.summary.reasonCounts.INVALID_LINE, 1);
  });
});

describe('auditability and production readiness', () => {
  it('documents every reason code in exactly one rule', () => {
    const documented = RULES.flatMap((entry) => entry.reasons).sort();
    assert.deepEqual(documented, Object.values(R).sort());
  });

  it('is not production-ready while negative-sale and sign rules are unverified', () => {
    const readiness = getEligibilityReadiness();
    assert.equal(readiness.productionReady, false);
    assert.ok(readiness.unverifiedRules.length >= 2);
    assert.throws(() => assertEligibilityProductionReady(), {
      code: 'ELIGIBILITY_RULES_UNVERIFIED',
    });
  });

  it('marks integrity rules and the owner-confirmed rules as verified, nothing else', () => {
    const verified = RULES.filter((entry) => entry.verified).flatMap((entry) => [...entry.reasons]);
    assert.deepEqual(
      verified.sort(),
      [
        R.DUPLICATE_LINE,
        R.INVALID_LINE,
        R.LINE_UNUSABLE,
        R.STATUS_CANCELED,
        R.NON_TURNOVER_LINE,
      ].sort(),
    );
  });

  it('does not echo source values in reasons', () => {
    const eligibility = evaluateLineEligibility(lineOf({ status: 'SECRET-STATUS-VALUE' }));
    assert.ok(!JSON.stringify(eligibility).includes('SECRET-STATUS-VALUE'));
  });
});
