import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDecimalSum, isDecimalString, sumDecimalStrings } from './decimal-sum.js';
import {
  AGGREGATION_EXCLUSIONS,
  aggregateFinancials,
  aggregateNormalizedLines,
  verifyReconciliation,
} from './financial-aggregation.js';
import { fixtureForex, fixtureRawLine, fixtureRawSale } from './fixtures/sales-lines.fixture.js';
import { normalizeSalesLines } from './sales-line.normalizer.js';

// FIXTURE lines: invented ids and amounts, already classified (currency) and evaluated (eligibility).
function line(overrides = {}) {
  return {
    sourceLineKey: 'S/1',
    productId: 'p1',
    productName: 'FIXTURE P1',
    nodeId: 'n1',
    nodeName: 'FIXTURE N1',
    quantity: '1',
    turnover: '10',
    amounts: { tax: '1.5' },
    currency: 'USD',
    eligibility: { eligible: true, reasons: [], notes: [], rulesVersion: 1 },
    ...overrides,
  };
}

function ineligible(code, overrides = {}) {
  return line({
    eligibility: { eligible: false, reasons: [{ code }], notes: [], rulesVersion: 1 },
    ...overrides,
  });
}

const usd = (result) => result.currencies.find((entry) => entry.currency === 'USD');

describe('decimal sums', () => {
  it('adds exactly where floats drift', () => {
    assert.equal(sumDecimalStrings(['0.1', '0.2']), '0.3');
    assert.equal(sumDecimalStrings(Array(10).fill('0.1')), '1');
    assert.equal(sumDecimalStrings(['1.005', '2.0049999']), '3.0099999');
  });

  it('handles empty, negatives, zero and trailing zeros', () => {
    assert.equal(sumDecimalStrings([]), '0');
    assert.equal(sumDecimalStrings(['5', '-5']), '0');
    assert.equal(sumDecimalStrings(['-0.5', '-0.25']), '-0.75');
    assert.equal(sumDecimalStrings(['1.50', '1.50']), '3');
    assert.equal(sumDecimalStrings(['0.001', '-0.002']), '-0.001');
  });

  it('is exact for values beyond float precision', () => {
    const big = '123456789012345678901234567890.123456789';
    assert.equal(
      sumDecimalStrings([big, '0.000000001']),
      '123456789012345678901234567890.12345679',
    );
    assert.equal(sumDecimalStrings([big, big]), '246913578024691357802469135780.246913578');
    assert.equal(
      sumDecimalStrings(['9007199254740993', '1']),
      '9007199254740994',
      'above Number.MAX_SAFE_INTEGER',
    );
  });

  it('rejects anything that is not plain decimal text', () => {
    for (const bad of [
      1,
      null,
      undefined,
      '',
      '1e5',
      ' 1',
      '1.',
      '.5',
      'NaN',
      '--1',
      '+1',
      '1,5',
    ]) {
      assert.throws(() => createDecimalSum().add(bad), TypeError, String(bad));
      assert.equal(isDecimalString(bad), false);
    }
  });
});

