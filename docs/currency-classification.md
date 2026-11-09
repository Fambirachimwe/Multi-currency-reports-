# Currency Classification (Feature 16)

Code: `backend/src/modules/gaap/currency.resolver.js` (`resolveCurrency`, `classifyLineCurrencies`).
Input: the `currencySource` carried by Feature 15 lines. Output: `currency` (3-letter code or `UNKNOWN`)
and `currencyResolution` on each line. Pure; no conversion, no money arithmetic, not wired to a route.

## Live verification (read-only, 2026-11-08; one tenant, one day, 200 TENDERED sales)

- Every sale has `forex.selectedCurrency.currency` and `forex.baseCurrency.currency`, plus
  `forex.forexRates[]` and per-currency rate fields. Pairs seen: USD/USD 185, ZWG(selected)/USD(base) 15.
- In the 15 ZWG-selected sales, `priceIncl` for the 5 products also sold in USD-selected sales was
  identical to the USD price (3.5, 1, 0.5, 1.25, 3), although the ZWG rate was about 26.7 per base unit.
  Conclusion: line amounts are in the **base** currency; the selected currency is what the customer
  tendered in. Nothing was converted into the selected currency.
- Node `baseCurrency` was `USD` or `ZWL` in Feature 07. **Owner decision (2026-11-08): ZWL and ZWG are the same currency**, so `ZWL` resolves to `ZWG` (the only alias; the raw code stays in `currencySource` and `aliasedFrom` lists the replaced codes).
- **Payments (read-only, same 200 sales):** `payments[]` has only `amount`, `actualTender`, `tip`, `changeGiven`, `name`, `paymentMethodId`; **no currency field**. `amount` equals `totals.turnover` on all 197 single-payment sales (182 USD-selected, 15 ZWG-selected), and `actualTender` equals `amount` on all 15 ZWG-selected ones, so payments are in the same base units and carry no tender currency. Method names are free text ("Back Up Swipe machine ZWG", and "Rand" on a USD-selected sale), so they are NOT used to infer currency. Payments are not read by the resolver.

## Rules

| selected / base                                          | Result                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| equal valid codes                                        | that code, basis `SELECTED_EQUALS_BASE`                          |
| differ (default policy `base`)                           | the base code, basis `BASE_WHEN_SELECTED_DIFFERS`                |
| differ (policy `unknown`)                                | `UNKNOWN`, reason `CURRENCY_BASIS_UNCONFIRMED`                   |
| either missing/blank                                     | `UNKNOWN`, `SELECTED_CURRENCY_MISSING` / `BASE_CURRENCY_MISSING` |
| either not a 3-letter code (incl. the literal `UNKNOWN`) | `UNKNOWN`, `SELECTED_CURRENCY_INVALID` / `BASE_CURRENCY_INVALID` |

Codes are trimmed and upper-cased, then `ZWL` becomes `ZWG`. There is no fallback from one field to the other and no USD default.
`classifyLineCurrencies` keeps every line (UNKNOWN stays visible with its reason) and returns only line
counts per currency; it never reads or sums `turnover`, so currencies cannot be combined.

## Owner confirmation needed (not assumed)

1. ~~Amounts are in the base currency when the selected currency differs~~: **confirmed by the owner (2026-11-08)**.
2. Open: whether reports should only show such sales under the base currency (current behaviour) or also surface the tendered currency as extra information.

Tests are fixture-only (`fixtures/sales-lines.fixture.js`); the live evidence is the manual probe above.
