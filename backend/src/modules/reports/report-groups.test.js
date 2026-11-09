/** Pure tests for the saved-report groupings and summary assembly. Rows are FIXTURES. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGroupAccumulator } from './report-groups.js';
import { buildReportSummary } from './report-summary.js';

const row = (overrides = {}) => ({
  nodeId: 'n1',
  nodeName: 'Store One',
  productId: 'p1',
  productName: 'Product One',
  currency: 'USD',
  quantity: '1',
  turnover: '2.5',
  warnings: [],
  ...overrides,
});

function groupsOf(rows) {
  const accumulator = createGroupAccumulator();
  for (const r of rows) accumulator.add(r);
  return accumulator.result();
}

/** Totals computed independently of the code under test (small exact fixtures, integer cents). */
function totalsOf(rows) {
  const byCurrency = new Map();
  for (const r of rows) {
    const t = byCurrency.get(r.currency) ?? { currency: r.currency, lineCount: 0, q: 0, cents: 0 };
    t.lineCount += 1;
    t.q += Number(r.quantity);
    t.cents += Math.round(Number(r.turnover) * 100);
    byCurrency.set(r.currency, t);
  }
  return [...byCurrency.values()].map((t) => ({
    currency: t.currency,
    lineCount: t.lineCount,
    quantity: String(t.q),
    turnover: String(t.cents / 100),
  }));
}

function summaryOf(rows) {
  return buildReportSummary({ totals: totalsOf(rows), rowCount: rows.length, ...groupsOf(rows) });
}

describe('createGroupAccumulator + buildReportSummary', () => {
  it('is empty and consistent for no rows', () => {
    const summary = buildReportSummary({ totals: [], rowCount: 0, ...groupsOf([]) });
    assert.deepEqual(summary.products, []);
    assert.deepEqual(summary.nodes, []);
    assert.deepEqual(summary.warnings, []);
    assert.deepEqual(summary.consistency, { ok: true, problems: [] });
  });

  it('sums exactly per currency and product, with no float error', () => {
    const { products } = groupsOf([
      row({ turnover: '0.1' }),
      row({ turnover: '0.2' }),
      row({ turnover: '0.7', quantity: '2.5' }),
    ]);
    assert.deepEqual(products, [
      {
        currency: 'USD',
        id: 'p1',
        name: 'Product One',
        lineCount: 3,
        quantity: '4.5',
        turnover: '1',
      },
    ]);
  });

  it('never merges currencies: the same product in USD, ZWG and UNKNOWN stays separate', () => {
    const summary = summaryOf([
      row({ currency: 'UNKNOWN', turnover: '5' }),
      row({ currency: 'ZWG', turnover: '100' }),
      row({ currency: 'USD', turnover: '3' }),
    ]);
    assert.deepEqual(
      summary.products.map((g) => [g.currency, g.turnover]),
      [
        ['USD', '3'],
        ['ZWG', '100'],
        ['UNKNOWN', '5'],
      ],
    );
    assert.equal(summary.nodes.length, 3);
    assert.equal(summary.consistency.ok, true);
  });

  it('orders deterministically whatever the row order', () => {
    const rows = [
      row({ nodeId: 'n2', productId: 'p2', nodeName: undefined, productName: undefined }),
      row({ nodeId: 'n1', productId: 'p1' }),
      row({ nodeId: 'n1', productId: 'p2', productName: undefined }),
    ];
    const a = summaryOf(rows);
    const b = summaryOf([...rows].reverse());
    assert.deepEqual(a, b);
    assert.deepEqual(
      a.nodes.map((g) => [g.id, g.lineCount]),
      [
        ['n1', 2],
        ['n2', 1],
      ],
    );
    assert.equal(a.products.find((g) => g.id === 'p2').name, null);
  });

  it('keeps refunds as given, not hidden or netted away silently', () => {
    const summary = summaryOf([row({ turnover: '10' }), row({ turnover: '-4', quantity: '-1' })]);
    assert.equal(summary.products[0].turnover, '6');
    assert.equal(summary.products[0].quantity, '0');
    assert.equal(summary.consistency.ok, true);
  });

  it('counts each warning once per row, sorted by code', () => {
    const { warnings } = summaryOf([
      row({ warnings: ['ZERO_TURNOVER', 'ZERO_TURNOVER'] }),
      row({ warnings: ['ZERO_TURNOVER', 'ADD_ON_BASIS'] }),
      row(),
    ]);
    assert.deepEqual(warnings, [
      { code: 'ADD_ON_BASIS', rowCount: 1 },
      { code: 'ZERO_TURNOVER', rowCount: 2 },
    ]);
  });

  it('reports a disagreement with the saved totals instead of repairing it', () => {
    const rows = [row({ turnover: '2' }), row({ turnover: '3' })];
    const grouped = groupsOf(rows);
    const wrongTurnover = buildReportSummary({
      totals: [{ currency: 'USD', lineCount: 2, quantity: '2', turnover: '99' }],
      rowCount: 2,
      ...grouped,
    });
    assert.equal(wrongTurnover.consistency.ok, false);
    assert.deepEqual(wrongTurnover.consistency.problems, [
      'NODE_GROUPS_MISMATCH',
      'PRODUCT_GROUPS_MISMATCH',
    ]);

    const wrongCount = buildReportSummary({
      totals: [{ currency: 'USD', lineCount: 2, quantity: '2', turnover: '5' }],
      rowCount: 7,
      ...grouped,
    });
    assert.ok(wrongCount.consistency.problems.includes('ROW_COUNT_MISMATCH'));

    const missingCurrency = buildReportSummary({ totals: [], rowCount: 2, ...grouped });
    assert.equal(missingCurrency.consistency.ok, false);
  });

  it('flags unreadable summary data', () => {
    const summary = buildReportSummary({
      totals: [{ currency: 'USD', lineCount: 1, quantity: 'x', turnover: '1' }],
      rowCount: 1,
      ...groupsOf([row()]),
    });
    assert.ok(summary.consistency.problems.includes('SUMMARY_DATA_INVALID'));
  });
});
