# Sales line normalization (Feature 15)

Normalization version: **2** (renamed `DISCOUNT_BASIS_UNVERIFIED` to `UNEXPECTED_DISCOUNT` after the owner decisions).

Code: `backend/src/modules/gaap/sales-line.normalizer.js` (`normalizeSalesLines`), `decimal-string.js`.
Tests: `sales-line.normalizer.test.js`, `decimal-string.test.js` (**fixture-only**, see
`fixtures/sales-lines.fixture.js`). Input is `fetchSales().sales` (Feature 14); output feeds currency
classification (16), eligibility (17) and aggregation (18). Pure: no I/O, no rounding, no arithmetic on money.

## Observed live (read-only, 2026-11-08; paths, types and counts only; nothing stored)

One tenant, one day (20261105): 200 TENDERED sales / 354 lines, and 6 `isNegative` sales / 8 lines.

| Question                                   | Observation                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line container                             | `items[]`; each has `lineId` (string, present and unique within the sale on every line), `product._id`, `product.name`, `qty` (number).                                                                                     |
| `itemPriceIncl`, `productId`, `product.id` | **Absent on lines** (sample.js reads `itemPriceIncl`). Not read.                                                                                                                                                            |
| `lineTotals.turnover`                      | Present on 354/354. Equals `priceIncl * qty` on 354/354. Per-sale sum equals `totals.turnover` on 206/206 sales.                                                                                                            |
| `productTotals.turnover`                   | Differs from `lineTotals.turnover` on 39 lines; its per-sale sum matched `totals.turnover` on only 146/200. **Not used.**                                                                                                   |
| `lineTotals.tax`                           | Present; per-sale sum equals `totals.tax` on 200/200. `turnover` is tax-inclusive in the sense that `turnover = priceIncl * qty` (`priceExcl * qty` matched on 0 lines).                                                    |
| Discount fields                            | `discountAmount`, `promoDiscountAmount`, `discountPercentage`, `activePromotion.discountAmount` exist but were **0 on every observed line**. Owner (2026-11-08): turnover is net of discounts and no discounts are applied. |
| Add-ons                                    | 184 lines had add-ons; `addOnsPriceIncl` was 0 on all of them. Whether priced add-ons are inside turnover is unknown.                                                                                                       |
| Quantity                                   | Numbers; one fractional value in 354; 0 or negative only on `isNegative` sales (8/8 lines), whose turnover was negative on 6/8.                                                                                             |
| Currency                                   | Sale-level `forex.selectedCurrency.currency` / `forex.baseCurrency.currency`. 185 sales USD/USD, 15 sales ZWG/USD. Lines carry no currency. **Which currency `turnover` is in is not known.**                               |
| Timestamps                                 | `createdDate`, `closedDate`: ISO 8601 strings (UTC instants).                                                                                                                                                               |

## Decision: `lineTotals.turnover` is the line value

It is the only line amount that is always present and reconciles to the sale total, so it is the reported
measure. **There is no fallback.** sample.js falls back to `itemPriceIncl * qty` (and `qty ?? 1`); those are not
confirmed GAAP rules, `itemPriceIncl` does not exist, and a derived value would be a silent monetary assumption.
A line without a usable `lineTotals.turnover` is flagged `MISSING_TURNOVER`/`INVALID_TURNOVER` and is unusable.
Fallback rules may be added only after the owner or GAAP confirms them.

## Output contract (`NormalizedSalesLine`)

One line per sale item, in input order; nothing is dropped, bad lines are flagged `usable: false`.