describe('aggregateFinancials', () => {
  it('returns an empty, reconciled result for no lines', () => {
    const result = aggregateFinancials([]);
    assert.deepEqual(result.currencies, []);
    assert.equal(result.summary.lineCount, 0);
    assert.equal(result.summary.eligibleLineCount, 0);
    assert.deepEqual(result.reconciliation, { ok: true, mismatches: [] });
  });

  it('returns an empty currency list when every line is excluded, keeping the reasons', () => {
    const result = aggregateFinancials([
      ineligible('STATUS_CANCELED'),
      ineligible('NEGATIVE_SALE'),
      ineligible('STATUS_CANCELED'),
    ]);
    assert.deepEqual(result.currencies, []);
    assert.equal(result.summary.excludedLineCount, 3);
    assert.deepEqual(result.summary.excludedReasonCounts, { NEGATIVE_SALE: 1, STATUS_CANCELED: 2 });
  });

  it('groups by currency, then product and node, and totals exactly', () => {
    const result = aggregateFinancials([
      line({ sourceLineKey: 'S/1', quantity: '2', turnover: '9.2', amounts: { tax: '1.2' } }),
      line({ sourceLineKey: 'S/2', quantity: '1', turnover: '4.6', amounts: { tax: '0.6' } }),
      line({
        sourceLineKey: 'S/3',
        productId: 'p2',
        productName: 'FIXTURE P2',
        nodeId: 'n2',
        nodeName: 'FIXTURE N2',
        quantity: '3',
        turnover: '0.3',
        amounts: { tax: '0' },
      }),
    ]);
    const entry = usd(result);
    assert.equal(result.currencies.length, 1);
    assert.deepEqual(entry.totals, {
      lineCount: 3,
      quantity: '6',
      turnover: '14.1',
      tax: '1.8',
      taxLineCount: 3,
      taxMissingLineCount: 0,
    });
    assert.deepEqual(
      entry.products.map((p) => [p.productId, p.totals.turnover, p.totals.lineCount]),
      [
        ['p1', '13.8', 2],
        ['p2', '0.3', 1],
      ],
    );
    assert.deepEqual(
      entry.nodes.map((n) => [n.nodeId, n.totals.turnover]),
      [
        ['n1', '13.8'],
        ['n2', '0.3'],
      ],
    );
    assert.deepEqual(
      entry.productNodes.map((c) => [c.productId, c.nodeId, c.totals.quantity]),
      [
        ['p1', 'n1', '3'],
        ['p2', 'n2', '3'],
      ],
    );
    assert.deepEqual(result.reconciliation, { ok: true, mismatches: [] });
  });

  it('never mixes currencies: one total per currency, UNKNOWN separate and last', () => {
    const result = aggregateFinancials([
      line({ currency: 'ZWG', turnover: '100' }),
      line({ currency: 'USD', turnover: '10' }),
      line({ currency: 'UNKNOWN', turnover: '7' }),
      line({ currency: 'USD', turnover: '5' }),
      line({ currency: 'EUR', turnover: '1' }),
    ]);
    assert.deepEqual(result.summary.currencyCodes, ['EUR', 'USD', 'ZWG', 'UNKNOWN']);
    const byCode = Object.fromEntries(
      result.currencies.map((c) => [c.currency, c.totals.turnover]),
    );
    assert.deepEqual(byCode, { EUR: '1', USD: '15', ZWG: '100', UNKNOWN: '7' });
    assert.equal(result.summary.unknownCurrencyLineCount, 1);
    // The result carries no cross-currency grand total anywhere.
    assert.equal('totals' in result, false);
    assert.equal('turnover' in result.summary, false);
    // Product groups stay inside their currency.
    for (const entry of result.currencies) {
      assert.equal(entry.products.length, 1);
      assert.equal(entry.products[0].totals.turnover, entry.totals.turnover);
    }
    assert.equal(result.reconciliation.ok, true);
  });

  it('keeps returns (negative lines) out when ineligible and nets them only when eligible', () => {
    const excluded = aggregateFinancials([
      line({ turnover: '10' }),
      ineligible('NEGATIVE_SALE', { quantity: '-1', turnover: '-10' }),
    ]);
    assert.equal(usd(excluded).totals.turnover, '10');
    assert.equal(excluded.summary.excludedReasonCounts.NEGATIVE_SALE, 1);

    // If the owner later decides returns are netted, the engine sums signs exactly.
    const netted = aggregateFinancials([
      line({ quantity: '2', turnover: '20.10' }),
      line({ quantity: '-1', turnover: '-10.05' }),
    ]);
    assert.equal(usd(netted).totals.turnover, '10.05');
    assert.equal(usd(netted).totals.quantity, '1');
    assert.equal(netted.reconciliation.ok, true);
  });

  it('is exact with fractional, tiny and very large values (no rounding)', () => {
    const result = aggregateFinancials([
      line({ quantity: '0.333', turnover: '0.1', amounts: { tax: '0.0000001' } }),
      line({ quantity: '0.667', turnover: '0.2', amounts: { tax: '0.0000002' } }),
      line({ quantity: '1', turnover: '99999999999999999999.99', amounts: { tax: '0' } }),
    ]);
    assert.equal(usd(result).totals.quantity, '2');
    assert.equal(usd(result).totals.turnover, '100000000000000000000.29');
    assert.equal(usd(result).totals.tax, '0.0000003');
    assert.equal(result.reconciliation.ok, true);
  });

  it('does not treat a missing tax as zero', () => {
    const result = aggregateFinancials([
      line({ amounts: { tax: '2' } }),
      line({ amounts: { tax: null } }),
      line({ amounts: {} }),
    ]);
    assert.equal(usd(result).totals.tax, '2');
    assert.equal(usd(result).totals.taxLineCount, 1);
    assert.equal(usd(result).totals.taxMissingLineCount, 2);
  });

  it('keeps zero-turnover lines counted', () => {
    const result = aggregateFinancials([line({ turnover: '0' }), line({ turnover: '3' })]);
    assert.equal(usd(result).totals.lineCount, 2);
    assert.equal(usd(result).totals.turnover, '3');
  });

  it('excludes, visibly, eligible lines it cannot aggregate instead of guessing', () => {
    const result = aggregateFinancials([
      line({ turnover: '1' }),
      line({ quantity: null }),
      line({ quantity: 'abc' }),
      line({ turnover: 5 }),
      line({ turnover: null }),
      line({ productId: null }),
      line({ nodeId: '' }),
    ]);
    assert.equal(usd(result).totals.lineCount, 1);
    assert.deepEqual(result.summary.excludedReasonCounts, {
      [AGGREGATION_EXCLUSIONS.AGGREGATION_NODE_MISSING]: 1,
      [AGGREGATION_EXCLUSIONS.AGGREGATION_PRODUCT_MISSING]: 1,
      [AGGREGATION_EXCLUSIONS.AGGREGATION_QUANTITY_INVALID]: 2,
      [AGGREGATION_EXCLUSIONS.AGGREGATION_TURNOVER_INVALID]: 2,
    });
    assert.equal(result.summary.eligibleLineCount + result.summary.excludedLineCount, 7);
  });

  it('throws on lines that were never classified or evaluated (no silent defaults)', () => {
    assert.throws(() => aggregateFinancials('x'), TypeError);
    assert.throws(() => aggregateFinancials([null]), TypeError);
    assert.throws(() => aggregateFinancials([line({ currency: undefined })]), /currency/);
    assert.throws(() => aggregateFinancials([line({ currency: 'usd' })]), /currency/);
    assert.throws(() => aggregateFinancials([line({ eligibility: undefined })]), /eligibility/);
    assert.throws(
      () => aggregateFinancials([line({ eligibility: { eligible: 'yes', reasons: [] } })]),
      /eligibility/,
    );
  });

  it('is deterministic: input order and repetition do not change the result', () => {
    const lines = [
      line({
        sourceLineKey: 'A',
        productId: 'p2',
        productName: 'Zed',
        nodeId: 'n2',
        turnover: '0.1',
      }),
      line({ sourceLineKey: 'B', productId: 'p1', productName: 'Beta', turnover: '0.2' }),
      line({
        sourceLineKey: 'C',
        productId: 'p2',
        productName: 'Alpha',
        nodeId: 'n2',
        turnover: '0.7',
      }),
      line({ sourceLineKey: 'D', currency: 'ZWG', turnover: '3' }),
      ineligible('STATUS_CANCELED'),
    ];
    const first = aggregateFinancials(lines);
    const reversed = aggregateFinancials([...lines].reverse());
    const shuffled = aggregateFinancials([lines[2], lines[4], lines[0], lines[3], lines[1]]);
    assert.deepEqual(reversed, first);
    assert.deepEqual(shuffled, first);
    assert.deepEqual(aggregateFinancials(lines), first);
    assert.equal(JSON.stringify(reversed), JSON.stringify(first));
    // Conflicting names resolve to the smallest, regardless of order.
    assert.equal(usd(first).products.find((p) => p.productId === 'p2').productName, 'Alpha');
  });

  it('does not mutate its input', () => {
    const lines = [line(), ineligible('NEGATIVE_SALE')];
    const before = JSON.stringify(lines);
    aggregateFinancials(lines, { departmentsByProductId: { p1: ['d1'] } });
    assert.equal(JSON.stringify(lines), before);
  });
});

