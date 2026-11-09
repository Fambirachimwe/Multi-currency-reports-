import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SNAPSHOT_PROBLEMS as P,
  SnapshotIntegrityError,
  createSnapshotVerifier,
  normalizeStoredRow,
  prepareSnapshot,
  reconcileWithTotals,
  toPlainDecimal,
  toRowView,
} from './report-snapshot.js';

// FIXTURE rows: invented ids and amounts.
const row = (i, overrides = {}) => ({
  lineIndex: i,
  sourceLineKey: `s${i}/l1`,
  transactionAt: new Date('2026-11-05T08:00:00Z'),
  nodeId: 'node-a',
  productId: 'prod-1',
  currency: 'USD',
  quantity: '1',
  turnover: '2.5',
  warnings: [],
  ...overrides,
});
const totalsFor = (rows) => {
  const v = createSnapshotVerifier();
  rows.forEach((r) => v.add(r));
  return v.result().currencies;
};
const problemsOf = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SnapshotIntegrityError);
    return error.problems;
  }
  return [];
};

describe('toPlainDecimal', () => {
  it('keeps plain text and expands Decimal128 exponent text without changing digits', () => {
    assert.equal(toPlainDecimal('2.50'), '2.50');
    assert.equal(toPlainDecimal('-0'), '-0');
    assert.equal(toPlainDecimal('1E-7'), '0.0000001');
    assert.equal(toPlainDecimal('1.5E+3'), '1500');
    assert.equal(toPlainDecimal('-12345E-2'), '-123.45');
    assert.equal(toPlainDecimal('0E+0'), '0');
  });
  it('rejects non-numbers and absurd exponents', () => {
    for (const bad of ['', 'abc', 'NaN', 'Infinity', '1e', null, undefined, '1E+500']) {
      assert.equal(toPlainDecimal(bad), null, String(bad));
    }
  });
});

