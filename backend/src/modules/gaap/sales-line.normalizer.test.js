import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureForex, fixtureRawLine, fixtureRawSale } from './fixtures/sales-lines.fixture.js';
import {
  ISSUE_CODES,
  SALE_ISSUE_CODES,
  SALES_LINE_NORMALIZATION_VERSION,
  normalizeSalesLines,
} from './sales-line.normalizer.js';

// All inputs are FIXTURE records (see fixtures/sales-lines.fixture.js). None of this is live GAAP
// evidence; the field mapping itself was observed live and is documented in the normalizer.

const codes = (line) => line.issues.map((issue) => issue.code).sort();
const one = (sale) => normalizeSalesLines([sale]).lines[0];

describe('field mapping and traceability', () => {
  it('maps a simple line and keeps every source reference', () => {
    const { lines, saleIssues, summary, normalizationVersion } = normalizeSalesLines([
      fixtureRawSale('s1', [fixtureRawLine('l1')]),
    ]);
    assert.equal(normalizationVersion, SALES_LINE_NORMALIZATION_VERSION);
    assert.deepEqual(saleIssues, []);
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.equal(line.normalizationVersion, SALES_LINE_NORMALIZATION_VERSION);
    assert.equal(line.sourceLineKey, 's1/l1');
    assert.deepEqual(line.source, {
      saleId: 's1',
      lineId: 'l1',
      lineIndex: 0,
      invoiceNumber: 'FIXTURE-INV-s1',
      orderNumber: 'FIXTURE-ORD-s1',
    });
    assert.equal(line.transactionAt, '2026-11-05T08:30:15.000Z');
    assert.equal(line.closedAt, '2026-11-05T08:35:02.000Z');
    assert.equal(line.nodeId, 'node-a');
    assert.equal(line.nodeName, 'FIXTURE Store A');
    assert.equal(line.productId, 'prod-1');
    assert.equal(line.productName, 'FIXTURE Chicken Burger');
    assert.equal(line.quantity, '1');
    assert.equal(line.turnover, '4.6');
    assert.deepEqual(line.sale, { status: 'TENDERED', isNegative: false });
    assert.deepEqual(line.currencySource, {
      selectedCurrency: 'USD',
      baseCurrency: 'USD',
      selectedRate: null,
    });
    assert.deepEqual(line.issues, []);
    assert.equal(line.usable, true);
    assert.deepEqual(summary, {
      saleCount: 1,
      lineCount: 1,
      usableCount: 1,
      unusableCount: 0,
      issueCounts: {},
    });
  });

  it('takes turnover from lineTotals.turnover and never from other fields', () => {
    const line = one(
      fixtureRawSale('s1', [
        fixtureRawLine('l1', {
          qty: 2,
          priceIncl: 10,
          turnover: 17.5, // deliberately not priceIncl * qty
          productTotals: { turnover: 999 },
          itemPriceIncl: 777, // sample.js field that does not exist on live lines
        }),
      ]),
    );
    assert.equal(line.turnover, '17.5');
  });

  it('does not copy customer, payment or staff data onto the line', () => {
    const sale = fixtureRawSale('s1', [fixtureRawLine('l1', { employee: { name: 'PII-NAME' } })], {
      customer: { name: 'PII-CUSTOMER', phone: 'PII-PHONE' },
      payments: [{ name: 'PII-CARD', amount: 4.6 }],
      owner: { id: 'u1', name: 'PII-OWNER' },
      onlineCustomer: { email: 'PII-EMAIL' },
    });
    const text = JSON.stringify(normalizeSalesLines([sale]));
    for (const pii of [
      'PII-NAME',
      'PII-CUSTOMER',
      'PII-PHONE',
      'PII-CARD',
      'PII-OWNER',
      'PII-EMAIL',
    ]) {
      assert.equal(text.includes(pii), false, `${pii} must not be carried`);
    }
  });

  it('does not mutate the raw input', () => {
    const sales = [fixtureRawSale('s1', [fixtureRawLine('l1')])];
    const before = JSON.stringify(sales);
    normalizeSalesLines(sales);
    assert.equal(JSON.stringify(sales), before);
  });

  it('returns an empty result for no sales', () => {
    const result = normalizeSalesLines([]);
    assert.deepEqual(result.lines, []);
    assert.deepEqual(result.saleIssues, []);
    assert.equal(result.summary.lineCount, 0);
  });

  it('rejects a non-array input', () => {
    for (const bad of [null, undefined, {}, 'x']) {
      assert.throws(() => normalizeSalesLines(bad), TypeError);
    }
  });
});