describe('departments', () => {
  const lines = [
    line({ productId: 'p1', turnover: '10' }),
    line({ productId: 'p2', productName: 'P2', turnover: '20' }),
    line({ productId: 'p3', productName: 'P3', turnover: '5' }),
  ];

  it('groups mapped products and reports unmapped ones separately', () => {
    const result = aggregateFinancials(lines, {
      departmentsByProductId: new Map([
        ['p1', ['d1']],
        ['p2', ['d1', 'd2']],
      ]),
      departmentNames: { d1: 'Burgers', d2: 'Combos' },
    });
    const entry = usd(result);
    assert.deepEqual(
      entry.departments.map((d) => [
        d.departmentId,
        d.departmentName,
        d.totals.turnover,
        d.productIds,
      ]),
      [
        ['d1', 'Burgers', '30', ['p1', 'p2']],
        ['d2', 'Combos', '20', ['p2']],
      ],
    );
    assert.deepEqual(entry.unmappedDepartment.productIds, ['p3']);
    assert.equal(entry.unmappedDepartment.totals.turnover, '5');
    // Overlap is expected: department totals are not additive, products are.
    assert.equal(entry.totals.turnover, '35');
    assert.equal(result.reconciliation.ok, true);
  });

  it('puts everything in unmappedDepartment with no mapping, and null when all are mapped', () => {
    const none = aggregateFinancials(lines);
    assert.deepEqual(usd(none).departments, []);
    assert.equal(usd(none).unmappedDepartment.totals.turnover, '35');
    const all = aggregateFinancials(lines, {
      departmentsByProductId: { p1: ['d1'], p2: ['d1'], p3: ['d2'] },
    });
    assert.equal(usd(all).unmappedDepartment, null);
  });

  it('ignores blank or malformed department entries and rejects a bad mapping type', () => {
    const result = aggregateFinancials(lines, {
      departmentsByProductId: { p1: ['', null, 'd1', 'd1'], p2: 'd1', p3: [] },
    });
    assert.deepEqual(
      usd(result).departments.map((d) => d.departmentId),
      ['d1'],
    );
    assert.deepEqual(usd(result).unmappedDepartment.productIds, ['p2', 'p3']);
    assert.throws(() => aggregateFinancials(lines, { departmentsByProductId: [] }), TypeError);
    assert.throws(() => aggregateFinancials(lines, { departmentNames: 'x' }), TypeError);
  });

  it('keeps mappings inside their own currency', () => {
    const result = aggregateFinancials(
      [line({ currency: 'USD', turnover: '10' }), line({ currency: 'ZWG', turnover: '270' })],
      { departmentsByProductId: { p1: ['d1'] } },
    );
    for (const entry of result.currencies) {
      assert.equal(entry.departments[0].totals.turnover, entry.totals.turnover);
    }
    assert.deepEqual(
      result.currencies.map((c) => c.departments[0].totals.turnover),
      ['10', '270'], // currencies sort alphabetically: USD before ZWG
    );
  });
});

