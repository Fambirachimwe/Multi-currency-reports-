# Report generation orchestration (Feature 20)

One lifecycle from a validated request to computed, persisted results. Code: `backend/src/modules/reports/`.

## Lifecycle

```
POST /api/v1/reports  (Feature 13 validation)
  -> startReport: rules check -> reserve runner slot -> create `pending` report -> 202 {reportId, status:'pending'}
  -> background job (bounded runner):
       fetch sales (Feature 14) -> keep selected products/nodes -> normalize (15) -> currency (16)
       -> eligibility (17) -> aggregate (18) -> reconcile -> save rows + totals -> `completed`
       any failure at any step                                                    -> `failed` (code + safe message)
GET /api/v1/reports/:reportId/status   pending | completed | failed, source timestamps, failure reason
```

Transitions are only `pending -> completed` and `pending -> failed`. A failed report is never reopened; generating again creates a new report id (the failed one stays as evidence).

## No partial success

A report is `completed` only if all of these hold; otherwise it is `failed`:

| Failure code | Cause |
| --- | --- |
| `SOURCE_INCOMPLETE` | GAAP extraction not complete (failed page, page cap, unusable record) |
| `SOURCE_DATA_INVALID` | a selected sales line (or sale record) could not be read: missing/invalid id, quantity, turnover, timestamp, node/product, or a duplicate source line |
| `SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE` / `SOURCE_REQUEST_REJECTED` | GAAP error; selection needs more GAAP queries than the cap |
| `RECONCILIATION_FAILED` | aggregation detail != summary, or saved rows != computed line count |
| `SNAPSHOT_SAVE_FAILED` | rows/totals could not be stored (rows written so far are deleted) |
| `GENERATION_TIMEOUT` / `GENERATION_INTERRUPTED` | per-report deadline hit / service stopping |
| `GENERATION_FAILED` | unexpected internal error (details are logged by class only, never stored) |

Stored messages are fixed strings or our own counts; no GAAP content, URLs or credentials. Lines that are *eligible-by-rule exclusions* (negative sale, CANCELED, non-turnover, ...) are not failures: they are excluded by the approved rules and counted in the job log (`excludedReasonCounts`). Only unreadable data fails a report, because silently omitting it would hide missing sales.

## Selection

A GAAP sale lists every product on it, so only lines whose product is selected **and** whose node is in the resolved node set count. A line with no product or node id cannot be ruled out and fails the report. GAAP filters nodes only by one `eq` query per product x node; when that exceeds `SALES_MAX_QUERIES` (200) the nodes are fetched per product and the exact resolved node set is applied locally. More than 200 products still fails with `SOURCE_REQUEST_REJECTED`.

## Cache decision

Sales are never cached in v1 (`loadSalesCachePolicy`), so both `use_cache` and `bypass_cache` read GAAP live. Provenance records `usedCache: false`, `cacheFreshness: 'not_applicable'`. Node/catalog freshness used to resolve the request is returned in the 202 `meta` (`nodeListFetchedAt`, `nodeListCacheFreshness`). Meaning of `cachePolicy` for reference data remains an owner question from Feature 13.

## Provenance stored (on the report)

`provenance.source`, `sourceStartedAt` (new field), `fetchedAt`, `usedCache`, `cacheFreshness`, `complete`; `startedAt`, `completedAt`/`failedAt`; `rowCount`; `calculationVersion` = `lines<N>.cur<N>.elig<N>.agg<N>` (+ `+unverified-rules` when the Feature 17 block was overridden).

## Bounded work (worker design)

HTTP never waits for GAAP. `createReportRunner` is an explicit in-process worker: `REPORT_MAX_CONCURRENT_RUNS` (1) running, `REPORT_MAX_QUEUED_RUNS` (5) waiting; more are refused before a report is created (503 `REPORT_QUEUE_FULL`). Each job has a hard deadline `REPORT_RUN_TIMEOUT_MS` (20 min) delivered as an AbortSignal. On shutdown, running jobs are aborted and queued ones are recorded `failed/GENERATION_INTERRUPTED`. Limits are per process; a separate Railway worker is the next step if volume needs it.

## Eligibility block

`getEligibilityReadiness()` is `productionReady: false` until the owner confirms the Feature 16/17 open rules. While `REPORT_REQUIRE_VERIFIED_RULES` is true (default) `startReport` refuses with 422 `ELIGIBILITY_RULES_UNVERIFIED` and creates nothing. Setting it to `false` is an explicit, recorded override.

## Not covered here

Department mapping (no source verified; rows carry no `departmentId`), per-line excluded detail (only counts are logged; the `Report` model has no field for them), snapshot read APIs, listing and Excel export (Features 21+). Rows are written before the report becomes `completed`; a process crash between those writes leaves a `pending` report with orphan rows (no sweeper exists yet).