describe('multi-item transactions', () => {
  it('yields one line per item with stable keys and positions, products kept apart', () => {
    const sale = fixtureRawSale('s1', [
      fixtureRawLine('l1', { product: { _id: 'prod-1', name: 'A' } }),
      fixtureRawLine('l2', { product: { _id: 'prod-2', name: 'B' }, qty: 3, priceIncl: 2 }),
      fixtureRawLine('l3', { product: { _id: 'prod-1', name: 'A' }, qty: 2 }),
    ]);
    const { lines } = normalizeSalesLines([sale]);
    assert.deepEqual(
      lines.map((l) => [l.sourceLineKey, l.source.lineIndex, l.productId, l.quantity, l.turnover]),
      [
        ['s1/l1', 0, 'prod-1', '1', '4.6'],
        ['s1/l2', 1, 'prod-2', '3', '6'],
        ['s1/l3', 2, 'prod-1', '2', '9.2'],
      ],
    );
    assert.ok(lines.every((l) => l.usable));
  });

  it('keys depend on source ids, not on position, so reordering items keeps the keys', () => {
    const a = fixtureRawLine('l1');
    const b = fixtureRawLine('l2');
    const forward = normalizeSalesLines([fixtureRawSale('s1', [a, b])]).lines;
    const reversed = normalizeSalesLines([fixtureRawSale('s1', [b, a])]).lines;
    assert.deepEqual(
      forward.map((l) => l.sourceLineKey).sort(),
      reversed.map((l) => l.sourceLineKey).sort(),
    );
  });

  it('same lineId in different sales gives different keys', () => {
    const { lines } = normalizeSalesLines([
      fixtureRawSale('s1', [fixtureRawLine('l1')]),
      fixtureRawSale('s2', [fixtureRawLine('l1')]),
    ]);
    assert.deepEqual(
      lines.map((l) => l.sourceLineKey),
      ['s1/l1', 's2/l1'],
    );
    assert.ok(lines.every((l) => l.usable));
  });

  it('flags a repeated line so it cannot be counted twice', () => {
    const sale = fixtureRawSale('s1', [fixtureRawLine('l1'), fixtureRawLine('l1')]);
    const { lines, summary } = normalizeSalesLines([sale, sale]);
    assert.equal(lines.filter((l) => l.usable).length, 1);
    assert.equal(lines[0].usable, true);
    for (const dup of lines.slice(1)) {
      assert.deepEqual(codes(dup), [ISSUE_CODES.DUPLICATE_SOURCE_LINE]);
      assert.equal(dup.usable, false);
      assert.equal(dup.sourceLineKey, 's1/l1');
    }
    assert.equal(summary.issueCounts.DUPLICATE_SOURCE_LINE, 3);
  });
});

