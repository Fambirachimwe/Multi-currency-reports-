import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURRENCY_BASIS,
  CURRENCY_REASONS,
  CURRENCY_UNKNOWN,
  classifyLineCurrencies,
  resolveCurrency,
} from './currency.resolver.js';
import { normalizeSalesLines } from './sales-line.normalizer.js';
import { fixtureForex, fixtureRawLine, fixtureRawSale } from './fixtures/sales-lines.fixture.js';

// FIXTURE-based: proves the resolution rules, not GAAP behaviour. The rule for differing pairs
// rests on one live day (see currency.resolver.js) and is not owner-confirmed.

const src = (selectedCurrency, baseCurrency) => ({ selectedCurrency, baseCurrency });

describe('resolveCurrency: matching selected and base', () => {
  it('classifies USD', () => {
    assert.deepEqual(resolveCurrency(src('USD', 'USD')), {
      currency: 'USD',
      resolved: true,
      basis: CURRENCY_BASIS.SELECTED_EQUALS_BASE,
      reason: null,
      selectedCurrency: 'USD',
      baseCurrency: 'USD',
      aliasedFrom: [],
    });
  });

  it('classifies ZWG', () => {
    const result = resolveCurrency(src('ZWG', 'ZWG'));
    assert.equal(result.currency, 'ZWG');
    assert.equal(result.resolved, true);
  });

  it('classifies additional currencies as sent', () => {
    for (const code of ['ZAR', 'GBP', 'BWP', 'EUR']) {
      const result = resolveCurrency(src(code, code));
      assert.equal(result.currency, code);
      assert.deepEqual(result.aliasedFrom, []);
    }
  });

  it('treats ZWL as ZWG (owner decision) and records the alias', () => {
    const legacy = resolveCurrency(src('ZWL', 'ZWL'));
    assert.equal(legacy.currency, 'ZWG');
    assert.equal(legacy.basis, CURRENCY_BASIS.SELECTED_EQUALS_BASE);
    assert.deepEqual(legacy.aliasedFrom, ['ZWL', 'ZWL']);
    assert.equal(resolveCurrency(src('zwl', 'ZWG')).currency, 'ZWG');
    assert.equal(resolveCurrency(src('ZWL', 'ZWG')).basis, CURRENCY_BASIS.SELECTED_EQUALS_BASE);
    const mixed = resolveCurrency(src('ZWL', 'USD'));
    assert.equal(mixed.currency, 'USD');
    assert.equal(mixed.selectedCurrency, 'ZWG');
  });

  it('applies no other alias', () => {
    assert.equal(resolveCurrency(src('XYZ', 'XYZ')).currency, 'XYZ');
    assert.equal(
      resolveCurrency(src('USD', 'ZAR')).basis,
      CURRENCY_BASIS.BASE_WHEN_SELECTED_DIFFERS,
    );
  });

  it('normalizes case and surrounding whitespace', () => {
    const result = resolveCurrency(src(' usd ', 'Usd'));
    assert.equal(result.currency, 'USD');
    assert.equal(result.selectedCurrency, 'USD');
  });
});

describe('resolveCurrency: selected differs from base', () => {
  it('uses the base currency by default (live: ZWG selected, USD base, USD-priced lines)', () => {
    const result = resolveCurrency(src('ZWG', 'USD'));
    assert.equal(result.currency, 'USD');
    assert.equal(result.basis, CURRENCY_BASIS.BASE_WHEN_SELECTED_DIFFERS);
    assert.equal(result.selectedCurrency, 'ZWG');
    assert.equal(result.baseCurrency, 'USD');
  });

  it('is UNKNOWN with a reason under the strict policy', () => {
    const result = resolveCurrency(src('ZWG', 'USD'), { differingPolicy: 'unknown' });
    assert.equal(result.currency, CURRENCY_UNKNOWN);
    assert.equal(result.resolved, false);
    assert.equal(result.basis, null);
    assert.equal(result.reason, CURRENCY_REASONS.CURRENCY_BASIS_UNCONFIRMED);
  });

  it('the strict policy does not affect matching pairs', () => {
    assert.equal(
      resolveCurrency(src('ZWG', 'ZWG'), { differingPolicy: 'unknown' }).currency,
      'ZWG',
    );
  });

  it('rejects an unsupported policy instead of guessing', () => {
    assert.throws(
      () => resolveCurrency(src('USD', 'USD'), { differingPolicy: 'bogus' }),
      TypeError,
    );
  });
});

