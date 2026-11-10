/**
 * Currency classification (Feature 16): decides which currency a normalized sales line's money
 * amounts (`turnover`) are denominated in. Pure: no I/O, no arithmetic on money, no conversion.
 *
 * LIVE FINDING (read-only, 2026-11-08; one tenant, one day: 200 TENDERED sales, 185 USD/USD and
 * 15 ZWG-selected with USD base; counts and structure only):
 *  - Every sale carries `forex.selectedCurrency.currency` and `forex.baseCurrency.currency`, plus
 *    `forex.forexRates[]` and per-currency rate fields (`fromBaseToForeign`, `toBaseFromForeign`,
 *    custom variants, `difference`). The ZWG rate was about 26.7 per base unit.
 *  - In the 15 ZWG-selected sales the unit prices (`priceIncl`) of the 5 products that also sold in
 *    USD-selected sales were IDENTICAL to the USD sales (e.g. 3.5, 1, 0.5), not ~26.7x larger. So
 *    the line amounts are denominated in the BASE currency; `selectedCurrency` is the tender
 *    currency the customer chose. Nothing is converted by GAAP into the selected currency.
 *  - Therefore: selected === base -> that code is certain; selected !== base -> amounts are in the
 *    base currency (policy `base`, the default), recorded with its own basis code so reports can
 *    show it. This rests on that single day and is NOT owner-confirmed; policy `unknown` is the
 *    strict alternative that refuses to classify differing pairs.
 *
 * PAYMENTS (read-only, 2026-11-08, same 200 sales): `payments[]` entries have no currency field
 * (`amount`, `actualTender`, `tip`, `changeGiven`, `name`, `paymentMethodId` only). `payments[].amount`
 * equalled `totals.turnover` on all 197 single-payment sales, including the 15 ZWG-selected ones,
 * and `actualTender` equalled `amount` on those 15, so payments carry no tender currency and are in
 * the same base units. Payment `name` is free text ("... ZWG", "Rand") and is NOT used to infer currency.
 *
 * OWNER DECISION (2026-11-08): ZWL and ZWG are the same currency. The only alias is ZWL -> ZWG
 * (ZWG is canonical); the raw code stays in `currencySource` (Feature 15) and a code changed this
 * way is listed in `aliasedFrom`.
 *
 * Never defaults to USD, never falls back from one field to the other, never maps any other code,
 * and never converts.
 */

import { multiplyDecimalStrings } from './decimal-sum.js';

const CODE_ALIASES = Object.freeze({ ZWL: 'ZWG' });

export const CURRENCY_UNKNOWN = 'UNKNOWN';

export const CURRENCY_BASIS = Object.freeze({
  SELECTED_EQUALS_BASE: 'SELECTED_EQUALS_BASE',
  BASE_WHEN_SELECTED_DIFFERS: 'BASE_WHEN_SELECTED_DIFFERS',
  SELECTED_FROM_BASE_RATE: 'SELECTED_FROM_BASE_RATE',
});

export const CURRENCY_REASONS = Object.freeze({
  SELECTED_CURRENCY_MISSING: 'SELECTED_CURRENCY_MISSING',
  BASE_CURRENCY_MISSING: 'BASE_CURRENCY_MISSING',
  SELECTED_CURRENCY_INVALID: 'SELECTED_CURRENCY_INVALID',
  BASE_CURRENCY_INVALID: 'BASE_CURRENCY_INVALID',
  CURRENCY_BASIS_UNCONFIRMED: 'CURRENCY_BASIS_UNCONFIRMED',
  SELECTED_RATE_MISSING: 'SELECTED_RATE_MISSING',
});

export const DIFFERING_CURRENCY_POLICIES = Object.freeze({
  SELECTED: 'selected',
  BASE: 'base',
  UNKNOWN: 'unknown',
});

export const CURRENCY_RESOLVER_VERSION = 1;

const CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * @typedef {object} CurrencyResolution
 * @property {string} currency A 3-letter upper-case code, or `UNKNOWN`.
 * @property {boolean} resolved False exactly when `currency` is `UNKNOWN`.
 * @property {string | null} basis One of {@link CURRENCY_BASIS} when resolved, else null.
 * @property {string | null} reason One of {@link CURRENCY_REASONS} when unresolved, else null.
 * @property {string | null} selectedCurrency Normalized (trimmed, upper-case) code; null if absent or invalid.
 * @property {string | null} baseCurrency Same for the base code.
 * @property {string[]} aliasedFrom Raw codes replaced by an owner-approved alias (e.g. `ZWL`); usually empty.
 */

/**
 * Resolves the currency of a line's amounts from the raw codes carried by Feature 15.
 * @param {{ selectedCurrency?: unknown, baseCurrency?: unknown } | null | undefined} currencySource
 * @param {{ differingPolicy?: 'base' | 'unknown' }} [options] Default `base`.
 * @returns {CurrencyResolution}
 */
