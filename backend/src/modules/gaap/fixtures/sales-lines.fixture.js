/**
 * FIXTURE: hand-written GAAP `GET /sales` records in the full live shape (field paths observed
 * 2026-11-08), for sales-line normalization tests. All ids, names, numbers and invoice numbers are
 * invented; customer, payment and staff fields are deliberately absent. Passing against these
 * proves the mapping logic, not GAAP's behaviour. Where a scenario was NOT seen live (discounts,
 * priced add-ons) the builder says so.
 */

/**
 * One `items[]` entry. Defaults: 1 x 4.60 inclusive of 0.60 tax, no discount (observed shape).
 * `turnover` follows the live relation `lineTotals.turnover === priceIncl * qty`.
 */
export function fixtureRawLine(lineId, overrides = {}) {
  const { turnover, tax, ...rest } = overrides;
  const qty = rest.qty ?? 1;
  const priceIncl = rest.priceIncl ?? 4.6;
  return {
    lineId,
    product: { _id: 'prod-1', name: 'FIXTURE Chicken Burger' },
    qty,
    priceIncl,
    priceExcl: 4,
    discountAmount: 0,
    discountPercentage: 0,
    promoDiscountAmount: 0,
    addOnsPriceIncl: 0,
    addOnsDiscountAmount: 0,
    addOns: [],
    activePromotion: { discountAmount: 0 },
    lineTotals: {
      turnover: turnover ?? priceIncl * qty,
      tax: tax ?? 0.6 * qty,
      nonTurnover: 0,
    },
    ...rest,
  };
}

/** A sale with the given items. Defaults to a TENDERED USD sale at one node. */
export function fixtureRawSale(id, items, overrides = {}) {
  return {
    _id: id,
    invoiceNumber: `FIXTURE-INV-${id}`,
    orderNumber: `FIXTURE-ORD-${id}`,
    createdDate: '2026-11-05T08:30:15.000Z',
    closedDate: '2026-11-05T08:35:02.000Z',
    nodeId: 'node-a',
    node: 'FIXTURE Store A',
    status: 'TENDERED',
    isNegative: false,
    forex: {
      selectedCurrency: { currency: 'USD' },
      baseCurrency: { currency: 'USD' },
    },
    items,
    ...overrides,
  };
}

/** Same shape with a selected currency that differs from the base currency (seen live: ZWG/USD). */
export function fixtureForex(selected, base) {
  return {
    selectedCurrency: selected === undefined ? undefined : { currency: selected },
    baseCurrency: base === undefined ? undefined : { currency: base },
  };
}