describe('taxes, discounts and non-turnover amounts', () => {
  it('carries tax and other amounts as uninterpreted decimal strings', () => {
    const line = one(
      fixtureRawSale('s1', [
        fixtureRawLine('l1', { qty: 2, priceIncl: 4.6, priceExcl: 4, turnover: 9.2, tax: 1.2 }),
      ]),
    );
    assert.equal(line.turnover, '9.2');
    assert.equal(line.amounts.tax, '1.2');
    assert.equal(line.amounts.unitPriceIncl, '4.6');
    assert.equal(line.amounts.unitPriceExcl, '4');
    assert.equal(line.amounts.nonTurnover, '0');
    assert.deepEqual(codes(line), []);
  });

  it('keeps zero tax distinct from missing tax', () => {
    const zero = one(fixtureRawSale('s1', [fixtureRawLine('l1', { tax: 0 })]));
    assert.equal(zero.amounts.tax, '0');

    const raw = fixtureRawLine('l2');
    delete raw.lineTotals.tax;
    const missing = one(fixtureRawSale('s2', [raw]));
    assert.equal(missing.amounts.tax, null);
    assert.equal(missing.usable, true);
  });

  it('flags an unexpected discount (owner: none are applied), without adjusting turnover', () => {
    // NOT seen live: no discounted line existed in the observed data.
    for (const field of [
      'discountAmount',
      'promoDiscountAmount',
      'discountPercentage',
      'addOnsDiscountAmount',
    ]) {
      const line = one(
        fixtureRawSale('s1', [
          fixtureRawLine('l1', { qty: 2, priceIncl: 10, turnover: 18, [field]: 2 }),
        ]),
      );
      assert.deepEqual(codes(line), [ISSUE_CODES.UNEXPECTED_DISCOUNT], field);
      assert.equal(line.turnover, '18', field);
      assert.equal(line.usable, true);
      assert.equal(line.amounts[field], '2');
    }
    const promo = one(
      fixtureRawSale('s1', [fixtureRawLine('l1', { activePromotion: { discountAmount: 1.5 } })]),
    );
    assert.deepEqual(codes(promo), [ISSUE_CODES.UNEXPECTED_DISCOUNT]);
    assert.equal(promo.amounts.activePromotionDiscountAmount, '1.5');
  });

  it('does not flag zero discounts', () => {
    assert.deepEqual(codes(one(fixtureRawSale('s1', [fixtureRawLine('l1')]))), []);
  });

  it('flags priced add-ons as an unverified basis (zero-priced add-ons are not flagged)', () => {
    const free = one(
      fixtureRawSale('s1', [fixtureRawLine('l1', { addOns: [{ name: 'Sauce', addOnItems: [] }] })]),
    );
    assert.deepEqual(codes(free), []);
    const priced = one(fixtureRawSale('s2', [fixtureRawLine('l1', { addOnsPriceIncl: 0.5 })]));
    assert.deepEqual(codes(priced), [ISSUE_CODES.ADD_ON_PRICE_BASIS_UNVERIFIED]);
    assert.equal(priced.usable, true);
  });

  it('flags a present but invalid optional amount and keeps the line usable', () => {
    const line = one(
      fixtureRawSale('s1', [fixtureRawLine('l1', { priceExcl: '4.00', discountAmount: NaN })]),
    );
    assert.deepEqual(codes(line), [ISSUE_CODES.INVALID_AMOUNT, ISSUE_CODES.INVALID_AMOUNT]);
    assert.deepEqual(line.issues.map((i) => i.field).sort(), ['discountAmount', 'unitPriceExcl']);
    assert.equal(line.amounts.unitPriceExcl, null);
    assert.equal(line.usable, true);
  });
});

describe('negative and sign handling', () => {
  it('keeps a negative line signed and flags it (eligibility is Feature 17)', () => {
    const line = one(
      fixtureRawSale(
        's1',
        [fixtureRawLine('l1', { qty: -1, priceIncl: -4.6, turnover: -4.6, tax: -0.6 })],
        {
          isNegative: true,
        },
      ),
    );
    assert.equal(line.quantity, '-1');
    assert.equal(line.turnover, '-4.6');
    assert.equal(line.amounts.tax, '-0.6');
    assert.deepEqual(codes(line), [ISSUE_CODES.NEGATIVE_QUANTITY, ISSUE_CODES.NEGATIVE_TURNOVER]);
    assert.deepEqual(line.sale, { status: 'TENDERED', isNegative: true });
    assert.equal(line.usable, true);
  });

  it('flags a zero quantity without defaulting it', () => {
    const line = one(fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 0, turnover: 0 })]));
    assert.equal(line.quantity, '0');
    assert.equal(line.turnover, '0');
    assert.deepEqual(codes(line), [ISSUE_CODES.ZERO_QUANTITY]);
  });

  it('flags opposite signs between quantity and turnover as ambiguous', () => {
    const a = one(fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 1, turnover: -4.6 })]));
    assert.deepEqual(codes(a), [ISSUE_CODES.NEGATIVE_TURNOVER, ISSUE_CODES.SIGN_MISMATCH]);
    const b = one(fixtureRawSale('s2', [fixtureRawLine('l1', { qty: -1, turnover: 4.6 })]));
    assert.deepEqual(codes(b), [ISSUE_CODES.NEGATIVE_QUANTITY, ISSUE_CODES.SIGN_MISMATCH]);
  });

  it('accepts fractional quantities (seen live) and keeps their precision', () => {
    const line = one(fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 0.25, turnover: 1.15 })]));
    assert.equal(line.quantity, '0.25');
    assert.deepEqual(codes(line), []);
  });

  it('passes raw sale status and negative flag through without judging them', () => {
    const line = one(fixtureRawSale('s1', [fixtureRawLine('l1')], { status: 'CANCELED' }));
    assert.deepEqual(line.sale, { status: 'CANCELED', isNegative: false });
    assert.equal(line.usable, true);
    const missing = one(
      fixtureRawSale('s2', [fixtureRawLine('l1')], { status: undefined, isNegative: 'no' }),
    );
    assert.deepEqual(missing.sale, { status: null, isNegative: null });
  });
});