export function resolveCurrency(currencySource, options = {}) {
  const policy = options.differingPolicy ?? DIFFERING_CURRENCY_POLICIES.SELECTED;
  if (!Object.values(DIFFERING_CURRENCY_POLICIES).includes(policy)) {
    throw new TypeError('differingPolicy must be "selected", "base" or "unknown"');
  }

  const selected = readCode(currencySource?.selectedCurrency);
  const base = readCode(currencySource?.baseCurrency);
  const known = {
    selectedCurrency: selected.code,
    baseCurrency: base.code,
    aliasedFrom: [selected.aliasedFrom, base.aliasedFrom].filter((code) => code !== null),
  };

  // Both fields must be usable: a missing one is never filled in from the other.
  if (selected.problem !== null) {
    return unknown(
      selected.problem === 'missing'
        ? CURRENCY_REASONS.SELECTED_CURRENCY_MISSING
        : CURRENCY_REASONS.SELECTED_CURRENCY_INVALID,
      known,
    );
  }
  if (base.problem !== null) {
    return unknown(
      base.problem === 'missing'
        ? CURRENCY_REASONS.BASE_CURRENCY_MISSING
        : CURRENCY_REASONS.BASE_CURRENCY_INVALID,
      known,
    );
  }

  if (selected.code === base.code) {
    return resolved(base.code, CURRENCY_BASIS.SELECTED_EQUALS_BASE, known);
  }
  if (policy === DIFFERING_CURRENCY_POLICIES.SELECTED) {
    // Owner decision (2026-11-10): report in the SELECTED currency. Base turnover is multiplied by
    // the selected currency's `fromBaseToForeign` (from forexRates); without a usable rate nothing is guessed.
    const rate =
      typeof currencySource?.selectedRate === 'string' ? currencySource.selectedRate : null;
    // Owner decision (2026-11-10): no usable rate -> fall back to the base currency, unconverted.
    if (rate === null) {
      return resolved(base.code, CURRENCY_BASIS.BASE_WHEN_SELECTED_DIFFERS, known);
    }
    return { ...resolved(selected.code, CURRENCY_BASIS.SELECTED_FROM_BASE_RATE, known), rate };
  }
  if (policy === DIFFERING_CURRENCY_POLICIES.BASE) {
    return resolved(base.code, CURRENCY_BASIS.BASE_WHEN_SELECTED_DIFFERS, known);
  }
  return unknown(CURRENCY_REASONS.CURRENCY_BASIS_UNCONFIRMED, known);
}

/**
 * Adds `currency` and `currencyResolution` to every normalized line. Returns new objects (inputs
 * are not mutated), one per input line in the same order, and counts lines per currency. Counts are
 * line counts only: no money is read or summed here, so currencies cannot be mixed.
 * @param {import('./sales-line.normalizer.js').NormalizedSalesLine[]} lines
 * @param {{ differingPolicy?: 'base' | 'unknown' }} [options]
 * @returns {{ resolverVersion: number, lines: object[], summary: { lineCount: number,
 *   unknownCount: number, lineCountsByCurrency: Record<string, number>,
 *   reasonCounts: Record<string, number>, basisCounts: Record<string, number> } }}
 */
export function classifyLineCurrencies(lines, options = {}) {
  if (!Array.isArray(lines)) throw new TypeError('lines must be an array');
  const lineCountsByCurrency = {};
  const reasonCounts = {};
  const basisCounts = {};
  let unknownCount = 0;

  const classified = lines.map((line) => {
    const currencyResolution = resolveCurrency(line?.currencySource, options);
    const { currency } = currencyResolution;
    lineCountsByCurrency[currency] = (lineCountsByCurrency[currency] ?? 0) + 1;
    if (currencyResolution.resolved) {
      basisCounts[currencyResolution.basis] = (basisCounts[currencyResolution.basis] ?? 0) + 1;
    } else {
      unknownCount += 1;
      reasonCounts[currencyResolution.reason] = (reasonCounts[currencyResolution.reason] ?? 0) + 1;
    }
    if (currencyResolution.basis === CURRENCY_BASIS.SELECTED_FROM_BASE_RATE && line.turnover) {
      // Exact decimal product; the original base amount is kept alongside.
      return {
        ...line,
        baseTurnover: line.turnover,
        turnover: multiplyDecimalStrings(line.turnover, currencyResolution.rate),
        currency,
        currencyResolution,
      };
    }
    return { ...line, currency, currencyResolution };
  });

  return {
    resolverVersion: CURRENCY_RESOLVER_VERSION,
    lines: classified,
    summary: {
      lineCount: classified.length,
      unknownCount,
      lineCountsByCurrency,
      reasonCounts,
      basisCounts,
    },
  };
}

function readCode(value) {
  if (value === undefined || value === null)
    return { code: null, problem: 'missing', aliasedFrom: null };
  if (typeof value !== 'string') return { code: null, problem: 'invalid', aliasedFrom: null };
  const trimmed = value.trim();
  if (trimmed === '') return { code: null, problem: 'missing', aliasedFrom: null };
  const raw = trimmed.toUpperCase();
  // `UNKNOWN` is our own marker, never a source code; 3 letters also keeps it out.
  if (!CODE_PATTERN.test(raw)) return { code: null, problem: 'invalid', aliasedFrom: null };
  const code = CODE_ALIASES[raw] ?? raw;
  return { code, problem: null, aliasedFrom: code === raw ? null : raw };
}

function resolved(currency, basis, known) {
  return { currency, resolved: true, basis, reason: null, ...known };
}

function unknown(reason, known) {
  return { currency: CURRENCY_UNKNOWN, resolved: false, basis: null, reason, ...known };
}
