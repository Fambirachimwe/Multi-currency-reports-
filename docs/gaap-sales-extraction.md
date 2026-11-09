# GAAP sales extraction (Feature 14)

Adapter: `backend/src/modules/gaap/sales.adapter.js` (`createSalesAdapter` → `fetchSales`).
Tests: `sales.adapter.test.js` (scripted client, **fixture-only**).

## Observed live (read-only probe, 2026-11-08; one day, structure and counts only, nothing stored)

| Question       | Observation                                                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match`        | JSON array of `[path, op, value]`; `createdDate gte/lte "YYYYMMDD"`, `status eq`, `isNegative eq`, `items.product._id eq`, `nodeId eq` all accepted.                                                                                                                             |
| `limit`/`skip` | Honoured. Two consecutive pages of 20: 20 + 20 distinct `_id`, 0 overlap. `skip` past the end returns an empty `data`.                                                                                                                                                           |
| `sort`         | `[("createdDate","asc")]` ordered ascending; `desc` reversed it.                                                                                                                                                                                                                 |
| `totalRecords` | Equals the page size, not the match count. **Never used for completeness.** A page shorter than `limit` ends a query.                                                                                                                                                            |
| Stable ID      | Sale `_id` (unique string). Used for deduplication.                                                                                                                                                                                                                              |
| Date filter    | `20261105` returned sales from `2026-11-04T22:00:16Z` to `2026-11-05T21:59:28Z`; `20261104` ended `2026-11-04T21:59:55Z`. So GAAP reads the date as a **Harare (UTC+2) calendar day**, both bounds inclusive, matching the owner's reporting timezone. Checked for one day only. |
| Status         | Without a status filter a 300-sale sample held 298 `TENDERED` and 2 `CANCELED` (all `isNegative: false`), so the filter matters.                                                                                                                                                 |
| Latency        | Each page query took about 35 s. The client default timeout (`GAAP_TIMEOUT_MS`, 30 s) timed out three times; a 120 s timeout succeeded. **Set `GAAP_TIMEOUT_MS=120000` (or larger) for sales.**                                                                                  |
| `in` operator  | Accepted for `items.product._id` and `nodeId`; the node case returned only matching rows. Product exclusion was not proven, so it is **not used**.                                                                                                                               |

## Behaviour

- One GAAP query per selected product × node (`eq` only, the verified operator); results are merged and
  de-duplicated by `_id`, since one sale can contain several selected products. Query count is capped
  (`maxQueries`, default 200) and over-cap plans are refused before any GAAP call.
- Each query pages `limit` 500 / `skip` until a short or empty page, up to `maxPages` (200). An exact
  multiple of the page size therefore costs one extra empty page.
- A transient page failure (retryable `GaapError` or malformed body) is retried (`pageRetries`, default 1) on
  top of the client's own retries. A page that still fails stops that query (a skip gap cannot be bridged) and
  is recorded in `failures`.
- Records are re-checked against `TENDERED`, `isNegative === false`, node and product filters. Mismatches are
  excluded and counted in `excluded`, never summed.
- Result metadata: `complete`/`partial`, `incompleteReasons` (`PAGE_FAILED`, `PAGE_CAP_REACHED`,
  `UNUSABLE_RECORDS`), `failures`, `pages` (per-page skip/received/attempts), `pageCount`, `queryCount`,
  `receivedCount`, `duplicateCount`, `excluded`, `sourceStartedAt`, `fetchedAt`, `range`.
- **A result with `complete: false` must never be saved as a completed report** (invariant 12). Caller-initiated
  aborts throw rather than returning a partial result.
- Raw sale records are returned unmodified for the later normalization feature. They contain customer data and
  are never logged.

## Not verified / open

- Ordering stability under `skip` when several sales share a `createdDate` or when sales arrive during a scan;
  a reorder could skip or repeat a sale. Repeats are removed; a skipped sale cannot be detected.
- Date boundary seen for a single day only; behaviour across DST-free Harare days is assumed uniform.
- Product-filter `in` semantics, multi-key sort (`_id` tie-break) and the `CANCELED`/refund/`isNegative: true`
  population were not examined; negative sales are excluded by the server filter.
- Currency fields (`forex.baseCurrency`, `forex.selectedCurrency`, `lineTotals.turnover`) are untouched here.
- Not wired to a route or to report generation (Feature 13's execution is still gated).