describe('reconciliation', () => {
  const base = () =>
    aggregateFinancials([
      line({ turnover: '1.1' }),
      line({ productId: 'p2', nodeId: 'n2', turnover: '2.2' }),
    ]);

  it('passes on unmodified output', () => {
    assert.deepEqual(verifyReconciliation(base()), { ok: true, mismatches: [] });
  });

  it('detects a tampered product total, node total, cell, department and line count', () => {
    const tampered = base();
    tampered.currencies[0].products[0].totals.turnover = '9';
    tampered.currencies[0].nodes[1].totals.quantity = '7';
    tampered.currencies[0].productNodes[0].totals.tax = '1';
    const result = verifyReconciliation(tampered);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.mismatches.map((m) => `${m.check}:${m.field}`).sort(),
      // The unmapped bucket is built from the same (tampered) product, so it disagrees too.
      ['nodes:quantity', 'product-nodes:tax', 'products:turnover', 'unmapped-department:turnover'],
    );

    const lineTampered = base();
    lineTampered.summary.eligibleLineCount = 5;
    assert.equal(verifyReconciliation(lineTampered).mismatches[0].check, 'eligible-lines');

    const departments = aggregateFinancials([line()], { departmentsByProductId: { p1: ['d1'] } });
    departments.currencies[0].departments[0].totals.turnover = '99';
    assert.equal(verifyReconciliation(departments).mismatches[0].check, 'department:d1');
  });

  it('detects a repeated currency bucket', () => {
    const result = base();
    result.currencies.push(structuredClone(result.currencies[0]));
    assert.ok(verifyReconciliation(result).mismatches.some((m) => m.check === 'currency-unique'));
  });
});