describe('prepareSnapshot', () => {
  it('accepts consistent rows and totals (per currency, exact, "12.50" equals "12.5")', () => {
    const rows = [
      row(0, { turnover: '0.10' }),
      row(1, { turnover: '0.20' }),
      row(2, { currency: 'ZWG', turnover: '300', quantity: '2' }),
    ];
    const prepared = prepareSnapshot({
      totals: [
        { currency: 'USD', lineCount: 2, quantity: '2', turnover: '0.30' },
        { currency: 'ZWG', lineCount: 1, quantity: '2', turnover: '300' },
      ],
      rows,
    });
    assert.equal(prepared.rowCount, 3);
    assert.match(prepared.checksum, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      prepared.rows.map((r) => r.lineIndex),
      [0, 1, 2],
    );
    assert.ok(prepared.rows[0].transactionAt instanceof Date);
  });

  it('an empty report is valid and has a stable checksum', () => {
    const a = prepareSnapshot({ totals: [], rows: [] });
    const b = prepareSnapshot({ totals: [], rows: [] });
    assert.equal(a.rowCount, 0);
    assert.equal(a.checksum, b.checksum);
  });

  it('the checksum depends on every field and on row order', () => {
    const rows = [row(0), row(1)];
    const totals = totalsFor(rows);
    const base = prepareSnapshot({ totals, rows }).checksum;
    const changed = (patch) => {
      const next = [row(0, patch), row(1)];
      return prepareSnapshot({ totals: totalsFor(next), rows: next }).checksum;
    };
    for (const patch of [
      { nodeId: 'node-b' },
      { productId: 'prod-2' },
      { sourceLineKey: 'other' },
      { transactionAt: new Date('2026-11-05T08:00:01Z') },
      { warnings: ['ZERO_TURNOVER'] },
      { nodeName: 'Name' },
    ]) {
      assert.notEqual(changed(patch), base, JSON.stringify(patch));
    }
    // A different amount gives different totals, so changing the totals alongside still changes the digest.
    assert.notEqual(changed({ turnover: '2.6' }), base);
    assert.equal(prepareSnapshot({ totals, rows: [row(0), row(1)] }).checksum, base);
  });

  it('rejects totals that do not reconcile with the rows (each field, each currency)', () => {
    const rows = [row(0), row(1)];
    const good = { currency: 'USD', lineCount: 2, quantity: '2', turnover: '5' };
    assert.deepEqual(
      problemsOf(() => prepareSnapshot({ totals: [good], rows })),
      [],
    );
    assert.deepEqual(
      problemsOf(() => prepareSnapshot({ totals: [{ ...good, turnover: '5.01' }], rows })),
      [P.TOTALS_TURNOVER_MISMATCH],
    );
    assert.deepEqual(
      problemsOf(() => prepareSnapshot({ totals: [{ ...good, quantity: '3' }], rows })),
      [P.TOTALS_QUANTITY_MISMATCH],
    );
    assert.deepEqual(
      problemsOf(() => prepareSnapshot({ totals: [{ ...good, lineCount: 1 }], rows })),
      [P.TOTALS_LINECOUNT_MISMATCH],
    );
    assert.deepEqual(
      problemsOf(() => prepareSnapshot({ totals: [], rows })),
      [P.TOTALS_CURRENCY_MISSING],
    );
    // A total with no rows is a mismatch too (a currency that exists only in the totals).
    assert.ok(
      problemsOf(() =>
        prepareSnapshot({
          totals: [good, { currency: 'ZWG', lineCount: 1, quantity: '1', turnover: '9' }],
          rows,
        }),
      ).includes(P.TOTALS_LINECOUNT_MISMATCH),
    );
    assert.deepEqual(
      problemsOf(() => prepareSnapshot({ totals: [good, { ...good }], rows })),
      [P.TOTALS_INVALID],
    );
  });

  it('never merges currencies: a total in the wrong currency does not reconcile', () => {
    const rows = [row(0, { currency: 'USD' }), row(1, { currency: 'ZWG', turnover: '10' })];
    const problems = problemsOf(() =>
      prepareSnapshot({
        totals: [{ currency: 'USD', lineCount: 2, quantity: '2', turnover: '12.5' }],
        rows,
      }),
    );
    assert.ok(problems.includes(P.TOTALS_CURRENCY_MISSING));
    assert.ok(problems.includes(P.TOTALS_LINECOUNT_MISMATCH));
  });

  it('rejects broken sequences, repeated source lines and bad rows', () => {
    const t = (rows) => ({ totals: totalsFor(rows), rows });
    assert.ok(problemsOf(() => prepareSnapshot(t([row(1)]))).includes(P.ROW_INDEX_SEQUENCE));
    assert.ok(
      problemsOf(() => prepareSnapshot(t([row(0), row(2)]))).includes(P.ROW_INDEX_SEQUENCE),
    );
    assert.ok(
      problemsOf(() => prepareSnapshot(t([row(0), row(1, { sourceLineKey: 's0/l1' })]))).includes(
        P.ROW_DUPLICATE_KEY,
      ),
    );
    const bad = [
      [{ currency: undefined }, P.ROW_CURRENCY_INVALID],
      [{ currency: 'usd' }, P.ROW_CURRENCY_INVALID],
      [{ turnover: undefined }, P.ROW_DECIMAL_INVALID],
      [{ turnover: 'NaN' }, P.ROW_DECIMAL_INVALID],
      [{ turnover: 12.5 }, P.ROW_DECIMAL_INVALID],
      [{ quantity: '' }, P.ROW_DECIMAL_INVALID],
      [{ turnover: '1'.repeat(35) }, P.ROW_DECIMAL_INVALID],
      [{ transactionAt: '2026-11-05' }, P.ROW_TIMESTAMP_INVALID],
      [{ transactionAt: new Date('x') }, P.ROW_TIMESTAMP_INVALID],
      [{ nodeId: '  ' }, P.ROW_INVALID],
      [{ productId: undefined }, P.ROW_INVALID],
      [{ warnings: 'x' }, P.ROW_INVALID],
    ];
    for (const [patch, expected] of bad) {
      const rows = [row(0, patch)];
      const problems = problemsOf(() => prepareSnapshot({ totals: [], rows }));
      assert.ok(problems.includes(expected), `${JSON.stringify(patch)} -> ${problems}`);
    }
    assert.ok(
      problemsOf(() => prepareSnapshot({ totals: [], rows: [null] })).includes(P.ROW_INVALID),
    );
    assert.ok(problemsOf(() => prepareSnapshot({ totals: [], rows: 'x' })).includes(P.ROW_INVALID));
  });

  it('keeps 34 significant digits and a missing amount is never read as 0', () => {
    const rows = [row(0, { turnover: '1234567890123456789012345678901.234' })];
    assert.doesNotThrow(() => prepareSnapshot({ totals: totalsFor(rows), rows }));
    const missing = [row(0, { quantity: undefined })];
    assert.ok(problemsOf(() => prepareSnapshot({ totals: [], rows: missing })).length > 0);
  });

  it('stores strings trimmed as the model would, so reload compares equal', () => {
    const rows = [row(0, { nodeName: '  Harare  ', productName: '   ', sourceLineKey: ' k ' })];
    const prepared = prepareSnapshot({ totals: totalsFor(rows), rows });
    assert.equal(prepared.rows[0].nodeName, 'Harare');
    assert.equal(prepared.rows[0].sourceLineKey, 'k');
    assert.equal('productName' in prepared.rows[0], false);
  });

  it('error messages carry codes only, never source values', () => {
    const secret = 'SECRET-NODE-VALUE';
    try {
      prepareSnapshot({ totals: [], rows: [row(0, { nodeId: secret, turnover: 'bad' })] });
      assert.fail('should have thrown');
    } catch (error) {
      assert.equal(error.code, 'SNAPSHOT_INTEGRITY_FAILED');
      assert.equal(error.message.includes(secret), false);
    }
  });
});

describe('verifier and reconcile', () => {
  it('summaries of identical rows are identical, whatever the representation', () => {
    const asInput = row(0, { turnover: '0.0000001' });
    const asStored = { ...asInput, turnover: { toString: () => '1E-7' } };
    const a = createSnapshotVerifier();
    const b = createSnapshotVerifier();
    a.add(asInput);
    b.add(asStored);
    assert.deepEqual(a.result(), b.result());
  });

  it('reconcileWithTotals reports a row-count difference', () => {
    const v = createSnapshotVerifier();
    v.add(row(0));
    assert.deepEqual(
      reconcileWithTotals(v.result(), {
        totals: [{ currency: 'USD', lineCount: 1, quantity: '1', turnover: '2.5' }],
        rowCount: 2,
      }),
      [P.ROW_COUNT_MISMATCH],
    );
  });

  it('normalizeStoredRow / toRowView give API text for amounts and ISO for times', () => {
    const view = toRowView({ ...row(3), turnover: { toString: () => '1E+3' } });
    assert.equal(view.turnover, '1000');
    assert.equal(view.transactionAt, '2026-11-05T08:00:00.000Z');
    assert.deepEqual(normalizeStoredRow(null).problems, [P.ROW_INVALID]);
  });
});
