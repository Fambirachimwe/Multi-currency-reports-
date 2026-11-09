/** Currencies that always get a section, even when the saved report holds no lines in them. */
export const FIXED_CURRENCIES = Object.freeze(['USD', 'ZWG']);
export const UNKNOWN_CURRENCY = 'UNKNOWN';

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** USD, ZWG, then other currencies alphabetically, UNKNOWN last. */
export function compareCurrencies(a, b) {
  const rank = (code) => {
    if (code === UNKNOWN_CURRENCY) return 3;
    const fixed = FIXED_CURRENCIES.indexOf(code);
    return fixed === -1 ? 2 : fixed;
  };
  return rank(a) - rank(b) || byText(a, b);
}

/**
 * One section per currency from the saved totals and groups. Nothing is recalculated or merged:
 * `totals` is the saved total for that currency (null when the report has no lines in it) and the
 * groups are the saved product/node groups of that currency only. USD and ZWG always appear;
 * additional currencies appear when the report has them; UNKNOWN appears only when present.
 * @param {Array<{ currency: string }>} totals
 * @param {{ products?: Array<{ currency: string }>, nodes?: Array<{ currency: string }> }} summary
 */
export function buildCurrencySections(totals = [], summary = {}) {
  const codes = new Set(FIXED_CURRENCIES);
  for (const total of totals) codes.add(total.currency);
  return [...codes].sort(compareCurrencies).map((currency) => ({
    currency,
    totals: totals.find((total) => total.currency === currency) ?? null,
    products: (summary.products ?? []).filter((group) => group.currency === currency),
    nodes: (summary.nodes ?? []).filter((group) => group.currency === currency),
  }));
}

/** The sections to show for a filter (`'all'` or one currency code); never changes a section's data. */
export function filterCurrencySections(sections, filter) {
  return filter === 'all' ? sections : sections.filter((section) => section.currency === filter);
}