describe('aggregateNormalizedLines (Feature 15 -> 16 -> 17 -> 18, FIXTURE data)', () => {
  const sales = [
    fixtureRawSale('S1', [
      fixtureRawLine('L1', { qty: 2, priceIncl: 4.6 }),
      fixtureRawLine('L2', {
        product: { _id: 'prod-2', name: 'FIXTURE Fries' },
        qty: 1,
        priceIncl: 2.3,
        tax: 0.3,
      }),
    ]),
    fixtureRawSale('S2', [fixtureRawLine('L1', { qty: 1, priceIncl: 4.6 })], {
      nodeId: 'node-b',
      node: 'FIXTURE Store B',
      forex: fixtureForex('ZWG', 'USD'),
    }),
    fixtureRawSale('S3', [fixtureRawLine('L1', { qty: 1, priceIncl: 7 })], {
      forex: fixtureForex('ZWG', undefined),
    }),
    fixtureRawSale('S4', [fixtureRawLine('L1')], { status: 'CANCELED' }),
    fixtureRawSale('S5', [fixtureRawLine('L1', { qty: -1, priceIncl: 4.6 })], { isNegative: true }),
  ];

  it('totals per currency, keeps UNKNOWN apart and excludes canceled and negative sales', () => {
    const { lines } = normalizeSalesLines(sales);
    const result = aggregateNormalizedLines(lines);
    assert.deepEqual(result.summary.currencyCodes, ['USD', 'UNKNOWN']);
    const usdEntry = usd(result);
    const unknown = result.currencies.find((c) => c.currency === 'UNKNOWN');
    // S1 (2 lines) + S2 (base-denominated USD, ZWG selected): 9.2 + 2.3 + 4.6
    assert.equal(usdEntry.totals.turnover, '16.1');
    assert.equal(usdEntry.totals.quantity, '4');
    assert.equal(usdEntry.totals.lineCount, 3);
    assert.deepEqual(
      usdEntry.nodes.map((n) => [n.nodeId, n.totals.turnover]),
      [
        ['node-a', '11.5'],
        ['node-b', '4.6'],
      ],
    );
    assert.equal(unknown.totals.turnover, '7');
    assert.equal(result.summary.excludedReasonCounts.STATUS_CANCELED, 1);
    assert.equal(result.summary.excludedReasonCounts.NEGATIVE_SALE, 1);
    assert.equal(result.reconciliation.ok, true);
  });

  it('supports the strict currency policy, moving differing pairs to UNKNOWN', () => {
    const { lines } = normalizeSalesLines(sales);
    const result = aggregateNormalizedLines(lines, { differingPolicy: 'unknown' });
    assert.equal(usd(result).totals.turnover, '11.5');
    assert.equal(result.currencies.find((c) => c.currency === 'UNKNOWN').totals.turnover, '11.6');
  });

  it('gives the same result for any order of sales', () => {
    const forward = aggregateNormalizedLines(normalizeSalesLines(sales).lines);
    const backward = aggregateNormalizedLines(normalizeSalesLines([...sales].reverse()).lines);
    assert.deepEqual(backward, forward);
  });
});