describe('bad lines are flagged, never silently dropped', () => {
  const unusable = (sale, expected) => {
    const result = normalizeSalesLines([sale]);
    assert.equal(result.lines.length, 1, 'the line is still returned');
    const [line] = result.lines;
    assert.deepEqual(codes(line), expected);
    assert.equal(line.usable, false);
    assert.equal(result.summary.unusableCount, 1);
    return line;
  };

  it('missing or blank source ids', () => {
    const noLine = fixtureRawLine('l1');
    delete noLine.lineId;
    const a = unusable(fixtureRawSale('s1', [noLine]), [ISSUE_CODES.MISSING_LINE_ID]);
    assert.equal(a.sourceLineKey, null);
    assert.equal(a.source.lineIndex, 0);

    unusable(fixtureRawSale('s1', [fixtureRawLine('   ')]), [ISSUE_CODES.MISSING_LINE_ID]);
    unusable(fixtureRawSale('s1', [fixtureRawLine(42)]), [ISSUE_CODES.MISSING_LINE_ID]);

    const sale = fixtureRawSale('s1', [fixtureRawLine('l1')]);
    delete sale._id;
    const b = unusable(sale, [ISSUE_CODES.MISSING_SALE_ID]);
    assert.equal(b.sourceLineKey, null);
    assert.equal(b.source.saleId, null);
  });

  it('missing both ids reports both', () => {
    const sale = fixtureRawSale('', [fixtureRawLine('')]);
    unusable(sale, [ISSUE_CODES.MISSING_LINE_ID, ISSUE_CODES.MISSING_SALE_ID]);
  });

  it('ids that would make the key ambiguous or too long', () => {
    unusable(fixtureRawSale('s/1', [fixtureRawLine('l1')]), [ISSUE_CODES.INVALID_SOURCE_ID]);
    unusable(fixtureRawSale('s1', [fixtureRawLine('l/1')]), [ISSUE_CODES.INVALID_SOURCE_ID]);
    unusable(fixtureRawSale('s'.repeat(150), [fixtureRawLine('l'.repeat(60))]), [
      ISSUE_CODES.INVALID_SOURCE_ID,
    ]);
    const edge = one(fixtureRawSale('s'.repeat(100), [fixtureRawLine('l'.repeat(99))]));
    assert.equal(edge.sourceLineKey.length, 200);
    assert.equal(edge.usable, true);
  });

  it('missing node or product id', () => {
    unusable(fixtureRawSale('s1', [fixtureRawLine('l1')], { nodeId: undefined }), [
      ISSUE_CODES.MISSING_NODE_ID,
    ]);
    unusable(fixtureRawSale('s1', [fixtureRawLine('l1')], { nodeId: 7 }), [
      ISSUE_CODES.MISSING_NODE_ID,
    ]);
    unusable(fixtureRawSale('s1', [fixtureRawLine('l1', { product: { name: 'x' } })]), [
      ISSUE_CODES.MISSING_PRODUCT_ID,
    ]);
    unusable(fixtureRawSale('s1', [fixtureRawLine('l1', { product: null })]), [
      ISSUE_CODES.MISSING_PRODUCT_ID,
    ]);
    // productId / product.id are not the verified field and must not be used as a fallback
    unusable(
      fixtureRawSale('s1', [fixtureRawLine('l1', { product: { id: 'x' }, productId: 'y' })]),
      [ISSUE_CODES.MISSING_PRODUCT_ID],
    );
  });

  it('missing, non-numeric and non-finite quantities (never defaulted to 1 or 0)', () => {
    const missing = fixtureRawLine('l1');
    delete missing.qty;
    const line = unusable(fixtureRawSale('s1', [missing]), [ISSUE_CODES.MISSING_QUANTITY]);
    assert.equal(line.quantity, null);
    unusable(fixtureRawSale('s1', [fixtureRawLine('l1', { qty: null })]), [
      ISSUE_CODES.MISSING_QUANTITY,
    ]);
    for (const bad of ['2', '', true, NaN, Infinity, [], {}]) {
      // turnover/tax pinned so only the quantity is bad (the fixture derives them from qty)
      unusable(
        fixtureRawSale('s1', [fixtureRawLine('l1', { qty: bad, turnover: 4.6, tax: 0.6 })]),
        [ISSUE_CODES.INVALID_QUANTITY],
      );
    }
  });

  it('missing or invalid turnover is never derived from price x quantity', () => {
    const raw = fixtureRawLine('l1', { qty: 2, priceIncl: 5 });
    delete raw.lineTotals.turnover;
    const a = unusable(fixtureRawSale('s1', [raw]), [ISSUE_CODES.MISSING_TURNOVER]);
    assert.equal(a.turnover, null);

    const noTotals = fixtureRawLine('l1');
    delete noTotals.lineTotals;
    unusable(fixtureRawSale('s1', [noTotals]), [ISSUE_CODES.MISSING_TURNOVER]);

    for (const bad of ['10.00', '', false, NaN, -Infinity, {}]) {
      const line = fixtureRawLine('l1');
      line.lineTotals.turnover = bad;
      unusable(fixtureRawSale('s1', [line]), [ISSUE_CODES.INVALID_TURNOVER]);
    }
  });

  it('zero turnover stays zero and is distinguishable from missing', () => {
    const line = one(fixtureRawSale('s1', [fixtureRawLine('l1', { turnover: 0 })]));
    assert.equal(line.turnover, '0');
    assert.equal(line.usable, true);
  });

  it('missing and invalid timestamps (no timezone is assumed)', () => {
    unusable(fixtureRawSale('s1', [fixtureRawLine('l1')], { createdDate: undefined }), [
      ISSUE_CODES.MISSING_TIMESTAMP,
    ]);
    const bad = [
      '',
      'not a date',
      '2026-11-05', // date only
      '2026-11-05T08:30:15', // no offset: timezone would be guessed
      '2026-02-30T10:00:00Z', // Date would roll this into March
      '2026-13-01T10:00:00Z',
      '2026-11-05T24:00:00Z',
      '2026-11-05T10:60:00Z',
      '2026-11-05T10:00:00+25:00',
      20261105,
      {},
    ];
    for (const createdDate of bad) {
      const line = unusable(fixtureRawSale('s1', [fixtureRawLine('l1')], { createdDate }), [
        ISSUE_CODES.INVALID_TIMESTAMP,
      ]);
      assert.equal(line.transactionAt, null);
    }
  });

  it('normalizes offsets and fractional seconds to a UTC instant', () => {
    const plus2 = one(
      fixtureRawSale('s1', [fixtureRawLine('l1')], { createdDate: '2026-11-05T10:00:00+02:00' }),
    );
    assert.equal(plus2.transactionAt, '2026-11-05T08:00:00.000Z');
    const fraction = one(
      fixtureRawSale('s1', [fixtureRawLine('l1')], { createdDate: '2026-11-05T08:00:00.5Z' }),
    );
    assert.equal(fraction.transactionAt, '2026-11-05T08:00:00.500Z');
    const leap = one(
      fixtureRawSale('s1', [fixtureRawLine('l1')], { createdDate: '2028-02-29T00:00:00Z' }),
    );
    assert.equal(leap.transactionAt, '2028-02-29T00:00:00.000Z');
    assert.equal(leap.usable, true);
  });

  it('closedDate is optional; a bad one is only a warning', () => {
    const none = one(fixtureRawSale('s1', [fixtureRawLine('l1')], { closedDate: undefined }));
    assert.equal(none.closedAt, null);
    assert.deepEqual(codes(none), []);
    const bad = one(fixtureRawSale('s1', [fixtureRawLine('l1')], { closedDate: 'soon' }));
    assert.equal(bad.closedAt, null);
    assert.deepEqual(codes(bad), [ISSUE_CODES.INVALID_CLOSED_TIMESTAMP]);
    assert.equal(bad.usable, true);
  });

  it('non-object items become flagged placeholders that keep their position', () => {
    const sale = fixtureRawSale('s1', [null, 'x', [], fixtureRawLine('l4')]);
    const { lines, summary } = normalizeSalesLines([sale]);
    assert.equal(lines.length, 4);
    assert.deepEqual(
      lines.map((l) => [l.source.lineIndex, l.usable]),
      [
        [0, false],
        [1, false],
        [2, false],
        [3, true],
      ],
    );
    for (const line of lines.slice(0, 3)) {
      assert.deepEqual(codes(line), [ISSUE_CODES.NOT_AN_OBJECT]);
      assert.equal(line.sourceLineKey, null);
      assert.equal(line.turnover, null);
    }
    assert.equal(summary.issueCounts.NOT_AN_OBJECT, 3);
  });

  it('reports sale-level problems that have no line', () => {
    const noItems = fixtureRawSale('s2', undefined);
    const emptyItems = fixtureRawSale('s3', []);
    const result = normalizeSalesLines([
      null,
      'x',
      noItems,
      emptyItems,
      fixtureRawSale('s4', [fixtureRawLine('l1')]),
    ]);
    assert.deepEqual(result.saleIssues, [
      { saleIndex: 0, saleId: null, code: SALE_ISSUE_CODES.SALE_NOT_AN_OBJECT, severity: 'error' },
      { saleIndex: 1, saleId: null, code: SALE_ISSUE_CODES.SALE_NOT_AN_OBJECT, severity: 'error' },
      { saleIndex: 2, saleId: 's2', code: SALE_ISSUE_CODES.SALE_ITEMS_MISSING, severity: 'error' },
      { saleIndex: 3, saleId: 's3', code: SALE_ISSUE_CODES.SALE_HAS_NO_ITEMS, severity: 'warning' },
    ]);
    assert.equal(result.lines.length, 1);
    assert.equal(result.summary.saleCount, 5);
    assert.equal(result.summary.issueCounts.SALE_NOT_AN_OBJECT, 2);
  });

  it('flags do not echo source values', () => {
    const sale = fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 'SECRET-QTY' })], {
      createdDate: 'SECRET-DATE',
    });
    assert.equal(JSON.stringify(normalizeSalesLines([sale])).includes('SECRET'), false);
  });
});