| Field                       | Source                                                          | Notes                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizationVersion`      | constant `1`                                                    | Bump on any mapping or rule change.                                                                                                          |
| `sourceLineKey`             | `<sale._id>/<item.lineId>`                                      | De-duplication key; null if an id is missing, contains `/`, or the key exceeds 200 chars (ReportRow limit). Position is never used as an id. |
| `source`                    | `saleId`, `lineId`, `lineIndex`, `invoiceNumber`, `orderNumber` | Raw references for tracing back to GAAP. `lineIndex` is traceability only.                                                                   |
| `transactionAt`, `closedAt` | `createdDate`, `closedDate`                                     | UTC ISO strings. Offset required (no timezone is guessed); impossible dates (02-30, 24:00) rejected.                                         |
| `nodeId`, `nodeName`        | `nodeId`, `node` (string)                                       |                                                                                                                                              |
| `productId`, `productName`  | `items[].product._id`, `.name`                                  | `_id` only, no fallback ids.                                                                                                                 |
| `quantity`, `turnover`      | `qty`, `lineTotals.turnover`                                    | **Decimal strings**, signed, source precision kept; null if missing/invalid. Never defaulted.                                                |
| `amounts`                   | tax, nonTurnover, unit prices, discount fields, add-on fields   | Decimal strings or null (absent stays null, not 0). Carried uninterpreted.                                                                   |
| `sale`                      | `status`, `isNegative`                                          | Raw flags for Feature 17. Not judged here.                                                                                                   |
| `currencySource`            | the two raw forex codes                                         | Exactly as sent. **Not a classification**; there is deliberately no `currency` field before Feature 16.                                      |
| `issues`, `usable`          |                                                                 | `usable` is false iff an `error` issue exists.                                                                                               |

Not stored: customer, payment, staff, location and activity data. Issues name the field and never echo values.

## Issues

Errors (line unusable): `NOT_AN_OBJECT`, `MISSING_SALE_ID`, `MISSING_LINE_ID`, `INVALID_SOURCE_ID`,
`DUPLICATE_SOURCE_LINE` (second and later occurrence of a key), `MISSING_NODE_ID`, `MISSING_PRODUCT_ID`,
`MISSING_TIMESTAMP`, `INVALID_TIMESTAMP`, `MISSING_QUANTITY`, `INVALID_QUANTITY`, `MISSING_TURNOVER`, `INVALID_TURNOVER`.

Warnings (line usable, flagged for later features): `ZERO_QUANTITY`, `NEGATIVE_QUANTITY`, `NEGATIVE_TURNOVER`,
`SIGN_MISMATCH` (quantity and turnover have opposite signs), `INVALID_AMOUNT` (an optional amount is present but
not a finite number), `INVALID_CLOSED_TIMESTAMP`, `UNEXPECTED_DISCOUNT` (any non-zero discount field),
`ADD_ON_PRICE_BASIS_UNVERIFIED` (non-zero `addOnsPriceIncl`), `CURRENCY_FIELD_MISSING`, `CURRENCY_FIELDS_DIFFER`
(selected and base differ, case-insensitively).

Sale-level (no line to attach to): `SALE_NOT_AN_OBJECT`, `SALE_ITEMS_MISSING` (errors), `SALE_HAS_NO_ITEMS` (warning).

Numbers are accepted only as finite JSON numbers. Strings, booleans, NaN and Infinity are `INVALID_*`, never coerced.

## Blockers / owner confirmation (unverified, not assumed)

1. ~~Tax-inclusive turnover~~ **Confirmed by the owner (2026-11-08):** turnover is tax-inclusive.
2. ~~Net of discounts~~ **Confirmed by the owner (2026-11-08):** turnover is net of discounts and no discounts are applied. A non-zero discount field is therefore flagged `UNEXPECTED_DISCOUNT` (never adjusted).
3. Are priced add-ons inside turnover? Only free add-ons were seen.
4. Which currency is turnover in when selected currency differs from base (15 of 200 sales were ZWG/USD)? Feature 16.
5. Meaning of negative/zero-quantity lines and of `CANCELED` sales: Feature 17 (flags are carried, nothing is excluded here).
6. Coverage: one tenant, one day. Other days, nodes, payment types and refunds are unexamined.

## Not wired

Normalization is not called by any route or by report generation, and nothing is persisted.
