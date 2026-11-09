# Financial aggregation (Feature 18)

Pure functions in `backend/src/modules/gaap/financial-aggregation.js` that total normalized sales lines
per currency, then per product, node and department. No I/O, no floating point, no rounding, no currency
conversion. Not wired to a route, report or export; nothing is persisted.

## Pipeline

`normalizeSalesLines` (15) -> `classifyLineCurrencies` (16) -> `applyEligibility` (17) -> `aggregateFinancials` (18).
`aggregateNormalizedLines(lines, { differingPolicy, departmentsByProductId, departmentNames })` runs 16, 17 and 18
in one call. `aggregateFinancials` itself throws a `TypeError` for a line with no `currency` or `eligibility`
(it never defaults either).

## Output

```
{ aggregationVersion, currencies: [ {
    currency,                       // 'USD', 'ZWG', ... ; 'UNKNOWN' last
    totals,                         // for that currency only
    products:     [{ productId, productName, totals }],
    nodes:        [{ nodeId, nodeName, totals }],
    productNodes: [{ productId, nodeId, totals }],
    departments:  [{ departmentId, departmentName, productIds, totals }],
    unmappedDepartment: null | { productIds, totals } } ],
  summary: { lineCount, eligibleLineCount, excludedLineCount, excludedReasonCounts,
             currencyCodes, unknownCurrencyLineCount },
  reconciliation: { ok, mismatches } }
```

`totals` = `{ lineCount, quantity, turnover, tax, taxLineCount, taxMissingLineCount }`, all exact decimal text.
There is deliberately **no total across currencies** anywhere in the result.

## Rules

- **Exact decimals.** Sums use scaled BigInt on decimal strings (`decimal-sum.js`); results are independent of
  input order and are never rounded. Rounding for display is a presentation decision, not made here.
- **Currency first.** One bucket per currency code; `UNKNOWN` is its own bucket, never merged.
- **Only eligible lines are summed.** Ineligible lines are counted in `excludedReasonCounts` by their Feature 17
  reason. An eligible line that cannot be aggregated (non-decimal quantity or turnover, missing product or node id)
  is excluded with a visible `AGGREGATION_*` reason, not guessed.
- **Turnover** is the Feature 15 line value (tax-inclusive, net of discounts, owner decision). **Tax** is
  `amounts.tax` and is summed only where present; a line without it is counted in `taxMissingLineCount`
  (absent is not 0), so tax is complete only when that count is 0.
- **Departments** are not on the line; they come from the optional `departmentsByProductId` mapping. A product
  can be in several departments, so department totals **overlap and must never be added together**. Products with
  no mapping go to `unmappedDepartment`.
- **Determinism.** Groups sorted by id (plain string order), currencies alphabetical with `UNKNOWN` last, a group
  name is the smallest non-empty name seen.

## Reconciliation (`verifyReconciliation`, also run on every result)

Per currency, products, nodes and product-node cells each sum to the currency total on line count, quantity,
turnover, tax and tax line count; each department equals the sum of its products; the unmapped bucket equals the
sum of its products; eligible lines across currencies equal `summary.eligibleLineCount`; no repeated currency.

## Blockers and owner confirmation (not assumed)

- Everything upstream still applies: refund/negative semantics (Feature 17) and whether UNKNOWN or base-denominated
  sales appear under their currency (Feature 16). Eligibility is not production-ready until the owner confirms.
- Resolved by the owner (2026-11-08): `quantity` stays on the currency-level totals (it sums units of different products, so read it as total items sold).
- The department mapping source is the Feature 09 catalog; no lookup is done here.
- Tax semantics (`lineTotals.tax` as the tax contained in turnover) are observed, not owner-confirmed.