describe('currency fields are carried, not classified', () => {
  it('leaves both raw codes untouched and flags a difference without choosing one', () => {
    const line = one(
      fixtureRawSale('s1', [fixtureRawLine('l1')], { forex: fixtureForex('ZWG', 'USD') }),
    );
    assert.deepEqual(line.currencySource, {
      selectedCurrency: 'ZWG',
      baseCurrency: 'USD',
      selectedRate: null,
    });
    assert.deepEqual(codes(line), [ISSUE_CODES.CURRENCY_FIELDS_DIFFER]);
    assert.equal(line.usable, true);
    assert.equal('currency' in line, false, 'no resolved currency exists before Feature 16');
  });

  it('reads the selected currency rate from customToBaseFromForeign, not the market rate', () => {
    const forex = {
      ...fixtureForex('ZWG', 'USD'),
      forexRates: [
        { currency: 'USD', fromBaseToForeign: 1, customToBaseFromForeign: 1 },
        { currency: 'ZWG', fromBaseToForeign: 26.688, customToBaseFromForeign: 30 },
        { currency: 'ZAR', fromBaseToForeign: 16.390219, customToBaseFromForeign: 16 },
      ],
    };
    const line = one(fixtureRawSale('s1', [fixtureRawLine('l1')], { forex }));
    assert.equal(line.currencySource.selectedRate, '30');

    const noCustom = one(
      fixtureRawSale('s2', [fixtureRawLine('l1')], {
        forex: { ...forex, forexRates: [{ currency: 'ZWG', fromBaseToForeign: 26.688 }] },
      }),
    );
    assert.equal(noCustom.currencySource.selectedRate, null, 'no fallback to the market rate');
  });

  it('flags a missing currency field and never defaults it to USD', () => {
    const noSelected = one(
      fixtureRawSale('s1', [fixtureRawLine('l1')], { forex: fixtureForex(undefined, 'USD') }),
    );
    assert.deepEqual(noSelected.currencySource, {
      selectedCurrency: null,
      baseCurrency: 'USD',
      selectedRate: null,
    });
    assert.deepEqual(codes(noSelected), [ISSUE_CODES.CURRENCY_FIELD_MISSING]);

    const none = one(fixtureRawSale('s2', [fixtureRawLine('l1')], { forex: undefined }));
    assert.deepEqual(none.currencySource, {
      selectedCurrency: null,
      baseCurrency: null,
      selectedRate: null,
    });
    assert.deepEqual(codes(none), [
      ISSUE_CODES.CURRENCY_FIELD_MISSING,
      ISSUE_CODES.CURRENCY_FIELD_MISSING,
    ]);
    assert.equal(none.usable, true);
  });

  it('does not flag codes that differ only by case, and keeps the raw spelling', () => {
    const line = one(
      fixtureRawSale('s1', [fixtureRawLine('l1')], { forex: fixtureForex('usd', 'USD') }),
    );
    assert.deepEqual(codes(line), []);
    assert.equal(line.currencySource.selectedCurrency, 'usd');
  });

  it('never sums or converts: amounts of different currencies stay as separate strings', () => {
    const { lines } = normalizeSalesLines([
      fixtureRawSale('s1', [fixtureRawLine('l1', { turnover: 10 })], {
        forex: fixtureForex('USD', 'USD'),
      }),
      fixtureRawSale('s2', [fixtureRawLine('l1', { turnover: 250 })], {
        forex: fixtureForex('ZWG', 'USD'),
      }),
    ]);
    assert.deepEqual(
      lines.map((l) => [l.currencySource.selectedCurrency, l.turnover]),
      [
        ['USD', '10'],
        ['ZWG', '250'],
      ],
    );
  });
});