describe('resolveCurrency: missing, invalid and conflicting metadata', () => {
  const cases = [
    ['selected missing', src(null, 'USD'), CURRENCY_REASONS.SELECTED_CURRENCY_MISSING],
    ['selected undefined', src(undefined, 'USD'), CURRENCY_REASONS.SELECTED_CURRENCY_MISSING],
    ['selected blank', src('  ', 'USD'), CURRENCY_REASONS.SELECTED_CURRENCY_MISSING],
    ['base missing', src('USD', null), CURRENCY_REASONS.BASE_CURRENCY_MISSING],
    ['base undefined', src('ZWG', undefined), CURRENCY_REASONS.BASE_CURRENCY_MISSING],
    ['selected too short', src('US', 'USD'), CURRENCY_REASONS.SELECTED_CURRENCY_INVALID],
    ['selected has digits', src('US1', 'USD'), CURRENCY_REASONS.SELECTED_CURRENCY_INVALID],
    ['selected not a string', src(840, 'USD'), CURRENCY_REASONS.SELECTED_CURRENCY_INVALID],
    [
      'selected object',
      src({ currency: 'USD' }, 'USD'),
      CURRENCY_REASONS.SELECTED_CURRENCY_INVALID,
    ],
    ['base too long', src('USD', 'USDX'), CURRENCY_REASONS.BASE_CURRENCY_INVALID],
    ['base is the UNKNOWN marker', src('USD', 'UNKNOWN'), CURRENCY_REASONS.BASE_CURRENCY_INVALID],
  ];
  for (const [name, source, reason] of cases) {
    it(`${name} -> UNKNOWN (${reason})`, () => {
      const result = resolveCurrency(source);
      assert.equal(result.currency, CURRENCY_UNKNOWN);
      assert.equal(result.resolved, false);
      assert.equal(result.reason, reason);
      assert.equal(result.basis, null);
    });
  }

  it('never falls back from one field to the other and never defaults to USD', () => {
    assert.equal(resolveCurrency(src(null, 'ZWG')).currency, CURRENCY_UNKNOWN);
    assert.equal(resolveCurrency(src('ZWG', null)).currency, CURRENCY_UNKNOWN);
    assert.equal(resolveCurrency(src(null, null)).currency, CURRENCY_UNKNOWN);
  });

  it('treats absent, null and non-object metadata as UNKNOWN', () => {
    for (const input of [undefined, null, {}, 'USD', 7, []]) {
      const result = resolveCurrency(input);
      assert.equal(result.currency, CURRENCY_UNKNOWN);
      assert.notEqual(result.reason, null);
    }
  });

  it('keeps the usable code visible next to an UNKNOWN result', () => {
    const result = resolveCurrency(src('ZWG', null));
    assert.equal(result.selectedCurrency, 'ZWG');
    assert.equal(result.baseCurrency, null);
  });
});