describe('determinism and precision', () => {
  it('gives identical output for identical input', () => {
    const sales = [
      fixtureRawSale('s1', [fixtureRawLine('l1'), fixtureRawLine('l2', { qty: 3 })]),
      fixtureRawSale('s2', [fixtureRawLine('l1', { qty: -1, turnover: -4.6 })]),
    ];
    assert.deepEqual(normalizeSalesLines(sales), normalizeSalesLines(structuredClone(sales)));
  });

  it('keeps source precision as text (no float artefacts, no exponent)', () => {
    const line = one(
      fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 3, turnover: 0.1 + 0.2, tax: 1e-7 })]),
    );
    assert.equal(line.turnover, '0.30000000000000004'); // source value preserved, not rounded
    assert.equal(line.amounts.tax, '0.0000001');
  });

  it('summarises issue counts per line once per code', () => {
    const { summary } = normalizeSalesLines([
      fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 0, turnover: 0 }), fixtureRawLine('l2')]),
      fixtureRawSale('s2', [fixtureRawLine('l1', { qty: null })], {
        forex: fixtureForex('ZWG', 'USD'),
      }),
    ]);
    assert.equal(summary.lineCount, 3);
    assert.equal(summary.usableCount, 2);
    assert.equal(summary.unusableCount, 1);
    assert.deepEqual(summary.issueCounts, {
      ZERO_QUANTITY: 1,
      MISSING_QUANTITY: 1,
      CURRENCY_FIELDS_DIFFER: 1,
    });
  });
});