describe('classifyLineCurrencies', () => {
  function normalized(forexByLine) {
    const sales = forexByLine.map((forex, index) =>
      fixtureRawSale(`sale-${index}`, [fixtureRawLine('l1', { turnover: 10 + index })], { forex }),
    );
    return normalizeSalesLines(sales).lines;
  }

  it('classifies USD, ZWG, an extra currency and missing metadata side by side', () => {
    const lines = normalized([
      fixtureForex('USD', 'USD'),
      fixtureForex('ZWG', 'ZWG'),
      fixtureForex('ZAR', 'ZAR'),
      fixtureForex('ZWG', 'USD'),
      fixtureForex(undefined, undefined),
      undefined,
    ]);
    const result = classifyLineCurrencies(lines);

    assert.deepEqual(
      result.lines.map((line) => line.currency),
      ['USD', 'ZWG', 'ZAR', 'USD', CURRENCY_UNKNOWN, CURRENCY_UNKNOWN],
    );
    assert.deepEqual(result.summary.lineCountsByCurrency, { USD: 2, ZWG: 1, ZAR: 1, UNKNOWN: 2 });
    assert.equal(result.summary.unknownCount, 2);
    assert.equal(result.summary.lineCount, 6);
    assert.deepEqual(result.summary.reasonCounts, { SELECTED_CURRENCY_MISSING: 2 });
    assert.deepEqual(result.summary.basisCounts, {
      SELECTED_EQUALS_BASE: 3,
      BASE_WHEN_SELECTED_DIFFERS: 1,
    });
  });

  it('keeps UNKNOWN lines in the output (visible, never dropped) with their reason', () => {
    const [line] = classifyLineCurrencies(normalized([fixtureForex('USD', undefined)])).lines;
    assert.equal(line.currency, CURRENCY_UNKNOWN);
    assert.equal(line.currencyResolution.reason, CURRENCY_REASONS.BASE_CURRENCY_MISSING);
  });

  it('carries money through untouched and adds no totals (no cross-currency summing)', () => {
    const lines = normalized([fixtureForex('USD', 'USD'), fixtureForex('ZWG', 'ZWG')]);
    const result = classifyLineCurrencies(lines);

    assert.deepEqual(
      result.lines.map((line) => line.turnover),
      lines.map((line) => line.turnover),
    );
    assert.deepEqual(Object.keys(result).sort(), ['lines', 'resolverVersion', 'summary']);
    assert.deepEqual(Object.keys(result.summary).sort(), [
      'basisCounts',
      'lineCount',
      'lineCountsByCurrency',
      'reasonCounts',
      'unknownCount',
    ]);
    for (const value of Object.values(result.summary.lineCountsByCurrency)) {
      assert.ok(Number.isInteger(value));
    }
  });

  it('does not mutate the input lines', () => {
    const lines = normalized([fixtureForex('USD', 'USD')]);
    const snapshot = structuredClone(lines);
    classifyLineCurrencies(lines);
    assert.deepEqual(lines, snapshot);
    assert.equal('currency' in lines[0], false);
  });

  it('handles an empty list and rejects a non-array', () => {
    const result = classifyLineCurrencies([]);
    assert.deepEqual(result.lines, []);
    assert.equal(result.summary.lineCount, 0);
    assert.throws(() => classifyLineCurrencies(null), TypeError);
  });

  it('passes the strict policy through to every line', () => {
    const lines = normalized([fixtureForex('ZWG', 'USD'), fixtureForex('USD', 'USD')]);
    const result = classifyLineCurrencies(lines, { differingPolicy: 'unknown' });
    assert.deepEqual(
      result.lines.map((line) => line.currency),
      [CURRENCY_UNKNOWN, 'USD'],
    );
    assert.deepEqual(result.summary.reasonCounts, { CURRENCY_BASIS_UNCONFIRMED: 1 });
  });

  it('treats a line without currencySource as UNKNOWN', () => {
    const [line] = classifyLineCurrencies([{ turnover: '5' }]).lines;
    assert.equal(line.currency, CURRENCY_UNKNOWN);
  });
});

describe('selected currency conversion (owner decision 2026-11-11)', () => {
  it('converts base turnover to the selected currency: 222.51 x 30 = 6675.3', () => {
    const line = {
      turnover: '222.51',
      currencySource: { selectedCurrency: 'ZWG', baseCurrency: 'USD', selectedRate: '30' },
    };
    const [out] = classifyLineCurrencies([line]).lines;
    assert.equal(out.currency, 'ZWG');
    assert.equal(out.turnover, '6675.3');
    assert.equal(out.baseTurnover, '222.51');
  });

  it('falls back to the base currency, unconverted, when no usable rate exists', () => {
    const line = {
      turnover: '10',
      currencySource: { selectedCurrency: 'ZWG', baseCurrency: 'USD', selectedRate: null },
    };
    const [out] = classifyLineCurrencies([line]).lines;
    assert.equal(out.currency, 'USD');
    assert.equal(out.turnover, '10');
  });
});
