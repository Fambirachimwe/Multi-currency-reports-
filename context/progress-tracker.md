# Progress Tracker

Update this file after every meaningful implementation
change.

## Current Phase

- Features 09–20 approved by the user (2026-11-08). Feature 21 (Save Immutable Report Snapshot) approved by the user (2026-11-08); its open items and decisions are deferred to a clean-up pass once all feature specs are done. Feature 22 (Saved Reports List) approved by the user (2026-11-08). Feature 23 (Report Summary View) implemented 2026-11-08, awaiting approval. Feature 24 (Report Detail Table) approved by the user (2026-11-08).

## In Progress

- Render deployment (2026-11-09): added root `render.yaml` blueprint (backend web service + frontend static site, one repo, built from the root because of npm workspaces). Not yet deployed: the repo has no GitHub remote, and the secrets (`MONGODB_URI`, `GAAP_API_KEY`, `GAAP_API_BASE_URL`, `CORS_ORIGIN`, `VITE_API_BASE_URL`) must be set in the Render dashboard. Backend uses the `starter` plan because reports run in-process for up to 20 minutes. README "Railway deployment overview" replaced by a "Render deployment" section; `backend/.env.example` lists the production variables. Verified: root `npm run build` passes; no `.env`/`sample.js` tracked. Not run: an actual Render deploy.
- Feature 27 (Dashboard Wiring) is implemented (2026-11-09) and **awaiting approval**; next: Feature 28 spec after approval.
- Feature 26 (Excel Export from Saved Snapshot) is implemented (2026-11-08) and **awaiting approval**. Feature 25 (Currency Breakdown View) approved by the user (2026-11-08). Feature 24 (Report Detail Table) approved by the user (2026-11-08).
- Feature 23 (Report Summary View) is implemented and **awaiting approval**.
- Feature 22 (Saved Reports List) approved by the user (2026-11-08).
- Previously: Feature 21 approved (2026-11-08); the decisions and limitations listed under it are to be revisited after all feature specs are done.
- Previously: Feature 20 (Report Generation Orchestration) approved by the user (2026-11-08); the decisions listed under it were approved "for now" and remain open to revisit. Feature 29 was opened first and set aside: it depends on Features 21 and 26, which do not exist yet (Features 21–28 are unstarted), so it cannot be reconciled end to end until they are built.
- Earlier note: Feature 19 (Hybrid Cache Layer) approved by the user (2026-11-08); next feature awaiting its spec. Feature 18 (Financial Aggregation Engine) approved by the user (2026-11-08).
- Features 16 and 17 approved by the user (2026-11-08). Open owner items remain under each (differing-currency rule; other statuses, refund/negative semantics); Feature 17 stays `productionReady: false` until they are confirmed.

## Current Goal

- Obtain approval of Feature 16 and the owner answers listed under it, then await the next spec. Feature 15 owner questions are listed under it. Open items: owner to confirm whether a gated request should return no ID (current) or a persisted `pending` report, the report caps, `cachePolicy` values, the reporting timezone, GAAP `createdDate` boundary mapping, maximum range, and the brand definition (top-level node with children is assumed).

## Completed

### Feature 27: Dashboard Wiring — Implemented, awaiting approval (2026-11-09)

The dashboard no longer uses mock reports. Frontend-only change: it reads the existing `GET /api/v1/reports` and `GET /api/v1/reports/:id`; nothing calls GAAP.

**Files:** new `frontend/src/features/reports/use-dashboard.js`; rewritten `frontend/src/pages/dashboard-page.jsx` (no `MOCK_REPORTS`, no `DemoNotice`); `components/summary-cards.jsx` (comment only); `pages/pages.test.jsx` (`/` removed from the demo-label list, 5 new dashboard tests with a stubbed API labelled FIXTURE).

**Behaviour:** four list requests (newest 5; newest completed, limit 1; pending, limit 1; failed, limit 1) give the counts from `pagination.total` and the recent list; one detail request for the latest completed report gives its saved per-currency totals, shown with the existing per-currency cards (never combined). Latest report line shows id (link), date range, selection counts, generated time and source freshness (live / cached fresh|stale / incomplete), plus text that the totals describe that saved snapshot only, "not live or all-time sales". Recent reports link to details only when completed. States: loading skeleton; error with Try again (nothing shown as zero); empty ("No saved reports yet" with a Generate link, no totals request); a failed totals request keeps counts and recent list and shows its own error; completed report with no lines says so. Navigation: Generate Report, All saved reports, Browse products, report links.

**Verification (2026-11-09, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `npx vitest run` (in `frontend`) | 175/175 pass (dashboard tests: counts, per-currency cards, freshness, links, empty, error + retry, totals failure, cached label, navigation) |
| `npm run lint`, `prettier --check frontend/src`, `npm run build` | Pass (build chunk-size warning only) |

Acceptance: no demo values in production (page imports no mock; test asserts no `DEMO-`/`demo-rpt`/"Demo / mock" text); statistics labelled (saved snapshot only, not live or all-time; per-currency; freshness shown); navigation works (tests for report link, saved-reports link, route test for `/`).

**Follow-up (user request, 2026-11-09): Generate Report button connected.** This goes beyond the Feature 27 spec at the user's explicit request. New `features/reports/use-generate-report.js` (+ `.test.js`, 4 tests); `pages/generate-report-page.jsx` (button enabled, `NotConnectedButton` and the demo notice removed, status panel); `pages.test.jsx` (two obsolete "not connected" assertions replaced). The button validates the form, then `POST /reports` (body: dates, productIds, nodes by active mode, `cachePolicy: 'use_cache'`), and polls `GET /reports/:id/status` every 3 s; success is shown only when the server says `completed` (then a link to the saved report); `failed` and rejected starts show the server's reason. Verification: `npx vitest run` in `frontend` 178/178, lint, prettier, build pass. Not run: no live backend/browser. **Important:** with default settings the backend rejects generation with 422 `ELIGIBILITY_RULES_UNVERIFIED` until the owner confirms the Feature 16/17 rules (or `REPORT_REQUIRE_VERIFIED_RULES=false` is set); the page will show that message. GAAP `/sales` may also exceed the 30 s `GAAP_TIMEOUT_MS`. The dashboard does not auto-refresh while a report runs.

**Follow-up (user request, 2026-11-09): GAAP `match` format.** `buildMatch` in `backend/src/modules/gaap/sales.adapter.js` now writes the tuple format the user showed working in a direct request, `[("createdDate", "gte", "20261105"), ..., ("isNegative", "eq", false), ("items.product._id", "eq", "<id>")]` (each part JSON-encoded, so quotes are escaped and `false` stays a boolean), instead of nested JSON arrays. Same filters and values. `sales.adapter.test.js` reads the new string back through a small `parseMatch` helper and has one exact-string test. `npm test` (root): backend 745/745, frontend 178/178; lint passes. Not verified against live GAAP from the app (the user's direct request is the only live evidence for this format). Local `backend/.env` (gitignored) also has `REPORT_REQUIRE_VERIFIED_RULES=false` and `GAAP_MAX_CONCURRENCY=1`.

**Decisions / limitations (please confirm):** (1) The counts are whole-application saved-report counts (reports are shared, no ownership), not totals of sales; no "all reports" money total is shown because the saved reports overlap in dates and currencies would still need separating. (2) Summary cards cover only the latest completed report; a per-report choice is not offered. (3) Five requests per load; loading the detail re-verifies the snapshot server-side (Feature 23). (4) The header "Demo data" badge is global and still shown (other pages remain mock-backed); the mock `reports.js` fixtures and `results-table.jsx` are still in the repo, now unused by the dashboard. (5) Not run: no server, browser, Atlas/Railway or live GAAP check; the UI tests use a stubbed fetch, so the UI-to-API link is not live evidence; no mutation check. Root `npm test` and backend tests were not rerun (no backend change).

### Feature 26: Excel Export from Saved Snapshot — Implemented, awaiting approval (2026-11-08)

`GET /api/v1/reports/:reportId/export` streams an .xlsx of one saved report. Inputs are two reads of saved MongoDB data (the report with its groupings, and its rows); the exporter has no GAAP dependency and nothing is stored (no binary, no collection, no field).

**Files:** new `backend/src/modules/exports/` — `spreadsheet-safe.js` (`safeText` formula-injection escaping, `toExcelAmount`, date helpers, `exportFilename`), `report-workbook.js` (ExcelJS streaming writer, four sheets), `report-exporter.js` (`createReportExporter`, `ExportTooLargeError`), `index.js`; tests `spreadsheet-safe.test.js` (13), `report-export.repository.test.js` (6, real MongoDB). Changed: `modules/reports/report.repository.js` (+`streamRows`, a verified row cursor), `reports.service.js` (+`prepareExport`, injected `prepareReportExport`), `controllers/reports.controller.js` (+`exportWorkbook`, 413 mapping), `routes/reports.routes.js`, `server.js` (wired from the repository only); `routes/reports-export.routes.test.js` (16, fixture stubs); `backend/package.json` and lockfile (+`exceljs` 4.4.0).

**Behaviour:** worksheets Summary, Product Details, Currency Summary, Raw Transactions (in that order). Summary: report id/status/calculation version, created/started/completed/exported times (UTC), source system, source fetch times, cache use and freshness, extraction complete, integrity checksum, selected filters (dates, counts, then the selected product/node/brand ids), per-currency totals, UNKNOWN warning, line warning counts. Product Details: currency x product. Currency Summary: per-currency totals plus node x currency. Raw Transactions: one line per saved row (one-based line, source key, UTC time as a real date, node, product, department, brand, currency, quantity, turnover, warnings), frozen header and filter. Currencies are listed USD, ZWG, others, UNKNOWN last, each with its code on every line; no cross-currency total exists. Amounts are numbers (formats `#,##0.00######` turnover, General quantity); an amount a double cannot hold exactly (over ~15 significant digits) is written as its exact saved text instead of a rounded number, and the Summary says so. Text from saved data (names, ids, source keys, warnings) is escaped: a leading `=`, `+`, `-`, `@`, tab, CR or LF (also after leading whitespace/control characters) gets an apostrophe; XML-illegal characters are removed; text is cut at Excel's 32,767-character limit. Filename is built from the report id and saved dates only (`simbisa-sales-report-<id>-<start>-<end>.xlsx`). Headers: xlsx content type, `attachment`, `Cache-Control: no-store`, `nosniff`, chunked (no length).

**Errors (before the first byte):** bad id 400 `INVALID_REPORT_ID`; any query parameter 400 `INVALID_QUERY`; unknown 404 `REPORT_NOT_FOUND`; pending/failed 409 `REPORT_NOT_COMPLETED`; more than 1,048,575 lines 413 `EXPORT_TOO_LARGE`; saved rows that fail the snapshot check 500 `SNAPSHOT_INTEGRITY_ERROR` (no problem codes to the client). If the rows fail verification after streaming began, the connection is destroyed (client gets an unreadable file, not a quietly wrong one) and the problem codes are logged. A client that disconnects stops the row stream.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test` exports + reports-export.routes | 35/35 pass (repository tests ran against a real isolated local MongoDB, dropped afterwards) |
| `npm test` (root) | Pass: backend 744/744, frontend 171/171 |
| `npm run lint`, `prettier --check backend/src frontend/src`, `npm run build` | Pass |
| Mutation: formula escaping disabled | 3 tests failed (as intended); restored |
| Memory probe (scratchpad script, not in the repo; 16 KB-buffer slow sink, synthetic rows) | 50,000 rows: heap growth ~11.8 MB; 200,000 rows: ~21.2 MB (file 8.5 MB, ~27 s). Sub-linear, not flat |

Acceptance: valid workbook downloads (zip magic, headers, ExcelJS re-reads all four sheets; 20,000-row and 12,000-row exports read back complete); snapshot numbers preserved (workbook rows equal the saved rows field by field, Summary totals equal `getSnapshot` totals, repeat exports identical, snapshot and `verifySnapshot` unchanged after export, altered or lost saved rows refuse the export); no stored xlsx binary (collections, document counts and the report document identical before and after an export; no binary field); no GAAP call on export (the exporter's only inputs are the two readers, a test asserts the module imports no GAAP client or adapter and the real-MongoDB test has no GAAP code at all).

**Decisions / limitations (please confirm):** (1) The export reads every saved row twice (once to verify and build the groupings, once to stream), so a very large report costs two passes; memory stays small but time grows with rows. (2) The `Download Excel` button on the report page is still disabled; connecting it is not part of this spec (the endpoint can be opened directly). (3) Amounts over ~15 significant digits are text cells, so they cannot be summed in Excel; this protects the saved value. (4) Dates in filters are shown as calendar days (labelled Africa/Harare); times are UTC. (5) Sheets are fixed; no per-currency or filtered export, no CSV. (6) A failure after streaming starts cannot return JSON; it drops the connection. (7) One workbook per request, limit 1,048,575 lines; larger reports get 413 (no split into several sheets). (8) No rate limit or concurrency cap on exports beyond the app's general limits, and exports are open to anyone who can reach the app (no authentication in v1). Not run: no server process, browser or real Excel/LibreOffice open of the file (validated by ExcelJS and unzip only), no Atlas/Railway check, no live GAAP; reports and rows are fixtures.

### Feature 25: Currency Breakdown View — Done and approved (2026-11-08)

A "Currency breakdown" section on the saved report details page: one section per currency, from the saved snapshot only (frontend-only change; no new endpoint, nothing calls GAAP).

**Files:** `frontend/src/features/reports/currency-breakdown.js` (new, pure: `buildCurrencySections`, `filterCurrencySections`, `compareCurrencies`), `currency-breakdown.test.js` (5), `components/currency-breakdown.jsx` (new), `components/group-table.jsx` (new; `GroupTable` moved out of `saved-report-summary.jsx`), `components/saved-report-summary.jsx` (renders the breakdown in place of the two combined product/node tables), `pages/pages.test.jsx` (old two-table tests replaced by 4 breakdown tests; one assertion renamed).

**Behaviour:** sections in order USD, ZWG, additional currencies (alphabetical, built dynamically from the saved totals), UNKNOWN last and only when present. USD and ZWG always have a section; with no lines it says "No USD lines in this report." Each section shows the saved line count, quantity and turnover for that currency plus product and node tables for that currency only (captions like "ZAR totals by product"). UNKNOWN is titled "Unclassified currency", carries its own warning (not USD/ZWG/any currency, never converted or added) and keeps the existing top-of-page warning. The "Show currency sections" filter (All sections / each section) only hides sections client-side: no request, no recalculation, and the per-currency KPI cards above are unchanged. Not shown for a report with no totals.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `vitest run --root frontend` | 171/171 pass (pages.test.jsx 67, currency-breakdown.test.js 5) |
| `npm test` (root) | backend 709/709 pass; frontend as above |
| `npm run lint`, `prettier --check frontend/src`, `npm run build` | Pass (build chunk-size warning only) |

Acceptance: each currency distinct (separate sections, tables, captions; ordering and per-currency tests); UNKNOWN never labelled USD (test asserts the UNKNOWN table has no "USD" text, own warning); totals unchanged (filter test compares the KPI cards before/after, no network call, figures are the saved strings).

**Decisions / limitations (please confirm):** (1) The filter is separate from the Report lines table's own currency filter; the two do not sync. (2) The KPI cards remain above the breakdown, so each currency's total appears twice (card and section header). (3) USD and ZWG sections are always shown even when empty; other currencies only when present. (4) Fixtures only: the UI tests use a stubbed fetch (labelled FIXTURE); no browser, server or live GAAP/MongoDB/Railway check, no mutation check. (5) The unused mock `results-table.jsx` is still present.

### Feature 24: Report Detail Table — Done and approved (2026-11-08)

Paginated `GET /api/v1/reports/:reportId/rows` and a "Report lines" table on the report details page. Reads only the saved `reports` and `reportRows` collections; nothing calls GAAP.

**Files:** backend — `modules/reports/report.repository.js` (+`listRows`, `ROWS_*` limits and sort allowlist, `canonicalDecimal`), `reports.service.js` (+`getReportRows`, `ReportNotCompletedError`), `index.js`, `controllers/reports.controller.js` (+`parseReportRowsQuery`, `rows`, 409 mapping), `routes/reports.routes.js`, `server.js`; tests `routes/reports-rows.routes.test.js` (6, stub), `modules/reports/report-rows.repository.test.js` (11, real MongoDB). Frontend — `features/reports/use-report-rows.js`, `components/report-rows-table.jsx`, `pages/report-details-page.jsx` (renders the table for completed reports), `pages/pages.test.jsx` (7 new tests, one assertion updated, fake rows endpoint labelled FIXTURE).

**Behaviour:** query `sort` (lineIndex, transactionAt, productName, nodeName, currency, quantity, turnover), `order`, `limit` (1–200, default 50), `offset` (0–1,000,000), `search` (1–100 chars, case-insensitive, matched literally in product/node name or id and source line key), exact filters `currency`, `productId`, `nodeId`. Unknown, repeated, blank or out-of-range values give 400 `INVALID_QUERY` before anything is read; bad id 400 `INVALID_REPORT_ID`; unknown report 404 `REPORT_NOT_FOUND`; pending or failed report 409 `REPORT_NOT_COMPLETED`. Every query is scoped by `reportId`. Sort always ends in `lineIndex` (unique per report), so pages never repeat or skip (the snapshot is immutable). Rows carry product, node, transaction time, currency, quantity, turnover (decimal text) and warnings; no report id or internal id. Response meta: `pagination`, `sort`, `filters`, `totals` (exact per-currency lineCount/quantity/turnover of ALL rows matching the filters, summed from stored decimal text, currencies never merged, UNKNOWN last), `reportTotals` (saved totals, same canonical text) and `reportRowCount`. With no filter `totals` equal `reportTotals`. UI: debounced search (250 ms), currency filter buttons (when more than one currency), sortable headers with `aria-sort`, 50 per page with Previous/Next and "Showing x–y of N", a totals strip that says whether it covers the whole report or only matching lines, loading, error with retry (the summary stays), "No lines match" with clear, empty-page and no-lines states. A report with zero lines makes no rows request.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test` reports-rows.routes and report-rows.repository (backend) | 17/17 pass (repository tests against a real isolated local MongoDB, dropped afterwards) |
| `vitest run src/pages/pages.test.jsx` (frontend) | 64/64 pass |
| `npm test` (root) | Pass: backend 709/709, frontend 163/163 |
| `npm run lint`, `prettier --check backend/src frontend/src`, `npm run build` | Pass (build chunk-size warning only) |
| Mutation: row query without the `reportId` scope | 7 tests failed (as intended); restored |

Acceptance: pagination stable (every sort, both directions, two page sizes and a repeat read give the identical order over 257 rows; a 12,000-row report paged); rows match report ID (two reports, each walked fully: only its own rows, a cross-report search finds nothing, no report id in a row; mutation above); no full database dump (limit capped at 200, offset capped, response size asserted, the UI never requests more than one page).

**Decisions / limitations (please confirm):** (1) The totals strip makes the server read the matching rows' amounts (a streamed pass) on every page request so totals always follow the filters; fine at the tested volume (12,000 rows), but a very large report would make each page request scan all its matching rows. (2) Offset paging, not cursors; deep offsets cost more. Sorts other than lineIndex have no dedicated index, so they use an in-database sort with disk use allowed (bounded by report scope). (3) Search is a literal case-insensitive substring match (regex scan within one report), not a text index. (4) A page request does not re-verify the snapshot checksum (the summary view does that on every load). (5) Currency filter buttons come from the saved report totals; product and node filters exist in the API (`productId`, `nodeId`) but the UI offers only search for them. (6) Columns are product, node, date (UTC), currency, quantity, turnover; tax and department are not stored on rows, so they are not shown. (7) The mock `results-table.jsx` is still unused (left for Feature 25). Not run: no server process, browser or Atlas/Railway check; UI tests use a stubbed fetch that imitates the endpoint, so the UI-to-API link is not live evidence; the 12,000-row test is the largest volume exercised.

### Feature 23: Report Summary View — Implemented, awaiting approval (2026-11-08)

`GET /api/v1/reports/:reportId` and a report details page that shows one saved report from the application's own saved data. Nothing here calls GAAP: the page makes one request, to this endpoint, and the repository reads only the `reports` and `reportRows` collections.

**Files:** backend — `modules/reports/report-groups.js` (new: exact per-currency product/node group accumulator + row warning counts), `report-summary.js` (new: `buildReportSummary` assembles totals + groups, orders them, and checks the groups against the saved totals), `report.repository.js` (+`getDetail`, `toFilterView`, `statusView` extracted from `getStatus`), `reports.service.js` (+`getReport`), `controllers/reports.controller.js` (+`detail`, `SnapshotIntegrityError` -> safe 500 `SNAPSHOT_INTEGRITY_ERROR`), `routes/reports.routes.js` (+`GET /:reportId`), `server.js`; tests `report-groups.test.js` (8), `report-detail.repository.test.js` (6, real MongoDB), `routes/reports-detail.routes.test.js` (5). Frontend — `features/reports/use-saved-report.js`, `components/saved-report-summary.jsx` (details card, warnings, per-currency KPI cards via existing `SummaryCards`, product and node tables), `pages/report-details-page.jsx` (rewritten, no longer fixture-backed); `report-view.jsx` and `report-provenance.jsx` removed (mock-only); `pages/pages.test.jsx` and `routes/routes.test.jsx` updated (9 new UI tests, mock details tests removed). Note: `report-summary.js` was changed on disk while I worked; I kept that version, moved my accumulator to `report-groups.js` and combined the two.

**Behaviour:** any existing report answers with metadata, the full saved filters, provenance (fetchedAt, cache use/freshness, complete) and timestamps. Pending and failed reports carry no totals or groups (a failed one carries its error code and message). A completed report adds the saved per-currency totals (`totals`) and `summary` {products, nodes, warnings, consistency}: groups are per currency and product, and per currency and node, summed exactly (decimal text, no floats) from the saved rows in one streamed pass, ordered by currency (UNKNOWN last), name, id. The same pass re-verifies the snapshot (row count, per-currency sums, checksum against `integrity.rowsChecksum`) and `buildReportSummary` checks the groups against the saved totals; any disagreement refuses to show the report (500 `SNAPSHOT_INTEGRITY_ERROR`, no problem codes to the client). No rows are returned. Invalid id 400 `INVALID_REPORT_ID`, unknown 404 `REPORT_NOT_FOUND`, any query parameter 400. UI: loading, not found, error with retry, pending (with Check again), failed (reason, no partial data), completed; per-currency KPI cards, UNKNOWN warning, row warning counts, date range, generated at, source fetched at, freshness text, selection counts with IDs in a collapsible section; first 50 groups per table with Show all; Download Excel stays disabled (Feature 26).

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test` report-groups, report-detail.repository, reports-detail.routes | 19/19 pass (repository tests against a real isolated local MongoDB, dropped afterwards) |
| `npm test` (root) | Pass: backend 692/692, frontend 155/155 |
| `npm run lint`, `npm run build`, `prettier --check backend/src frontend/src` | Pass (build chunk-size warning only) |

Acceptance: summary matches snapshot (repository test: groups equal saved totals per currency for lines, quantity and turnover; edited or deleted saved rows make the report refuse to load); currency separated (USD, ZWG and UNKNOWN stay separate in totals, groups and UI, no cross-currency total); no live GAAP fetch (no GAAP adapter exists in the repository tests, the UI test asserts a single request to the report endpoint).

**Decisions / limitations (please confirm):** (1) The summary re-reads every saved row on each view (streamed, bounded memory) to guarantee it matches the snapshot; fine for the tested volumes (up to 12,000 rows in Feature 21), but not benchmarked for very large reports and a stored precomputed summary may be wanted later. (2) Group names come from the names saved on the rows; an unnamed product or node shows its id. (3) A report that fails its integrity check is refused outright rather than shown with a warning. (4) The detail rows table and the currency breakdown view are Features 24 and 25; `results-table.jsx` (mock) is now unused and left for them. (5) The dashboard still uses mock reports (Feature 27). (6) Row warning codes are shown as stored; no wording has been agreed for them. Not run: no server process, browser or Atlas/Railway check; UI tests use a stubbed fetch, so the UI-to-API link is not live evidence; no mutation checks.

### Feature 22: Saved Reports List — Done and approved (2026-11-08)

Paginated, metadata-only `GET /api/v1/reports` and a Saved Reports page wired to it. No authentication and no per-user ownership: the page says reports are shared across the application, not private to a user.

**Files:** backend — `modules/reports/report.repository.js` (+`list`, `LIST_*` constants, defensive `toListItem`), `reports.service.js` (+`listReports`, pagination/sort meta), `index.js`, `controllers/reports.controller.js` (+`parseReportListQuery`, `list`), `routes/reports.routes.js` (+`GET /`), `server.js` (passes `listReports`), `models/report.model.js` (+indexes `{status, createdAt}` and `{filters.startDate, createdAt}`); tests `routes/reports-list.routes.test.js` (7), `modules/reports/report-list.repository.test.js` (8, real MongoDB), `routes/reports.routes.test.js` (old "GET is 404" assertion replaced). Frontend — `features/reports/saved-reports.js` (pure display helpers), `use-saved-reports.js`, `pages/saved-reports-page.jsx` (rewritten, no longer demo fixtures), `pages/pages.test.jsx` (saved reports tests rewritten: 7 UI tests; `/reports` removed from the demo-labelled list).

**Behaviour:** query `status` (pending/completed/failed), `sort` (createdAt, startDate, status), `order`, `limit` (1–100, default 20), `offset`; unknown, repeated or out-of-range values give 400 `INVALID_QUERY`. Sort is total (`_id` tiebreak), so pages never repeat or skip. Items carry: id, status, start/end date, **counts** of products/nodes/brands (no id lists), rowCount, calculationVersion, provenance (source, fetchedAt, usedCache, cacheFreshness, complete), error code/message, timestamps. No totals, rows or integrity data. Meta: `pagination {total, limit, offset, returned, hasMore}`, `sort`, `status`. Offset past the end returns an empty page with the true total. Damaged documents with missing parts yield nulls instead of failing the page. UI: status filter, sort field and direction, Previous/Next with "Showing x–y of N", loading, error (with retry), empty (none / none with this status / empty page) states; freshness text distinguishes live, cached (fresh/stale), incomplete and not recorded; only completed reports link to details.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test src/routes/reports-list.routes.test.js src/modules/reports/report-list.repository.test.js` (backend) | 15/15 pass (repository tests ran against a real isolated local MongoDB, dropped afterwards) |
| `npm test` (root) | Pass: backend 673/673, frontend 155/155 |
| `npm run lint`, `npm run build`, `prettier --check backend/src frontend/src` | Pass (build chunk-size warning only) |

Acceptance: discoverable (list, status filter, sort, paging tests); no heavy row payloads (repository test asserts no totals/rows/integrity/id lists and each item under 1.5 KB); states clear (loading, error+retry, three empty cases, missing-parts test).

**Decisions / limitations (please confirm):** (1) Search by name was removed: reports have no name. (2) Selected filters are shown as counts, not id lists, to keep the list light; names of products/nodes come with the details feature. (3) `/reports/:id` still renders Feature 23's mock page, so a real report id opens "No saved report with this ID" until that feature is built. (4) Offset paging, not cursors; fine at this scale, and a report created while paging can shift a page. (5) Sorting by status is alphabetical. Not run: no server process, browser or Atlas/Railway check; UI tests use a stubbed fetch, so the UI-to-API link is not live evidence; no mutation checks.

### Feature 21: Save Immutable Report Snapshot — Done and approved (2026-11-08)

_Approved "for now"; changes to its decisions and limitations will be handled after all feature specs are done._

Completion of a report is now integrity-checked and all-or-nothing, rows are write-once, and a saved snapshot can be reloaded and re-verified. Feature 20 already wrote rows with the report; this feature adds the checks, guards and read side. Full write-up: `docs/report-snapshot.md`.

**Files:** `backend/src/modules/reports/` — `report-snapshot.js` (new, pure: row normalization, sha256 checksum, per-currency reconciliation, `SnapshotIntegrityError`, `prepareSnapshot`), `report.repository.js` (rewritten `markCompleted`; new `getSnapshot`, `readRows`, `verifySnapshot`; `SNAPSHOT_SIZE_LIMITS`), `support/report-memory-repository.js` (same pre-write rules), `index.js`; tests `report-snapshot.test.js` (14), `report-snapshot.repository.test.js` (18, real MongoDB). `backend/src/models/` — `report.model.js` (+`integrity` block, required for `completed`), `report-row.model.js` (write-once guards, `ReportRowImmutableError`, `ROW_ROLLBACK_OPTION`), `report.model.test.js` and `report-row.model.test.js` (updated/extended). `docs/report-snapshot.md`.

**Behaviour:** (1) before any write, rows are validated (shape, sequential `lineIndex`, no repeated source line, valid currency, decimal text only, at most 34 digits) and reconciled with the saved totals per currency (exact, currencies never merged); (2) rows are written in batches bounded by 1000 rows and 8 MiB while the report is `pending`; (3) rows are read back and count, per-currency sums and checksum must equal what was meant to be written; (4) `completed` is set by a conditional update that only matches a still-`pending` report, with `integrity.rowsChecksum` recorded. Any failure deletes exactly the rows that call wrote and leaves the report `pending` (the generator then records `failed`/`SNAPSHOT_SAVE_FAILED`). Size limits: row 16 KiB, report document 1 MiB. Readers only serve completed reports. Regeneration always creates a new pending report (new id); completed reports and their rows cannot be edited through the application. `verifySnapshot` detects edits made by bypassing the guards.

**Decisions made (please confirm):** (1) A checksum of all rows is stored in `reports.integrity` (additive, `schemaVersion` stays 1; completed reports now require it, so a completed report without it is invalid). (2) No multi-document transaction (needs a replica set; topology unconfirmed); ordering rows → verify → conditional completion gives readers the same guarantee. (3) Read API is repository-level only (`getSnapshot`, `readRows`, `verifySnapshot`); no HTTP route was added, that belongs to Features 22–24. (4) Money must be decimal text; JS numbers are refused at the snapshot boundary. (5) Rows are write-once at model level, with one explicit rollback exception used only by the repository.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test src/modules/reports/report-snapshot.test.js` | 14/14 pass (reconciliation per field and currency, sequence, duplicates, 12 bad-row cases, digits, trimming, no values in errors) |
| `node --test src/modules/reports/report-snapshot.repository.test.js` (real isolated local MongoDB, dropped afterwards) | 18/18 pass: reload identical across pages and repeat reads; 12,000 rows in byte-bounded batches, max row doc under 2 KiB, report doc under 16 KiB; oversized row/report refused; totals mismatch, duplicate, mid-write failure, corrupted read-back, lost row, report no longer pending, concurrent completion (exactly one wins), other reports untouched; immutability; tamper detection; regeneration |
| `node --test src/models/*.test.js` | 40/40 pass |
| `npm test` (root) | Pass: backend 658/658, frontend 151/151 |
| `npm run lint`, `npm run build`, `prettier --check backend/src docs/report-snapshot.md` | Pass (build chunk-size warning only) |
| Mutation: read-back comparison disabled | 2 tests failed (as intended); restored |
| Mutation: completion update without `status: pending` | 1 test failed (as intended); restored |

Acceptance: snapshot reloads identically (field-by-field and checksum tests, repeat reads); no oversized documents (limits enforced and measured with `$bsonSize`); completion atomic/consistent (rollback and race tests, rows only visible once completed).

**Not run / limitations:** local single-node MongoDB only: no Atlas/Railway, no replica set, no transactions. Rows and sales are fixtures: no live GAAP run, no server process or browser check. The 12,000-row test is the largest volume exercised (not millions). A crash between the row write and completion leaves a `pending` report with orphan rows (never served, no sweeper). Retention/cleanup and a `schemaVersion` migration path are not built. Direct driver access bypasses the guards (detected afterwards by `verifySnapshot`, not prevented). The Generate Report button is still not connected. Next feature: 22, after approval.

### Feature 20: Report Generation Orchestration — Done and approved (2026-11-08)

`POST /api/v1/reports` now creates a `pending` report, returns 202 at once and generates it in a bounded background runner: fetch -> select -> normalize -> currency -> eligibility -> aggregate -> reconcile -> save -> `completed`, or `failed` with a code and safe message. Full write-up: `docs/report-generation.md`.

**Files:** `backend/src/modules/reports/` — `report-generation.js` (new: `createReportGenerator`, `FAILURE_CODES`, `decideSalesSource`), `report-runner.js` (new: bounded in-process worker, `ReportBusyError`), `report-execution.js` (new: `createReportExecution`, `loadReportExecutionConfig`), `report.repository.js` (new: Mongo lifecycle + rows), `support/report-memory-repository.js` (test double), `reports.service.js` (+`getReportStatus`, `ReportNotFoundError`), `index.js`; tests `report-generation.test.js` (24), `report-runner.test.js` (6), `report-execution.test.js` (8), `report.repository.test.js` (7, real MongoDB). Also `controllers/reports.controller.js` and `routes/reports.routes.js` (+`GET /:reportId/status`, 503 busy), `routes/reports.routes.test.js` (+4), `server.js` (wired; runner stopped on shutdown), `models/report.model.js` (+optional `provenance.sourceStartedAt`), `modules/gaap/sales.adapter.js` and `index.js` (export `SALES_MAX_QUERIES`), `.env.example` files, `docs/report-generation.md`.

**Decisions made (please confirm):** (1) **Strict completion:** any unreadable selected line/sale, duplicate source line or incomplete extraction fails the report; rule-based exclusions (negative, CANCELED, non-turnover) are not failures and are only counted in the job log. (2) Only selected products at selected nodes count (a sale lists all its products); lines with no product/node id fail. (3) **Eligibility block enforced:** while rules are unverified (`productionReady: false`) `startReport` returns 422 `ELIGIBILITY_RULES_UNVERIFIED` and creates nothing, so **no report can be generated in a default deployment until the owner confirms the Feature 16/17 open rules**; `REPORT_REQUIRE_VERIFIED_RULES=false` overrides it and stamps `+unverified-rules` into `calculationVersion`. (4) Rows are persisted here (needed for a consistent `completed`); Feature 21 still owns snapshot read/immutability work. (5) `use_cache`/`bypass_cache` make no difference to sales (never cached); recorded as `usedCache:false`. (6) Added a minimal status endpoint, otherwise pending -> completed/failed is unobservable. (7) Retry = new report with a new id; a failed report is never reopened.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| New reports tests (generation, runner, execution) | 38/38 pass (success, empty, ineligible sales, multi-currency + UNKNOWN, incomplete/GAAP/unexpected failures, unusable lines, duplicates, save failure, unrecordable failure, timeout/shutdown, transient retry, retry as new report, busy, rules block) |
| `node --test backend/src/modules/reports/report.repository.test.js` | 7/7 pass against a real isolated local MongoDB (completed rows across batches, rollback on mid-insert failure, no re-completion, failure record, end to end totals = rows) |
| `npm test` (root) | Pass: backend 624/624, frontend 151/151 |
| `npm run lint`, `npm run build`, `prettier --check backend/src` | Pass (build chunk-size warning only) |
| Mutation: completeness check disabled | 2 tests failed (as intended); restored |

Acceptance: lifecycle accurate (pending -> completed/failed, tested with memory and real MongoDB); no partial completed report (every failure path asserts no totals and no rows, rollback tested); source provenance stored (`sourceStartedAt`, `fetchedAt`, cache fields, complete, calculation version).

**Not run / limitations:** GAAP is fixture-only: no live GAAP run, no full server process, no browser, no Atlas/Railway. `/sales` pages took ~35 s when probed, but the app's default `GAAP_TIMEOUT_MS` is 30 s, so real reports will likely fail until it is raised (not changed here). Runner limits are per process. A crash mid-save leaves a `pending` report (and possibly orphan rows); no sweeper exists. Per-line excluded detail is not stored (counts are logged only); no department mapping (rows have no `departmentId`). The Generate Report button is still not connected. Next feature: 21, after approval.

### Feature 19: Hybrid Cache Layer — Done and approved (2026-11-08)

Shared read-through cache for nodes and catalog (MongoDB `catalogCache`), with configurable TTL and refresh policy, stale detection, safe fallback and hit/miss metadata. Sales cache stays disabled.

**Files:** `backend/src/modules/cache/` — `read-through-cache.js` (new: `createReadThroughCache` → `read`, `refresh`, `stats`), `cache-policy.js` (new: `loadCachePolicy`), `sales-cache.policy.js` (new: `loadSalesCachePolicy`), `read-through-cache.test.js` (20 tests), `nodes-cache.config.js` and `catalog-cache.config.js` (now delegate to `loadCachePolicy`), `index.js`; `modules/catalog/nodes.service.js` and `catalog.service.js` (rewritten on the shared cache; same API, `meta.cache` added); `server.js` (passes policy, calls `loadSalesCachePolicy`); `catalog-cache.repository.test.js` (config assertion adjusted); `.env.example`, `README.md`.

**Behaviour:** TTL `*_CACHE_TTL_HOURS` (1–720, default 24). Policy `*_CACHE_REFRESH_POLICY`: `manual` (default, the previously approved behaviour: expired data served labelled stale, only the refresh endpoints call GAAP) or `on_expiry` (a read of expired data refetches; on failure the stored copy is served as `stale_fallback`, reason `UPSTREAM_UNAVAILABLE` or `UPSTREAM_RETRY_COOLDOWN`, with its original `fetchedAt`; `*_CACHE_RETRY_COOLDOWN_SECONDS` default 30 limits retries). Nothing stored and GAAP down = error, nothing stored or invented. A failed refetch never overwrites stored data. Concurrent fetches are merged (per process). Freshness is recomputed from `expiresAt`: a repository claiming `fresh` for an expired or unreadable-expiry entry is not believed. Each response carries `meta.cache` {status hit/miss/refresh/stale_fallback, hit, source, key, origin, fetchedAt, expiresAt, freshness, refreshPolicy, fallback, persisted}; process counters via `cacheStats()`. Sales: `loadSalesCachePolicy` always returns disabled and throws at startup if `SALES_CACHE_ENABLED` is set to anything but empty/`false`; no `salesCache` collection or code exists.

**Verification (2026-11-08)**

| Command / check | Result |
| --- | --- |
| `node --test backend/src/modules/cache/read-through-cache.test.js` | 20/20 pass (expired entries, unavailable upstream, concurrent refresh, cooldown, incomplete, save/read failures, config, sales gate) |
| `npm test` (root) | Pass: backend 576/576, frontend 151/151 |
| `npm run lint`, `npm run build` | Pass (chunk-size warning only) |
| `prettier --check` cache, catalog, server.js | Pass |

Acceptance: freshness visible (`meta.cache`, `cacheFreshness`); stale not misrepresented (recomputed from `expiresAt`, fallback labelled stale with the old `fetchedAt`); no fabricated entries (failed fetch with nothing stored throws and saves nothing).

**Blockers / owner confirmation:** the default policy stays `manual` (no automatic refresh); whether to run `on_expiry` in production, and the TTL values, are owner decisions. Sales caching needs approved completeness, invalidation and reconciliation rules before it can be built.

**Not run / limitations:** fixture-only (fake upstream, in-memory repository; the real MongoDB repository tests were not changed beyond one assertion). No live GAAP, Railway or browser check, and no mutation check. Single-flight and the failure cooldown are per process, not across replicas. `cacheStats()` is not exposed over HTTP. Next feature: awaiting the next spec.

### Feature 18: Financial Aggregation Engine — Done and approved (2026-11-08)

Pure per-currency, per-product, per-node (and per-department where mapped) totals over normalized lines. Not wired to a route, report or export; nothing persisted. Full write-up: `docs/financial-aggregation.md`.

**Files:** `backend/src/modules/gaap/` — `decimal-sum.js` (new: exact BigInt decimal-string sums), `financial-aggregation.js` (new: `aggregateFinancials`, `aggregateNormalizedLines`, `verifyReconciliation`, `AGGREGATION_EXCLUSIONS`), `financial-aggregation.test.js` (26 tests), `index.js` exports; `docs/financial-aggregation.md`.

**Behaviour:** currency first (alphabetical, `UNKNOWN` last and never merged), then products, nodes, product-node cells, departments (from an optional `departmentsByProductId` mapping; overlapping by design; unmapped products in `unmappedDepartment`). Totals: line count, quantity, turnover, tax (only where present; `taxMissingLineCount` shows gaps). Exact decimal sums, no rounding or floats, order-independent. No cross-currency total exists in the output. Only eligible lines are summed; ineligible lines are counted by reason; an eligible but unaggregatable line is excluded with an `AGGREGATION_*` reason. Lines lacking `currency` or `eligibility` throw (no defaults). Every result carries `reconciliation` (detail sums = summary on every field).

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test backend/src/modules/gaap/financial-aggregation.test.js` | 26/26 pass |
| `npm test` (root) | Pass: backend 556/556, frontend 151/151 |
| `npm run lint`, `npm run build` | Pass (build chunk-size warning only) |
| `prettier --check` backend gaap + new doc | Pass |
| Mutation: all currencies merged into one bucket | 4 tests failed (as intended); restored |

Acceptance: summary equals detail (reconciliation tests, incl. tamper detection); no mixed-currency totals (multi-currency and UNKNOWN tests, no grand total in shape); deterministic (reversed/shuffled/repeated input give identical JSON). Tested: empty sets, all-excluded, rounding/precision, values beyond float range, returns, multiple currencies, missing tax, invalid fields, department overlap.

**Blockers / owner confirmation (not assumed):** Feature 16/17 owner questions still apply (refund/negative semantics, presentation of base-denominated sales, other statuses), and eligibility is not production-ready until confirmed. Resolved by the owner (2026-11-08): currency-level `quantity` is wanted and stays. Open here: tax semantics of `lineTotals.tax` (observed, not confirmed), and the department mapping source (catalog, not looked up here).

**Not run / limitations:** fixture-only; no live GAAP, MongoDB, Railway or browser check. Not called by any route, report or export, and no `Report`/`ReportRow` persistence mapping yet (report-generation features). Next feature: 19, after approval.

### Feature 17: Transaction Eligibility Rules — Done and approved (2026-11-08)

One pure function decides whether a normalized sales line counts. Not wired to a route or report; nothing persisted. Full write-up: `docs/transaction-eligibility.md`.

**Files:** `backend/src/modules/gaap/` — `transaction-eligibility.js` (new: `evaluateLineEligibility`, `applyEligibility`, `getEligibilityReadiness`, `assertEligibilityProductionReady`, `RULES`, reason/note constants), `transaction-eligibility.test.js` (32 tests), `index.js` exports; `docs/transaction-eligibility.md`.

**Owner decisions (2026-11-08):** TENDERED included, CANCELED excluded, non-turnover not included (line with non-zero `lineTotals.nonTurnover` excluded whole, reason `NON_TURNOVER_LINE`; interpretation to confirm). Verified rules: integrity, CANCELED, non-turnover; the rest stay unverified.

**Behaviour:** eligible = no exclusion reasons. Reasons (fixed order, codes only, no source values): `INVALID_LINE`, `LINE_UNUSABLE` (+ Feature 15 error codes), `DUPLICATE_LINE`, `STATUS_MISSING/CANCELED/NOT_TENDERED` (only exact `TENDERED` counts), `NON_TURNOVER_LINE`, `NEGATIVE_FLAG_MISSING/NEGATIVE_SALE`, `ZERO_QUANTITY`, `NEGATIVE_QUANTITY`, `NEGATIVE_TURNOVER`, `SIGN_MISMATCH`. Notes that never exclude: zero turnover, unexpected discount, add-on basis. Ineligible lines are kept with reasons (auditable); summary is line counts only; currency not read (UNKNOWN stays eligible and visible). `RULES` marks only the integrity rules verified; `getEligibilityReadiness()` returns `productionReady: false` and `assertEligibilityProductionReady()` throws `ELIGIBILITY_RULES_UNVERIFIED` until the owner confirms the rest.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test backend/src/modules/gaap/transaction-eligibility.test.js` | 32/32 pass |
| `npm test` (root) | Pass: backend 530/530, frontend 151/151 |
| `npm run lint`, `npm run build` | Pass (build chunk-size warning only) |
| `prettier --check` backend gaap + new doc | Pass |
| Mutation: negative-sale check disabled | 3 tests failed (as intended); restored |

Acceptance: eligibility documented (`docs/transaction-eligibility.md`, `RULES`); reasons auditable (codes per line, counts, tests for tendered/void/refund/duplicate/negative/invalid input); unverified rules block production (readiness + assert, tested).

**Blockers / owner confirmation (not assumed):** status (TENDERED in, CANCELED out) and non-turnover (excluded) are now owner-decided; refund, negative and return semantics are still **unconfirmed**. No live probe was run this time; only Feature 14/15 findings (TENDERED and CANCELED seen, 6 negative sales) are used. Open: (1) other statuses (e.g. void; excluded for now); (2) are `isNegative` sales refunds, excluded (current) or netted; (3) negative or zero-quantity lines in non-negative sales; (4) zero-turnover lines (counted, with note).

**Not run / limitations:** unit tests are fixture-only; no live GAAP, MongoDB, Railway or browser check. Not called by any route, report or export, so "applied to all reports and exports" holds only by design (single exported function); wiring is for the report-generation features. Next feature: 18, after approval and owner answers.

### Feature 16: Currency Classification — Done and approved (2026-11-08)

Pure resolver deciding which currency a normalized sales line's amounts are in. Not wired to a route or report; nothing persisted. Full write-up: `docs/currency-classification.md`.

**Files:** `backend/src/modules/gaap/` — `currency.resolver.js` (new: `resolveCurrency`, `classifyLineCurrencies`, `CURRENCY_*` constants), `currency.resolver.test.js` (31 tests), `index.js` exports; `docs/currency-classification.md`.

**Live finding (read-only probes, 2026-11-08, 200 TENDERED sales, one day; structure/counts only):** pairs were USD/USD 185 and ZWG-selected/USD-base 15. In the ZWG-selected sales the unit prices of the 5 products also sold in USD sales were identical to the USD prices (rate ~26.7), so **line amounts are in the base currency; selected currency is the tender currency**. `forex.forexRates[]` and rate fields also exist.

**Owner answers (2026-11-08):** amounts are in the base currency when selected differs (confirmed; policy `base` stays the default, so the rule is no longer provisional); ZWL and ZWG are the same currency (ZWL -> ZWG, only alias, `aliasedFrom` recorded). Payments examined (read-only): `payments[]` has no currency field; `amount` = `totals.turnover` on 197/197 single-payment sales (incl. 15 ZWG-selected) and `actualTender` = `amount` on those 15, so payments are base-unit and give no tender currency; method names are free text and not used.

**Behaviour:** equal valid codes -> that code; differ -> base code with basis `BASE_WHEN_SELECTED_DIFFERS` (default policy `base`) or `UNKNOWN`/`CURRENCY_BASIS_UNCONFIRMED` (policy `unknown`); missing or invalid (not 3 letters, incl. literal `UNKNOWN`) either field -> `UNKNOWN` with a reason. No fallback between fields, no USD default, ZWL->ZWG is the only alias, no conversion. `classifyLineCurrencies` keeps every line (UNKNOWN visible), returns line counts per currency only and never reads or sums `turnover`.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test backend/src/modules/gaap/currency.resolver.test.js` | 31/31 pass |
| `npm test` (root) | Pass: backend 498/498, frontend 151/151 |
| `npm run lint`, `npm run build` | Pass (build chunk-size warning only) |
| `prettier --check` backend gaap + docs | Flags only `docs/report-request-contract.md` (Feature 13 file, not touched) |
| Mutation: default to USD when selected is missing | 4 tests failed (as intended); restored |
| Live probes (3 read-only scripts in the session scratchpad, not in the repo; key read from git-ignored `sample.js`, never printed) | Findings above |

Acceptance: currencies classified (USD, ZWG, ZAR/GBP/BWP/EUR/ZWL, differing pair tests); UNKNOWN visible (lines kept with `currencyResolution.reason`, counts in summary); no cross-currency summing (summary has line counts only, money fields untouched, shape test).

**Blockers / owner confirmation (not assumed):** (1) RESOLVED by the owner: base-currency denomination confirmed; (2) still open: whether reports should present such sales under the base currency (what the resolver does, since the amounts are base-denominated) or surface the tendered currency separately as extra information; (3) ZWL = ZWG and `payments[]` are resolved (see above); still unexamined: payments on sales with several payments or negative sales.

**Not run / limitations:** unit tests are fixture-only; live evidence is the manual probe. Resolver not called by any route or report, and Feature 15's normalizer still does not set `currency`; no MongoDB, Railway or browser check. Next feature: 17 (transaction eligibility), after approval.

### Feature 15: Sales Line Normalization — Done and approved (2026-11-08)

Pure conversion of raw GAAP sales (Feature 14 output) into one canonical record per sale item. Not wired to a route or report generation; nothing persisted. Full write-up: `docs/sales-line-normalization.md`.

**Files:** `backend/src/modules/gaap/` — `sales-line.normalizer.js` (new: `normalizeSalesLines`, `ISSUE_CODES`, `SALE_ISSUE_CODES`, version const), `decimal-string.js` (new: `toDecimalString`, `decimalSign`), `fixtures/sales-lines.fixture.js` (labelled FIXTURE), `sales-line.normalizer.test.js` (41 tests), `decimal-string.test.js` (5), `index.js` exports; `docs/sales-line-normalization.md`.

**Live findings (read-only, 2026-11-08, one day: 200 TENDERED sales/354 lines + 6 negative sales/8 lines; paths, types, counts only):** lines have `lineId` (unique per sale), `product._id`, `qty`, `priceIncl/Excl`, discount fields, `lineTotals.{turnover,tax,nonTurnover}`. `lineTotals.turnover` is present on 354/354, equals `priceIncl × qty` on 354/354 and sums to `totals.turnover` on 206/206 sales, so it is the line value. `productTotals.turnover` does not reconcile (146/200) and is not used. `itemPriceIncl` (sample.js) and `productId` do not exist on lines. Sales carry `forex.selectedCurrency/baseCurrency`; 15 of 200 were ZWG/USD. Discount fields were 0 and add-ons unpriced on every observed line.

**Behaviour:** `turnover` and `quantity` are signed decimal strings (source precision, no float math, no rounding); only finite JSON numbers are accepted. **No fallback** for turnover (sample.js's `itemPriceIncl × qty` and `qty ?? 1` are not used). Key `sourceLineKey = <saleId>/<lineId>` (never positional); repeats flagged `DUPLICATE_SOURCE_LINE`. Every item yields a line; `error` issues (missing/invalid ids, node, product, timestamp, quantity, turnover, duplicates) set `usable:false`; warnings (zero/negative quantity or turnover, sign mismatch, unexpected discount, unverified add-on basis, differing or missing currency fields, invalid optional amounts) annotate. Timestamps need an explicit offset and a real calendar date. Raw currency codes are carried in `currencySource` with **no resolved `currency`** (Feature 16). No customer/payment/staff data is copied; issues never echo values. `normalizationVersion` 2 on every line.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test backend/src/modules/gaap/*.test.js` | 187/187 pass (46 new) |
| `npm test` (root) | Pass: backend 467/467 (0 skipped), frontend 151/151 |
| `npm run lint`, `npm run build` | Pass (build chunk-size warning only) |
| `npm run format:check` | Flags only `docs/report-request-contract.md` (Feature 13 file, not touched) |
| Mutation: turnover falls back to productTotals/price×qty | 1 test failed (as intended); restored |
| Mutation: `qty ?? 1` | 2 tests failed (as intended); restored |
| Live probes (3 read-only scripts in the session scratchpad, not in the repo; key read from git-ignored `sample.js`, never printed) | Findings above |

Acceptance: fields traceable (`sourceLineKey`, `source` refs, version; mapping tests); bad lines flagged (about 20 bad-input cases incl. missing ids, bad qty/turnover/timestamps, non-object items, duplicates, sale-level problems); no silent monetary assumptions (no fallback, no defaulting, absent ≠ 0, no currency resolution, unexpected discounts and add-on basis flagged).

**Blockers / owner confirmation (not assumed):** **Resolved by the owner (2026-11-08):** turnover is tax-inclusive, and net of discounts with no discounts applied; a non-zero discount is flagged `UNEXPECTED_DISCOUNT` (normalization version 2). **Still open:** (3) are priced add-ons inside it (none observed); (4) currency of turnover when selected ≠ base (Feature 16); (5) negative/zero-quantity and `CANCELED` semantics (Feature 17; flags carried, nothing excluded here).

**Not run / limitations:** unit tests are fixture-only; the live evidence is the manual probes, for one tenant and one day, not a full extraction or an end-to-end run. Discount, priced add-on, refund and non-USD-selected line values were never seen or only counted. The normalizer is not called by any route or report; no MongoDB, Railway or browser check. The one live probe wrote a `GAAP_TIMEOUT_MS`-free script (native fetch, 150 s timeout); the app client's default 30 s is still too short for `/sales`.

### Feature 14: GAAP Sales Pagination — Done and approved (2026-11-08)

Bounded, de-duplicating `GET /sales` extraction with completeness metadata. Not wired to a route or report generation. Details: `docs/gaap-sales-extraction.md`.

**Files:** `backend/src/modules/gaap/sales.adapter.js` (new: `createSalesAdapter` → `fetchSales`, `buildMatch`, `buildQueries`), `sales.adapter.test.js` (24 tests), `fixtures/sales.fixture.js` (labelled FIXTURE), `index.js` exports, `docs/gaap-sales-extraction.md`.

**Behaviour:** one `eq` query per product × node (capped, default 200); `limit` 500/`skip`, ends on a short/empty page (never `totalRecords`), page cap 200; per-page retry on transient failure; dedupe by sale `_id`; eligibility re-check (TENDERED, `isNegative false`, node/product) with counts in `excluded`. Result: `sales`, `complete`/`partial`, `incompleteReasons`, `failures`, per-page stats, `receivedCount`, `duplicateCount`, `sourceStartedAt`, `fetchedAt`, `range`. A failed page stops its query (no gap bridging) and the result is partial; aborts throw.

**Live findings (read-only, one day, counts only):** `match`/`limit`/`skip`/`sort` work as in `sample.js`; no overlap across pages; `_id` unique; **GAAP reads `YYYYMMDD` as a Harare (UTC+2) day, both bounds inclusive** (20261105 = 2026-11-04T22:00Z..2026-11-05T21:59:59Z), which answers the createdDate-boundary question for that day; each page query took ~35 s so `GAAP_TIMEOUT_MS` must be raised (30 s default timed out, 120 s worked); status filter needed (CANCELED sales exist).

**Verification (2026-11-08):** `npm test` backend 421/421, frontend 151/151; `npm run lint` and `npm run build` pass; `format:check` flags only `docs/report-request-contract.md` (Feature 13 file, not touched). Acceptance: every page accounted for (`pages` list, multi-page and exact-multiple tests); duplicates removed (overlap, repeated page, multi-product tests); partial never complete (failure, page-cap, unusable-record tests set `complete:false`).

**Not run / limitations:** adapter tests are scripted-client fixtures only; live evidence is the manual probe above, not a full-range extraction. Sort-tie stability under `skip` and mid-scan reordering unverified (a skipped sale is undetectable). `in` operator not used. Multi-day boundary, refunds/negative population and currency fields unexamined. Default `GAAP_TIMEOUT_MS` (30 s) is too short for `/sales`; `.env.example` not changed.

### Feature 13: Report Request Validation — Done and approved (2026-11-08)

`POST /api/v1/reports` accepts, validates and normalizes one request. **It creates no report**: execution is feature-gated off, so every valid request gets 501 `REPORT_EXECUTION_NOT_ENABLED` (`reportCreated: false`). Full contract: `docs/report-request-contract.md`.

**Contract:** body `{startDate, endDate (YYYYMMDD, inclusive, Harare, no future), productIds[], nodes:{mode all|brands|nodes, brandIds|nodeIds}, cachePolicy use_cache|bypass_cache}`; all required, no defaults, unknown fields rejected. Ids trimmed, deduped, sorted; brands/nodes expanded to exact resolved node ids (Feature 10 rules); products checked against the catalog (Feature 11). Errors: 400 `INVALID_REPORT_REQUEST` with `details.fields` (every bad field, values never echoed), 422 `UNKNOWN_PRODUCT/NODE/BRAND`, `NO_NODES`, `NODE_LIST_INCOMPLETE` (for `all`), `WORKLOAD_TOO_LARGE`. Caps (env, provisional): `REPORT_MAX_RANGE_DAYS` 92, `REPORT_MAX_PRODUCTS` 2000, `REPORT_MAX_NODES` 1000, `REPORT_MAX_NODE_DAYS` 50000.

**Decision to confirm:** the spec says "return a report ID and status contract". With the gate off I return **no ID** (501) rather than mint one: an ID with no stored report, or a `pending` report nothing will run, would be a false record. The 202 `{reportId, status:'pending', request}` contract is implemented behind an injected `startReport` and tested with a stub; `server.js` does not provide one. The service refuses any status other than `pending` (a report cannot come back `completed` here). If you want a persisted `pending` report instead, say so.

**Files:** backend `modules/reports/` (`report-request.js` parser, `report-dates.js`, `report-limits.js`, `reports.service.js`, `index.js`, `report-limits.test.js`), `controllers/reports.controller.js`, `routes/reports.routes.js`, `routes/reports.routes.test.js`, `routes/index.js`, `server.js` (wires the service, no `startReport`); `.env.example`; `docs/report-request-contract.md`.

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `npm test` (root) | Pass: backend 397/397 (80 new), frontend 151/151 |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass (build chunk-size warning only) |
| New tests | 43 bad-input cases (null/array/non-JSON/`__proto__` bodies, unknown fields, bad/impossible/future/reversed/over-long dates, non-string/blank/control-char/oversized/too many ids, duplicates not dodging the cap, every mode/id-list mismatch, bad cachePolicy), oversized and malformed JSON, no lookup or execution on rejected input, unknown ids, stale mapping, incomplete node list, node and node-day caps at and over the limit, Harare "today" vs UTC, GAAP failure 503, generic 500 with no secret leak, gate off = no report, `completed` from execution refused, limits env parsing |

Acceptance: contract documented (docs file); bad inputs rejected (tests above); no false completed reports (gate returns no ID, non-`pending` answers refused).

**Not run / limitations:** fixture-only (stub catalog/nodes services and stub `startReport`); no live GAAP, MongoDB, Railway or server-process run. Caps and `cachePolicy` meanings are not owner-approved. The frontend Generate button is not connected. Date helpers duplicate the frontend's; keep in sync. Product/node validation uses stored data that may be stale. No mutation checks were run on the new code.

### Feature 12: Date Range Selection — Done and approved (2026-11-08)

Inclusive start/end date input on Generate Report with clear validation, a maximum range and one normalized serialization.

**Behaviour:** dates are calendar dates `YYYYMMDD` with no timezone, never converted through local time. Both days are included (a single day is valid). Rules: both required, real calendar dates (20260230, 20261301 rejected), start <= end, inclusive span <= maximum. Maximum is a **provisional 92 days** (no approved value), overridable with `VITE_REPORT_MAX_RANGE_DAYS`; UI-only, the backend must enforce its own cap when report generation is built. `serializeDateRange` returns exactly `{startDate, endDate}` (fixed key order, trimmed) and throws on an invalid range. The picker shows per-field messages (`role="alert"`, `aria-invalid`), the day count, and a note that timezone/boundary handling is unconfirmed.

**Owner decisions (2026-11-08):** reporting timezone is Central Africa Time, Africa/Harare (UTC+2, no DST); future dates are rejected. "Today" is computed in Harare time (`todayInReportingTimezone`), start and end are each checked against it ("Start/End date cannot be in the future."), and the date inputs get `max=today`. The backend must enforce the same rule.

**Date format (owner decision, 2026-11-08): `YYYYMMDD`, as in `sample.js`'s `createdDate` filter.** Form state, `validateDateRange`, `todayInReportingTimezone` and `serializeDateRange` use it (`isValidIsoDate` renamed `isValidDate`; dashed dates are now invalid input). The picker converts to/from the browser date input's `YYYY-MM-DD` with `toInputValue`/`fromInputValue`. **Feature 05 model aligned (2026-11-08, user request):** `Report.filters.startDate/endDate` now validate as `YYYYMMDD` (`isIsoDate` renamed `isCompactDate`; dashed dates rejected; backend `report.model.test.js` updated and extended). No saved reports existed, so no migration. Frontend 151/151, backend 317/317, lint, format check, build pass.

**Still open:** how a day maps to GAAP `createdDate` bounds (start-of-day / end-of-day vs exclusive next day), GAAP timestamps are ISO 8601 UTC instants (owner, 2026-11-08), but how its date-only `createdDate` filter reads "YYYYMMDD" against them is unverified (a Harare day is 22:00Z to 21:59:59.999Z), and the approved max range (92 days provisional). See `docs/date-range-semantics.md`. No date is converted to an instant anywhere.

**Files:** `frontend/src/features/reports/date-range.js` (new: `isValidIsoDate`, `inclusiveDayCount`, `validateDateRange`, `serializeDateRange`, `configuredMaxRangeDays`), `filters.js` (delegates date validation, re-exports `isValidIsoDate`), `components/date-range-picker.jsx` (rewritten), tests `date-range.test.js` (new), `pages/pages.test.jsx` (empty-filter wording updated; 3 date-range UI tests added), `docs/date-range-semantics.md` (new).

**Verification (2026-11-08, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `npm test` (root) | Pass: frontend 150/150 (after the timezone/future-date change), backend 317/317 (0 skipped) |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass (build chunk-size warning only) |
| New unit tests | invalid/valid dates incl. leap days, month/year boundaries, DST-adjacent ranges, single day, start>end, max range at limit and limit+1, env override parsing, serialization shape and throw on invalid |

Acceptance: valid ranges accepted (unit + UI tests); invalid ranges blocked (missing, impossible, reversed, too long; unit + UI tests); timezone decision documented (as an explicit open decision in `docs/date-range-semantics.md` and in the UI note).

**Not run / limitations:** fixture/unit only; no GAAP, MongoDB, Railway, browser or visual check. The first full frontend run showed 62 transient failures (`toBeInTheDocument` not defined) that did not repeat on re-run (likely load-related); the later runs were clean. `serializeDateRange` is not yet called by any API request (Generate is not connected). The 92-day cap is a provisional value, not an owner decision. The future-date check uses the browser clock via Intl (Harare time); a wrong device clock would skew it, so the server must re-check. `<input type="date">` formatting is browser-dependent but its value is always `YYYY-MM-DD`.

### Feature 11: Department and Product Selection — Done and approved (2026-11-08)

Generate Report now browses real departments and products from the catalog backend (Feature 09) and selects one or more products. The selection lives in report form state only (nothing saved; no report DB use).

**Behaviour:** department picker shows group > department with product counts (from `GET /catalog/departments`); choosing a department only *browses* its products (`GET /catalog/departments/:id/products`, cached per department). The product selection spans departments: switching department never drops selections; selected products show as removable chips (deselect), plus Select all (visible) and Clear. Reset filters clears everything. `departmentId` is browse state, no longer a required field; the required filter is at least one product. Selected ids are checked live with the new endpoint; products the backend rejects are flagged, block "Selection check" (message) and can be removed in one click.

**New API:** `POST /api/v1/catalog/products/validate` with `{productIds:[...]}` returns `{productIds}` unique and sorted (meta as other catalog routes). 400 `INVALID_SELECTION` (not an object, extra field, missing/empty/non-array list, non-string/blank/control-char ids, >5000 ids, unknown query param; nothing reaches GAAP). 422 `UNKNOWN_PRODUCT` with `error.details.unknownIds` (sorted, never silently dropped) — covers unknown ids and inactive/deleted products, which the catalog excludes. Unmapped products (no POS department) are valid ids but cannot be browsed (not in any department).

**Files:** backend `modules/catalog/catalog.service.js` (+`validateProductIds`), `controllers/catalog.controller.js` (+`parseProductSelectionBody`, `validateProducts`), `routes/catalog.routes.js`, tests in `routes/catalog.routes.test.js`. Frontend `features/reports/use-catalog.js` (new: `useDepartments`, `useDepartmentProducts`, `useValidatedProducts`), `filters.js` (`withDepartment` no longer drops products; +`withoutProducts`, `groupDepartments`; no department requirement), `components/department-picker.jsx`, `components/product-multiselect.jsx` (rewritten), `pages/generate-report-page.jsx` (mock `DEPARTMENTS`/`PRODUCTS` no longer used here); tests `pages/pages.test.jsx`, `features/reports/filters.test.js`.

**Verification (2026-11-07, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `npm test` (root) | Pass: backend 317/317 (0 skipped), frontend 108/108 |
| New backend tests (5, in `catalog.routes.test.js`) | multi-product sorted/deduped and order-independent, unknown ids 422 with ids, inactive/deleted rejected, 10 malformed bodies + bad query 400 with 0 GAAP calls, GAAP failure 503 |
| New UI tests | multi-select across departments, deselect by list and chip, selection stable when switching departments and back, search/Select all/Clear, rejected ids flagged and removed, departments error + retry, grouped counts, validate request body |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass |

Acceptance: multiple products selectable (UI test); selection stable (cross-department test, ids sorted for validation so order does not matter); invalid IDs rejected (400/422 route tests and UI flag/remove test).

**Not run / limitations:** fixture-only (scripted GAAP responses on the backend; stubbed fetch in the UI). No live GAAP call, no server/browser run, no Atlas/Railway. The real catalog has 161 departments and thousands of products (Feature 09 live run); the product list renders up to 1000 per department with a warning when more exist, with no virtualization. Validation is by the stored catalog, which may be stale until refreshed. Selecting a department does not refresh GAAP. The Product Catalog page still uses demo fixtures. The Generate button is still not connected; reports do not yet consume the selection.

### Feature 10: Brand and Node Filtering — Done and approved (2026-11-08)

All nodes, brand-based nodes (one or many brands) or individually selected nodes, resolved to exact node IDs by the backend and wired into Generate Report.

**Brand definition (BLOCKER, still unconfirmed by the owner):** no GAAP field states a brand. Implemented the existing structural assumption, labelled in code, API (`meta.brandDefinition: TOP_LEVEL_NODE_WITH_CHILDREN_UNVERIFIED`) and UI: brand = top-level node (`sourceNodeId === id`) that has children; its nodes are those whose `parentId` is it. Childless top-level nodes are ungrouped nodes (not brands). If the owner approves a different definition or a configured mapping, only `buildNodeFilterOptions` changes.

**Files** (backend, under `backend/src/`): `modules/catalog/node-filters.js` (pure options + `resolveNodeSelection`, `SelectionError`), `node-filters.service.js`, `index.js`; `nodes.service.js` (+`listAllNodes`); `controllers/node-filters.controller.js`, `routes/node-filters.routes.js`, `routes/index.js`, `server.js`; `utils/api-error.js`, `utils/http-response.js`, `middleware/error-handler.js` (optional client-safe `details` on errors). Tests: `node-filters.test.js`, `routes/node-filters.routes.test.js`. `README.md` section added.
Frontend (`frontend/src/`): `features/reports/use-node-filters.js` (`useNodeFilterOptions`, `useResolvedNodes`), `components/node-selector.jsx` (rewritten: All nodes / By brand / Selected nodes), `filters.js` (`nodeMode`, `brandIds`, `nodeSelectionBody`; `nodesForBrand`/`withBrand` removed), `pages/generate-report-page.jsx`, `lib/api-client.js` (`ApiClientError.details`); tests `filters.test.js`, `pages/pages.test.jsx` updated.

**API:** `GET /api/v1/filters/nodes` (brands with exact `nodeIds`, nodes, sorted by name then id, provenance meta); `POST /api/v1/filters/nodes/resolve` with `{mode:'all'}` | `{mode:'brands',brandIds}` | `{mode:'nodes',nodeIds}` returns `{mode, brandIds, nodeIds}` unique and sorted by id. 400 `INVALID_SELECTION` (bad body/mode-ids mix/empty list), 422 `UNKNOWN_BRAND`/`UNKNOWN_NODE` (stale mapping; ids in `error.details.unknownIds`, never dropped), 422 `NO_NODES` (zero nodes). GAAP errors map as for nodes.

**Verification (2026-11-07, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `npm test` (root) | Pass: backend 312/312 (0 skipped), frontend 102/102 |
| `node --test` node-filters + routes files | 27 new backend tests pass (zero nodes, multiple brands, stale ids, invalid bodies, determinism) |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass |
| Mutation: removed brand-expansion dedupe | Survived with disjoint brands; added a shared-node test, which covers it |

Acceptance: deterministic (sorted output, same result for reordered/repeated input, route + unit tests); no duplicate node IDs (set + sort, tested); All-nodes explicit (separate mode, UI default is manual selection, empty "All" is 422 not silent).

**Not run / limitations:** fixture-only. No live GAAP call, no server/browser run, no Atlas/Railway; the filter endpoints were tested against a fixture nodes service, so live brand structure is as observed in Feature 07/08 only. Selected IDs are resolved live as a count; Generate Report is still not connected, so reports do not yet consume the resolved IDs. The Nodes & Brands page still groups with its own copy of the brand rule in `nodes-catalog.js` (not switched to the backend, to keep scope); the two must be kept in sync until then. Stale-mapping detection checks the stored node list, which may itself be stale until refreshed. Departments/products filtering is unchanged (still demo fixtures in the UI).

### Feature 09: Catalog Backend — Done and approved (2026-11-08)

Catalog adapter, service and read-only API for departments and products, read from the GAAP product master and stored in MongoDB.

**Source (supplied by the project owner, 2026-11-07):** `GET /products?limit=` returning `{ totalRecords, data[] }`. Fields used: `_id` (product ID), `name`, `primaryCode`, `status` (boolean), `isDeleted` (boolean), `departments[]` of `{ departmentGroup, departmentInGroup, departmentGroupName, departmentInGroupName }`. Department ID = `departmentInGroup`, its group = `departmentGroup` (the `...InGroup` naming states group ⊃ department; the sample had two groups, "POS Department" and "Reporting"). Pricing, recipes, tags and everything else are never read, stored or returned. This replaced a first, sales-derived version of the adapter (same day) that was incomplete by design; no `/sales` code remains in the catalog.

**Owner decisions (2026-11-07):** inactive and deleted products must not be selectable, and only the **POS Department** group is shown. Implemented in `normalizeCatalog`: products with `status !== true` or `isDeleted === true` are excluded (counted in `meta.scan.excludedInactive`); only `departments[]` entries whose `departmentGroupName` is "POS Department" (case-insensitive; adapter option `departmentGroup`) are used, other groups such as "Reporting" are ignored; an entry with no group name is flagged `INVALID_DEPARTMENT_ENTRY`, not guessed. Product DTO no longer has `active`/`deleted`. Stored payloads without `scan.departmentGroup` are ignored and refetched.

**Behaviour**

- First `GET` with nothing stored fetches `/products`, stores the normalized catalog in `catalogCache` (`GAAP_UNITY`, key `catalog`) and serves it. Every later read, page reload or server restart is served from MongoDB with no GAAP call. `POST /api/v1/catalog/refresh` is the only way to call GAAP again; a failed refresh keeps the old data.
- Stored payloads must carry `scan.source === 'products'`, so a payload from the earlier sales-derived version is ignored and refetched.

**Files created/changed** (all under `backend/src/` unless noted)

- `modules/gaap/catalog.adapter.js` — `createCatalogAdapter({ client, pageSize 1000, maxPages 50 })` → `fetchCatalog()`: pages `/products` by `limit`/`skip`, stops on a short page (never trusts `totalRecords`), pure `normalizeCatalog`. `complete` is false only if the page cap truncated.
- `modules/gaap/fixtures/catalog.fixture.js` — labelled FIXTURE records in the supplied shape (invented ids, with pricing/recipe fields that must not leak).
- `modules/cache/catalog-cache.repository.js`, `catalog-cache.config.js` — one document; env `CATALOG_CACHE_TTL_HOURS` (1–720, default 24) only labels fresh/stale/`expired`.
- `modules/catalog/catalog.service.js` (+ `support/catalog-memory-repository.js` test double) — DB-first reads, single-flight GAAP fetch, save failure returns data flagged `persisted: false`, DB read failure falls back to GAAP.
- `controllers/catalog.controller.js`, `routes/catalog.routes.js`, `routes/index.js`, `server.js`, `modules/*/index.js`, `README.md` (Catalog section), `.env.example`.
- Tests: `catalog.adapter.test.js`, `catalog.service.test.js`, `catalog.routes.test.js`, `catalog-cache.repository.test.js` (real local MongoDB).

**API** (`/api/v1/catalog`; no auth, per scope)

- `GET /departments`, `GET /departments/:departmentId/products` (404 `DEPARTMENT_NOT_FOUND`), `GET /products/unmapped`, `POST /refresh`. `limit` 1–1000 (default 100), `offset` ≥ 0; invalid → 400 `INVALID_QUERY` / `INVALID_DEPARTMENT_ID`.
- Department: `id`, `name`, `groupId`, `groupName`, `productCount`, `warnings`. Product: `id`, `name`, `code`, `departmentIds`, `mapped`, `warnings`. Lists sorted by name (natural, case-insensitive, unnamed last) then id. Inactive and deleted products are excluded.
- Products with no usable department: `mapped: false`, warning `UNMAPPED_DEPARTMENT`, listed at `/products/unmapped` and in no department list. Duplicate product `_id`: first kept, rest in `meta.malformed` as `DUPLICATE_ID`. Department name/group conflicts get warnings with a deterministic (alphabetically first) pick.

**Verification evidence (2026-11-07, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `npm test` (root) | Pass: backend 281/281 (0 skipped), frontend 98/98 |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass |
| **Live (re-run after the owner decisions)**: 7 GAAP calls, 6613 scanned, 367 inactive/deleted excluded, 6246 products, 161 departments all in "POS Department", **3891 products (62%) have no POS department** (listed as unmapped), `complete: true`; reload served from the database with 0 further calls. Earlier run before the filters: see next row. |
| **Live** (earlier, before filters): real GAAP client + adapter + service + real repository on an isolated local MongoDB database (scratch script, key from git-ignored `sample.js`, counts only, DB dropped afterwards) | First read: 1 fetch of 7 pages, 6613 products, 0 malformed/duplicates, 44 unmapped, `complete: true`, stored. Second read through a new service instance: origin `database`, 0 GAAP calls, identical items. Department products total equals the department's `productCount`. API key absent from all output. |

Acceptance mapping: department browse (service + route tests, paging, 404, empty catalog, live); product IDs stable (one entry per `_id`, same output for reordered input and across refreshes, and live across two reads); unknown mapping visible (`mapped: false`, warning, `/products/unmapped`, `meta.unmappedProductCount`, live count 44); sorting, empty catalogs and duplicate IDs covered in adapter/service tests.

**Checks not run / limitations**

- Live run covered the service layer with a real GAAP call and real MongoDB; the Express routes were exercised only with scripted fixtures, and the full server process and browser were not run. Atlas/Railway MongoDB not checked.
- `skip` paging is inferred to work (7 pages gave 6613 distinct ids, no duplicates); GAAP ordering across pages is not guaranteed, so a product could in theory be missed if GAAP reorders mid-scan. `totalRecords` meaning on `/products` is untested and unused.
- Historical sales of products that are now inactive/deleted cannot be selected by product in a report; Feature 14 must decide how such lines appear. 62% of active products have no POS department (likely stock/ingredient items with only a Reporting department; not verified), so the unmapped list is large. Product `nodeId` (a single root-like node) is ignored; brand definition is still open for Feature 10.
- Group ⊃ department is read from field names. The browsed group is fixed to POS Department by owner decision.
- The `/products` response is large (about 6.6k records over 7 pages); a first load takes several seconds and may be rate-limited (an earlier `/sales` scan was rate-limited with HTTP 429; `/products` was not).
- No frontend wiring (Generate Report pickers still use `DEMO-*` fixtures); no automatic refresh.
- Server start also reads the optional `CATALOG_CACHE_TTL_HOURS`; an invalid value aborts startup.

### Feature 08: Catalog Source Verification — Done and approved (2026-11-07)

Documentation/discovery only; no application code changed. Full write-up: `docs/gaap-catalog-source.md`.

**Files created/changed**

- `docs/gaap-catalog-source.md` (new) — source field map, department hierarchy, brand-to-node mapping, proposed approved sources, filter findings, blockers.
- `context/progress-tracker.md` (this file).

**Resolved (observed live, 2026-11-07; one day of data, field paths/types/counts only, nothing stored)**

- No GAAP API docs exist in the repo; only `/nodes` and `/sales` were called. **No other endpoint was probed or assumed.**
- Node hierarchy is exactly two levels: 8 roots, 241 children. Child `parent` = `nodeId` = `path[0]` = a root `_id`. `sales[].nodeId` equals a node `_id` (confirms `id = _id`).
- Product ID is `items[].product._id` (100% of lines); `productId`/`product.id` are absent on lines.
- Departments exist only embedded in lines: `product.departments[]`, always 2 entries of `{groupId, group, departmentId, department}`; sample had 2 groups and 11 departments, each department under one group (group ⊃ department is an inference).
- `/sales` `totalRecords` equals the page size, not the match count (Feature 14 must not use it for completeness).
- `items.product.departments.departmentId` server-side `eq` filter returned 0 records, so it is unusable; unknown paths are accepted without error. `nodeId eq` works.
- **Security:** `/nodes` records include `integrationConfig` credentials (api keys, passwords, tokens). The Feature 07 whitelist DTO drops them; later code must never pass raw nodes through. Owner should know the API key can read them.

**Blocked (need owner/GAAP input)**

1. Product master source (no verified endpoint; sales-derived lists omit unsold products).
2. Department master source, hierarchy direction, meaning of two entries per product.
3. Whether the 8 root nodes are the brands (or an owner-approved configured mapping).
4. Working server-side filter path for department; product filter unverified here.
5. Coverage: one tenant, one day, 300 sales; refunds, other statuses and dates unexamined.

**Verification evidence (2026-11-07)**

| Command / check | Result |
| --- | --- |
| Live read-only probes of `GET /nodes` and `GET /sales` (scratch scripts outside the repo; key read from git-ignored `sample.js`, never printed) | Results above |
| Scan of the doc and tracker for the `sample.js` key literal | 0 matches |
| `npm test` (root) | Pass: frontend 82/82, backend 204/204 |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass |

**Checks not run / limitations**

- No automated tests were added (no code). Findings are live observations, not fixtures; they cover one day of one tenant.
- MongoDB and Railway were not involved.
- The exposed key in `sample.js` is still unrotated (see Open Questions).

### Feature 07: GAAP Nodes Retrieval — Done and approved (2026-11-07)

**Verified GAAP `GET /nodes` mapping** (one live read-only call on 2026-11-07, 249 records; structure only was recorded, no data kept)

- Response is `{ totalRecords: number, data: Record[] }`. `limit` (1000 accepted) and `skip` work; `skip` past the end returns an empty `data`. No `sort` was tried, so none is sent.
- `_id` is a unique string on all 249 records. **`nodeId` is not unique** (8 distinct values; it equals `parent` for 241 children and `_id` for 8 top-level records). `sample.js` keys stores by `nodeId || _id`, which would collapse 249 stores into 8, so the normalized `id` is `_id`.
- `tradingDetails.name` is on all 249 records; top-level `name` is on 1 and differs from it (a generic label). Name = `tradingDetails.name`, else `name`, else null; a conflict gives a `NAME_CONFLICT` warning (1 live record has it).
- `status` is a string code (`"1"`, `"3"`); `nodeType` was `admin` on every record; `baseCurrency` was `USD` or `ZWL`. Their meanings are **not** verified and are not mapped (`status` is passed through raw as `sourceStatus`).
- The 8 top-level records have names that look like brands, but nothing in the payload states a brand relationship. **No brand field is produced.** Feature 08/10 must decide how brand relates to nodes.

**Files created/changed** (all under `backend/` unless noted)

- `src/modules/gaap/nodes.adapter.js` — `createNodesAdapter({ client })` → `fetchNodes({ signal, requestId })`: pages by `limit`/`skip` (1000 per page, max 10 pages), reads `totalRecords`, normalizes (pure `normalizeNodes`), de-duplicates by `_id`, sorts by name (natural order, unnamed last) then id. Returns `nodes`, `malformed` (index, reason, id only), `rawCount`, `upstreamTotal`, `complete`, `fetchedAt`.
- `src/modules/gaap/fixtures/nodes.fixture.js` — labelled FIXTURE payload builders (invented ids and names, live shape).
- `src/modules/catalog/nodes.service.js`, `index.js` — `createNodesService` → `listNodes({ limit, offset })`: paging over the normalized list plus `meta`.
- `src/controllers/nodes.controller.js` — `parseNodesQuery` (strict `limit` 1–1000 default 500, `offset` ≥ 0, unknown/repeated/non-integer rejected with 400 `INVALID_QUERY`), handler aborts the GAAP fetch if the client disconnects.
- `src/routes/nodes.routes.js`, `src/routes/index.js` (now `createApiV1Router(services)`; routes mount only for services provided), `src/app.js` (`createApp(config, services = {})`), `src/utils/gaap-api-error.js` (GaapError → 504 `GAAP_TIMEOUT` / 503 `GAAP_UNAVAILABLE` / 502 `GAAP_UPSTREAM_ERROR`; GAAP 401/403 become 502, never 401/403).
- `src/server.js` — loads `loadGaapConfig()` at startup (fails fast), builds client → adapter → service and passes them to `createApp`. **`GAAP_API_KEY` and `GAAP_API_BASE_URL` are now required to start the backend.**
- Tests: `nodes.adapter.test.js`, `routes/nodes.routes.test.js` (62 tests). `README.md` (Nodes section), `.env.example` comment.

**Behaviour contracts**

- Node DTO: `id`, `name`, `parentId`, `sourceNodeId`, `sourceStatus`, `warnings`. No brand, currency or other field.
- Malformed (excluded and listed in `meta.malformed`, request still 200): non-object record, missing/blank/non-string `_id`, duplicate `_id` (first kept). Wrongly typed optional fields become null with a warning on the node. Malformed payloads are never echoed.
- `meta.complete` is false if the page cap is hit or GAAP's `totalRecords` exceeds what was returned; consumers must not treat such a list as full.
- A response without a `data` array (or a non-object body) is `GAAP_INVALID_RESPONSE` → 502. Empty `data` is a valid empty list (200).

**Verification evidence (2026-11-07, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test` on the two new files (in `backend/`) | 62/62 pass |
| `npm test` (root) | Pass: frontend 82/82, backend 204/204 (142 existing + 62 new) |
| `npm run lint`, `npm run format:check`, `npm run build` | Pass |
| Mutation check: id taken from `nodeId ?? _id` | 11 tests fail (as intended); restored |
| **Live**, real Express route + real GAAP client (scratch script, key read from git-ignored `sample.js`, never printed) | `GET /nodes` 200, 249 returned, `complete: true`, `upstreamTotal: 249`, 249 unique ids, 0 malformed, 1 `NAME_CONFLICT` warning; identical output on a second call; `?limit=5&offset=10` equals the matching slice; `?limit=0` → 400; unreachable host → 503 `GAAP_UNAVAILABLE`; wrong key → 502 `GAAP_UPSTREAM_ERROR`; key absent from bodies and headers |
| `node src/server.js` without GAAP vars | Logged "Invalid GAAP configuration" (names only), exit 1 |

Acceptance mapping: nodes returned consistently (sorted deterministically, same output for reordered input and on repeat live calls); malformed records flagged (unit and route tests plus `meta.malformed`); no invented brand relationship (DTO key-list test and no brand in output).

**Follow-up (2026-11-07, requested by the user): Generate Report uses fetched nodes**

- `features/reports/nodes-catalog.js` (`buildNodeCatalog`), `use-nodes.js` (`useNodes`, calls `GET /api/v1/nodes?limit=1000` through the existing API client), `components/node-selector.jsx` (loading, error with retry, partial-list warning, empty states), `pages/generate-report-page.jsx` (all under `frontend/src/`). Departments and products are still `DEMO-*` fixtures; the Nodes page and mocks are unchanged.
- **Unverified assumption, shown in the UI:** a "brand" is a top-level node (`sourceNodeId === id`) that has children; its nodes are those whose `parentId` equals it. This matches the live payload but GAAP does not state a brand relationship. Top-level nodes without children stay selectable as nodes. Features 08/10 must confirm or replace this.
- Tests: `nodes-catalog.test.js`, updated `pages.test.jsx` (stubbed fetch with FIXTURE nodes). `npm test`: frontend 91/91, backend 204/204; lint, format check and build pass.
- Nodes & Brands page (`pages/nodes-page.jsx`) now uses the same `useNodes` data: brand cards with their nodes, an "Ungrouped nodes" card, loading, error with retry, empty state, incomplete-list and skipped-record warnings. It no longer carries the "Demo / mock" notice (removed from the demo-label test; 4 new page tests). Frontend now 94/94. `mocks/catalog.js` brands/nodes are no longer used by any page.
- **Nodes stored in MongoDB (user request, 2026-11-07):** `GET /api/v1/nodes` now reads the stored copy; GAAP is called only when nothing is stored or on the new `POST /api/v1/nodes/refresh`. Files (backend): `modules/cache/` (`nodes-cache.repository.js` on the existing `CatalogCache` model, `nodes-cache.config.js` for `NODES_CACHE_TTL_HOURS`, default 24), `modules/catalog/nodes.service.js` (rewritten: single-flight GAAP fetch, store, stale/incomplete labels, refresh keeps old data on failure, save failure returns data flagged `persisted: false`, DB read failure falls back to GAAP), `controllers/nodes.controller.js` (request-abort wiring removed since fetches are now shared), `routes/nodes.routes.js`, `server.js`, tests `nodes.service.test.js`, `nodes-cache.repository.test.js` (real local MongoDB), updated route tests, `support/memory-repository.js`. Frontend: `use-nodes.js` (`refresh()`), `components/nodes-provenance.jsx`, Refresh from GAAP button and provenance on the Nodes page, provenance line in the Generate Report node panel.
- Design choices: only normalized fields are stored, never raw records (the live payload's `integrationConfig` contains credentials; a user-pasted sample showed the same). Stale data is served rather than refetched, as requested; freshness is always shown. Stored payload is validated on read; a corrupt document is ignored and refetched.
- Evidence: `npm test` backend 228/228 (0 skipped), frontend 98/98; lint, format check, build pass. Live scratch run (real GAAP + isolated local MongoDB database, dropped afterwards): first GET 1 GAAP call and 249 nodes stored; second GET and a GET through a second service instance ("restart") 0 GAAP calls, origin `database`; one stored document, no credential fields; POST refresh 1 GAAP call. Not run: the full server process with the browser, Atlas/Railway MongoDB.
- Limitation: no automatic refresh; stale nodes stay until someone presses Refresh (or a later feature adds a scheduled job). Multiple backend replicas are safe (one document, upsert), but single-flight merging is per process.
- Payload note (user-supplied sample): `path` holds ancestor objects; the company root "Simbisa Brands Zimbabwe" (`parent "-1"`) never appears in the `/nodes` list, brands have it as `parent`, stores have the brand as `parent`. This supports the brand-grouping assumption but is still not an explicit GAAP brand field.
- Not done: no browser/visual check, and the full frontend-to-backend path was not exercised live (an attempt to start the server for that was blocked). The backend route itself was live-verified earlier.

**Checks not run / limitations**

- Live evidence covers the happy path, an unreachable host and an invalid key only. GAAP's real timeout, 429 and 5xx behaviour, and whether it returns malformed node records, were not observed; those paths are fixture-only.
- Live check was run from a scratch script, not by starting the full server (it also needs MongoDB). The route test suite runs the full stack with a scripted Axios adapter.
- `skip` paging was seen to work, but result order across pages is not guaranteed by GAAP (no `sort` verified); we de-duplicate and sort afterwards, but a node could in theory be skipped if GAAP reorders between pages. `complete` only catches a count mismatch.
- No caching: each request calls GAAP (1 page today, up to 10). Cache and freshness arrive with Feature 19.
- Meaning of `status` (`"1"` vs `"3"`), `nodeId`, `nodeType`, and `baseCurrency` (incl. `ZWL` vs the `ZWG` named in the docs) is unverified. Inactive (`status "3"`) nodes are returned, not filtered.
- The frontend Nodes page still shows `DEMO-*` data; wiring it is a later feature.

### Feature 06: GAAP HTTP Client — Done and approved (2026-11-07)

**Files created/changed** (all under `backend/` unless noted)

- `src/modules/gaap/gaap.config.js` — `loadGaapConfig`: requires `GAAP_API_KEY` and `GAAP_API_BASE_URL` (https only; http allowed for loopback test servers; no credentials/query in the URL). Optional `GAAP_TIMEOUT_MS` (30000), `GAAP_MAX_CONCURRENCY` (3), `GAAP_MAX_RETRIES` (2), `GAAP_RETRY_BASE_DELAY_MS` (250). `apiKey` is non-enumerable; error messages never contain it.
- `src/modules/gaap/gaap.errors.js` — `GaapError` (`code`, `status`, `retryable`, `attempts`, `method`, `path`) and `GAAP_ERROR_CODES`. No URL, query, body, headers or Axios error is carried.
- `src/modules/gaap/gaap.client.js` — `createGaapClient({ config })` → `request({ method, path, params, data, signal, requestId, idempotent })` and `get`. Axios instance with per-attempt timeout, FIFO semaphore for bounded concurrency, bounded retry with exponential backoff + jitter + capped `Retry-After`, redacted structured logging (method, path, status, code, attempts, duration only), `maxRedirects: 0`, response size cap, JSON object/array body validation.
- `src/modules/gaap/index.js` — module exports.
- Tests: `gaap.config.test.js`, `gaap.client.test.js` (67 tests total for the module).
- `package.json` + `package-lock.json` (+ `axios`), `.env.example` (GAAP vars documented), `README.md` (GAAP HTTP client section).

**Behaviour contracts**

- Auth is the `apikey` query parameter (taken from the existing, git-ignored `sample.js`; key value never copied). Because of this, URLs/query values are never logged or put in errors, redirects are not followed (they would forward the key), absolute/`//`/`?`/`..` paths and a caller-supplied `apikey` param are rejected before any request, and array/null params are rejected (GAAP array encoding is unverified).
- Retryable: timeouts, network errors, HTTP 408/429/502/503/504. Not retried: 401/403, 404, other 4xx, other 5xx (incl. 500), invalid/non-JSON/empty 200 bodies, 3xx, oversize responses, cancellation. Only GET/HEAD/OPTIONS retry unless `idempotent: true`. Max attempts = `GAAP_MAX_RETRIES + 1`.
- Endpoint-agnostic: no `/nodes`, `/sales` or other GAAP paths, field names or currency/transaction rules are in this module.

**Verification evidence (2026-11-07, Node v22.22.0)**

| Command / check | Result |
| --- | --- |
| `node --test src/modules/gaap/*.test.js` (in `backend/`) | 67/67 pass |
| `npm test` (root) | Pass: frontend 82/82, backend 142/142 (75 existing + 67 new; DB tests ran against local MongoDB) |
| `npm run lint`, `npm run format:check` | Pass |
| `npm run build` | Pass (frontend; backend has no build step) |
| Mutation check: `maxRedirects: 5` | Redirect test fails (as intended); restored |
| Mutation check: retry cap removed | Suite fails/hangs (as intended); restored |
| Key scan: `frontend/src`, `frontend/dist`, `backend/src`, tracked files for the `sample.js` key literal and `apikey`/`GAAP_API_KEY` in frontend | No matches |

Acceptance mapping: no GAAP key in frontend (scan above; module is backend-only and nothing imports it from the browser); errors normalized (every failure is a `GaapError` with a stable code; tests cover 400/401/403/404/422/500/501, 3xx, invalid bodies, timeout, network, abort, and non-Axios errors; key-leak assertions on message, stack, JSON, cause and captured logs); retry bounded (tests for 0, 2 and 5 retries, exact call counts, capped backoff, `Retry-After` cap, POST not retried, abort during backoff).

**Checks not run / limitations (all tests are fixture-only)**

- **No live GAAP call was made.** Tests use a scripted Axios adapter (clearly labelled FIXTURE) and a loopback HTTP server on 127.0.0.1 (real Axios timeout/redirect/refused-connection behaviour). Neither proves how GAAP responds. The real status codes, error body shapes, rate-limit headers (`Retry-After`), whether 500 is ever transient, pagination, and whether GAAP accepts the key only as a query parameter are unverified.
- Not wired into `server.js`: startup does not require GAAP variables yet, so existing `npm run dev` setups keep working. Call `loadGaapConfig()` when the first consumer (the endpoint adapters) is built, so it fails fast there.
- No readiness check for GAAP, no `/nodes`/`/sales` adapters, no pagination, no response-to-internal-contract mapping (later features).
- Concurrency limit is per client instance (per process), not global across Railway replicas.
- Query array encoding is deliberately unsupported until the GAAP convention is confirmed.
- The exposed key in `sample.js` still needs rotation by the owner (see Open Questions).

### Feature 05: MongoDB Connection and Models — Done and approved (2026-11-07)

**Files created/changed** (all under `backend/` unless noted)

- `src/config/database.js` — `loadDatabaseConfig` (validates `MONGODB_URI`; error messages never contain the value; `uri` is non-enumerable so serializing the config cannot print it), `connectDatabase` (autoIndex off, 5 s server selection timeout, idempotent; failure logs only the error class and throws a sanitized `DatabaseConnectionError`), `disconnectDatabase`, `getDatabaseStatus`, `checkDatabaseReadiness` (open connection + ping; never throws).
- `src/models/` — `report.model.js`, `report-row.model.js`, `catalog-cache.model.js`, `shared.js` (currency and Decimal128 field helpers, `isIsoDate`), `index.js` (`ensureModelIndexes`), `support/mongo-fixture.js` (isolated test DB helpers).
- `src/server.js` — loads config, connects, creates indexes, then listens; exits 1 on any failure; disconnects on shutdown.
- Tests: `src/config/database.test.js`, `src/models/report.model.test.js`, `report-row.model.test.js`, `catalog-cache.model.test.js`.
- `package.json` + `package-lock.json` (+ `mongoose`), `.env.example` (MONGODB_URI now required; optional `MONGODB_TEST_URI`), `README.md` (MongoDB section).

**Model contracts**

- `Report` (`reports`): status pending/completed/failed; `filters` (YYYYMMDD start/end, changed from YYYY-MM-DD by Feature 12 on 2026-11-08, department/product/brand/node/currency id arrays); `totals` one entry per currency (`currency`, `lineCount`, `quantity`, `turnover`); `rowCount`; `provenance` (source, fetchedAt, usedCache, cacheFreshness, complete); `schemaVersion` (1), `calculationVersion`; startedAt/completedAt/failedAt; `error` (code, message, occurredAt); createdAt/updatedAt. Indexes: `createdAt -1`, `status 1`.
- `ReportRow` (`reportRows`): reportId, lineIndex, sourceLineKey, transactionAt, node/product/department/brand ids and names, currency, quantity, turnover, warnings. Indexes: unique `{reportId, lineIndex}`, unique `{reportId, sourceLineKey}`, `{reportId, productId}`, `{reportId, nodeId}`, `{reportId, currency}`.
- `CatalogCache` (`catalogCache`): source (GAAP_UNITY / CONFIGURED_MAPPING), key, payload, fetchedAt, expiresAt, freshness (fresh/stale/incomplete), `isCurrent()`. Indexes: unique `{source, key}`, `expiresAt 1` (not a TTL index; retention is undecided).
- Rules enforced: currency is required and must be a 3-letter upper-case code or `UNKNOWN` (never defaulted); money and quantities are Decimal128 and required (zero, negative and missing stay distinct; NaN/Infinity rejected); duplicate currency totals rejected; completed requires completedAt, fetchedAt, `provenance.complete === true`, rowCount and no error; failed requires failedAt and error.code; cache use requires a freshness label.
- **Completed reports are immutable via Mongoose:** `save()` throws `ReportImmutableError`, and `updateOne/updateMany/findOneAndUpdate/replaceOne/findOneAndReplace` add `status != completed` to the filter, so they match nothing. Pending/failed to completed still works. `Model.collection` or `bulkWrite` bypass this and must not be used for reports.

**Verification evidence (2026-11-07, local MongoDB 8.2.6 at 127.0.0.1:27017, Node v22.22.0)**

| Command / check                                    | Result                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm test -w @simbisa/backend`                     | 75/75 pass, 0 skipped (includes DB integration tests, each in a unique `simbisa_test_*` database dropped afterwards)           |
| `npm test` (root)                                  | Pass: frontend 82/82, backend 75/75                                                                                            |
| `npm run lint`, `npm run format:check`             | Pass                                                                                                                           |
| `npm run build`                                    | Pass (frontend; backend has no build step)                                                                                     |
| `node src/server.js` with no `MONGODB_URI`         | Logged "MONGODB_URI is required", exit 1                                                                                       |
| Same, with `http://u:Sup3rSecret@h/db`             | Logged generic format message, exit 1, secret absent                                                                           |
| Same, with unreachable `mongodb://u:Sup3rSecret@…` | Logged `MongooseServerSelectionTimeoutError` class only, exit 1; output grep for the password: 0 matches                       |
| Live start against `simbisa_verify_live`           | "MongoDB connected", `/api/v1/health` 200; `listIndexes` on all three collections showed every index above; DB dropped         |
| Leftover databases                                 | `listDatabases` after all runs: no `simbisa_*` databases remain                                                                |

Acceptance mapping: database connects (lifecycle tests and live start); models validate (about 40 validation cases, most needing no database); indexes created (asserted via `collection.indexes()` per model and in the live check); no credentials logged (test captures console output on a failed connect with a password URI and asserts the password and username are absent).

**Checks not run / limitations**

- Tested against a local MongoDB 8.2.6 only. Atlas / Railway-managed MongoDB, replica sets, auth and TLS were not exercised, and there is no Railway access.
- No GAAP involvement. The internal field names (`sourceLineKey`, `turnover`, `quantity`, ids) are an internal contract; how GAAP fields map onto them, currency semantics, date-range inclusivity and the reporting timezone remain unverified (see Open Questions). Dates are stored as given, with no timezone assumption.
- No readiness HTTP endpoint was added: the spec asks for readiness checks, and `checkDatabaseReadiness()` exists, but `/api/v1/health` is unchanged (liveness only). Wiring it to a route is left for a later feature.
- Report and row writes are not transactional; the "completed only after consistent rows" ordering is the report service's job (a later feature). The model only validates the report document.
- The server now requires MongoDB at startup, so `npm run dev` needs a reachable `MONGODB_URI` (default in `.env.example` assumes local MongoDB).
- Retention and cache TTL values are not decided; no TTL indexes or cleanup exist.

### Feature 04: Complete UI Shell and All Pages — Done and approved (2026-11-07)

**Files created/changed** (all under `frontend/src/` unless noted)

- `components/ui/` — new shadcn-style primitives (hand-written, CLI not run): `card`, `badge`, `input`, `table` (scroll container is keyboard focusable), `tabs`, `popover`, `tooltip`, `sheet` (mobile drawer), `skeleton`, `alert`.
- `components/layout/` — `app-shell` (collapsible sidebar state, mobile drawer, TooltipProvider), `app-header` (menu/collapse buttons, "Demo data" badge), `app-sidebar` (`SidebarNav`, icon-only collapsed mode with tooltips; hidden below `md`).
- `components/` — `demo-badge` (`DemoBadge`, `DemoNotice`), `not-connected-button`, `currency-tag`, `report-status-badge`, `data-states` (loading skeleton, empty, error).
- `features/reports/` — `filters.js` (pure selection helpers + validation, tested), `components/`: `filter-panel`, `multi-select-list` (search, Select all, Clear), `department-picker`, `product-multiselect`, `node-selector`, `date-range-picker`, `summary-cards`, `results-table` (toolbar, Summary/Detailed tabs, currency filter), `export-action`, `report-provenance`, `report-view`.
- `pages/` — dashboard, generate-report, saved-reports, report-details, product-catalog, nodes, settings. Removed the two placeholder pages. `routes/routes.jsx` now uses them.
- `mocks/` — `catalog.js`, `reports.js` (4 reports: completed with UNKNOWN row, failed, pending, completed), `integrations.js`. All ids are `DEMO-*`; no URLs or keys.
- `lib/format.js` — display-only amount, quantity and UTC timestamp formatting.
- Tests: `pages/pages.test.jsx`, `features/reports/filters.test.js`, `mocks/mocks.test.js`; `routes.test.jsx` updated; `test/setup.js` stubs ResizeObserver etc. for Radix in jsdom.

**Verification evidence (2026-11-07)**

| Command / check | Result |
| --- | --- |
| `npm test` (root) | Pass — frontend 55/55 (7 files), backend 27/27 |
| `npm run lint` | Pass (0 problems) |
| `npm run format:check` | Pass |
| `npm run build` | Pass — CSS 24.5 kB, JS 487 kB |
| Vite dev server (port 5198, since stopped) | `/`, `/reports/new`, `/reports`, `/reports/demo-rpt-001`, `/catalog`, `/nodes`, `/settings` all 200 |
| Source scan | No GAAP calls, no URLs or keys in `frontend/src` (matches are comments/fixture text); the only network code is the existing `/api` client, which no page calls |

Acceptance mapping: all pages route (routes + pages tests, incl. unknown report id and 404); no GAAP calls (scan, nothing uses the API client); no misleading controls (Generate Report, Re-generate and Download Excel are disabled with a visible "Not connected" badge; test asserts no success message; Settings has no inputs/buttons); every page shows "Demo / mock" plus a header "Demo data" badge; currencies never combined (separate cards and rows, UNKNOWN flagged, fixture totals checked per currency); loading/empty/error views covered (pending report, no-match search, failed report); keyboard (skip link → menu button, Enter on a sidebar link); responsive behaviour (collapse, drawer) covered by jsdom tests.

**Checks not run / limitations**

- **Visual check (post-approval, 2026-11-07):** headless Chrome screenshots at 1280, 820 and 500px px looked correct (header, sidebar, filter grid, report cards). The check found and fixed a real bug: sidebar links lost their styling because `TooltipTrigger asChild` overwrote NavLink's `className` function; fixed with a wrapper `div`. Headless Chrome cannot go below ~500px, so true 375px and the open mobile drawer were not screenshotted (drawer is covered by a jsdom test only).
- No GAAP, MongoDB, Railway or backend access; everything is fixture-only and is not live-integration evidence.
- Sticky table header, long-table behaviour and virtualization/pagination are not exercised (fixtures are tiny).
- Column-visibility control from ui-context.md was not built (not in the spec's task list).
- Department/product pickers are inline lists, not Popover/Command dropdowns; the Popover primitive is added but unused.
- Dev-only: Dashboard "latest report" sorting and counts are simple fixture displays, not report calculations.

### Feature 03: Frontend Foundation — Done (2026-11-07)

**Files created/changed**

- `frontend/vite.config.js` — Tailwind v4 Vite plugin, `@` alias to `src`, jsdom Vitest environment with setup file; dev proxy kept.
- `frontend/jsconfig.json`, `frontend/components.json` — alias and shadcn/ui CLI config (JavaScript, new-york style, CSS file `src/styles/globals.css`).
- `frontend/src/styles/globals.css` — all 19 `ui-context.md` tokens as CSS variables, shadcn/ui variables mapped onto them, Tailwind `@theme inline` semantic utilities, dark-only, accent focus ring. Replaces `src/index.css`.
- `frontend/src/main.jsx` — `createBrowserRouter` + `RouterProvider`.
- `frontend/src/routes/paths.js` (path constants, sidebar items), `routes.jsx` (route tree, shared with tests).
- `frontend/src/components/layout/` — `app-shell.jsx` (header, sidebar, main slot, skip link), `app-header.jsx`, `app-sidebar.jsx`, `page-layout.jsx` (title/description/actions slots).
- `frontend/src/components/error-boundary.jsx`, `error-fallback.jsx` — page-level boundary and router `errorElement`; no error detail shown to users.
- `frontend/src/components/ui/button.jsx` — first shadcn/ui primitive (hand-written to the shadcn pattern; the CLI was not run).
- `frontend/src/lib/utils.js` (`cn`), `api-client.js` (`createApiClient`, `ApiClientError`, envelope parsing, timeout, cancellation).
- `frontend/src/pages/` — `placeholder-page.jsx`, `report-details-placeholder.jsx`, `not-found-page.jsx`.
- Tests: `routes/routes.test.jsx`, `components/error-boundary.test.jsx`, `lib/api-client.test.js`, `styles/theme-tokens.test.js`, setup in `test/setup.js`. Removed the bootstrap `App.jsx`/`App.test.jsx`.
- `eslint.config.js` (react-refresh rule off for `components/ui/`), `frontend/package.json`, `package-lock.json`, `README.md` (Frontend section).

**Dependencies**

- runtime: react-router, tailwindcss, @tailwindcss/vite, class-variance-authority, clsx, tailwind-merge, lucide-react, radix-ui, tw-animate-css.
- dev: jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom.

**Verification evidence (2026-11-07)**

| Command / check | Result |
| --- | --- |
| `npm test -w @simbisa/frontend` | 34/34 pass (4 files) |
| `npm test` (root) | Pass — frontend 34/34, backend 27/27 |
| `npm run lint` | Pass (0 problems) |
| `npm run format:check` | Pass |
| `npm run build` | Pass — `vite build`, CSS 17.9 kB, JS 357 kB |
| Built CSS inspection | Contains `--bg-base:#363640`, `--accent-primary:#00a9f4`, `bg-surface`, `text-text-muted`, `bg-sidebar`, `border-accent-primary` |
| Live `vite` dev server (port 5199) | `/`, `/reports/new`, `/does-not-exist`, `/src/main.jsx`, `/src/styles/globals.css` all 200 |
| Secret scan of `frontend/src` | No keys; only comments and warnings mention GAAP |

Acceptance mapping: navigation renders (routes test checks header and all six links, active state, click navigation); dark theme uses tokens (token test compares every `ui-context.md` value with the stylesheet, requires dark-only, and rejects hex values outside the token block); frontend builds.

Failure and invalid-input cases covered: unknown and nested unknown routes render the 404 inside the shell; render errors show a generic fallback without leaking the message and recover on retry; API client covers error envelope, non-envelope errors, empty/non-JSON/missing-data 200s, network failure, timeout and caller cancellation.

**Checks not run / limitations**

- No browser visual check or screenshot was taken. Rendering is evidenced by jsdom tests, the build, and HTTP 200s from the dev server only.
- API client is tested with a stubbed `fetch`; it has not been called against the live backend (no page uses it yet).
- Sidebar is fixed-width and not collapsible, and there is no mobile drawer. These belong to Feature 04.
- No GAAP, MongoDB or Railway access was used. Nothing here is live-integration evidence.
- The shadcn CLI was not run; the Button primitive follows its output format by hand. Re-add via CLI if exact parity is wanted.

### Feature 02: Backend Foundation — Done (2026-11-07)

**Files created/changed**

- `backend/src/app.js` — `createApp(config)`: request ID → CORS allowlist → `express.json` with size limit → `/api/v1` router → 404 → centralized error handler.
- `backend/src/server.js` — validates config at startup (exit 1 on invalid), graceful SIGTERM/SIGINT shutdown.
- `backend/src/config/env.js` — `loadConfig`: NODE_ENV, PORT, CORS_ORIGIN (comma list, exact http(s) origins, required in production), JSON_BODY_LIMIT (default 100kb).
- `backend/src/routes/index.js`, `backend/src/routes/health.routes.js` — `GET /api/v1/health`.
- `backend/src/controllers/health.controller.js`, `backend/src/modules/system/health.service.js` — health payload is status, uptimeSeconds and timestamp only.
- `backend/src/middleware/` — `request-id.js`, `cors.js`, `not-found.js`, `error-handler.js`.
- `backend/src/utils/` — `http-response.js` (`sendSuccess`, `sendError`), `api-error.js` (`ApiError`), `logger.js` (structured JSON logs).
- Tests: `backend/src/app.test.js`, `backend/src/config/env.test.js`, `backend/src/middleware/error-handler.test.js` (replaced the Feature 01 smoke test).
- `backend/package.json` (+ cors, dev + supertest), `package-lock.json`, `backend/.env.example` (+ JSON_BODY_LIMIT), `README.md` (Backend API section).

**Verification evidence (2026-11-07)**

| Command / check | Result |
| --- | --- |
| `npm test -w @simbisa/backend` | 27/27 pass |
| `npm test` (root) | Pass — frontend 1/1, backend 27/27 |
| `npm run lint` | Pass (0 problems) |
| `npm run format:check` | Pass |
| `npm run build` | Pass (frontend; backend has no build step) |
| Live `npm run dev`, `GET :4000/api/v1/health` | 200, `{"data":{"status":"ok",...},"meta":{}}`, X-Request-Id set |
| Live `GET :5173/api/v1/health` (Vite proxy) | 200 |
| Live `GET /api/v1/nope` | 404 `NOT_FOUND` envelope |
| Live `POST` with body `{bad` | 400 `INVALID_JSON` envelope |
| Live request with `Origin: https://evil.example` | 403 `CORS_ORIGIN_NOT_ALLOWED` |
| `PORT=abc node src/server.js` | Logged "Invalid configuration", exit code 1 |

Automated cases covered: health 200 and exact payload keys; request ID generation, reuse and sanitizing; 404 for root, unknown v1 path, v2 path and unsupported method; invalid JSON 400 with no parser details leaked; oversized body 413; empty body; CORS allowed origin, preflight 204, rejected origin 403, no-Origin requests; ApiError mapping; unexpected error → generic 500 with secret-looking message not leaked and request ID logged; config defaults, parsing, frozen result and seven invalid inputs.

**Checks not run / limitations**

- No MongoDB, GAAP or Railway involvement. Health is liveness only; it does not check MongoDB (Feature 05) or GAAP (Feature 06).
- Rate limiting and secure HTTP headers (e.g. helmet), recommended in code-standards.md, were not in this spec and are not implemented. See Open Questions.

### Feature 01: Project Bootstrap — Done (2026-11-07)

**Files created/changed**

- Root: `package.json` (npm workspaces: frontend, backend, shared), `package-lock.json`, `eslint.config.js` (single shared ESLint flat config), `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.gitattributes`, `.env.example`, `README.md`.
- `frontend/`: Vite + React (JavaScript) scaffold reduced to a placeholder page — `package.json`, `index.html`, `vite.config.js` (dev proxy `/api` → backend), `src/main.jsx`, `src/App.jsx`, `src/App.test.jsx`, `src/index.css`, `public/favicon.svg`, `.env.example`.
- `backend/`: Express 5 (ES modules) — `package.json`, `src/app.js` (`createApp`), `src/server.js`, `src/app.test.js`, `.env.example`.
- `shared/`: `package.json`, `src/index.js` (empty export), `README.md`.
- `docs/README.md`, `feature-specs/README.md`.
- Git repository initialized (`main`); none existed before.

**Dependencies**

- frontend runtime: react, react-dom. dev: vite, @vitejs/plugin-react, vitest.
- backend runtime: express. (axios, mongoose, exceljs deferred to the features that need them.)
- root dev: eslint, @eslint/js, globals, eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint-config-prettier, prettier, concurrently.

**Verification evidence (2026-11-07, Node v22.22.0, npm 10.9.4)**

| Command | Result |
| --- | --- |
| `npm run lint` | Pass (0 problems) |
| `npm run lint --workspaces --if-present` | Pass in frontend, backend, shared |
| `npm run format:check` | Pass |
| `npm test` | Pass — frontend Vitest 1/1, backend `node --test` 1/1 |
| `npm run build` | Pass — frontend `vite build` produced `frontend/dist` |
| `npm run dev` | Both started: frontend http://localhost:5173 → 200; backend http://localhost:4000 → 404 (expected, no routes until Feature 02); Vite `/api` proxy reaches backend |
| `git status` / `git grep` on staged files | No `.env`, `node_modules`, `dist`, `sample.js` or GAAP key tracked |

**Checks not run / limitations**

- Backend and shared have no build step; root `build` runs only workspaces that define one.
- No GAAP, MongoDB or Railway access was used or required. Nothing here is live-integration evidence.
- Failure/invalid-input cases: not applicable yet (no endpoints or inputs exist).

## In Progress

- None. Feature 15 approved; awaiting the next spec.

## Next Up

- Feature 16 (Currency Classification) when specified. It consumes `currencySource` from the normalized lines.

- Owner answers on the GAAP createdDate boundary and max range (timezone, format and future dates are decided) / `createdDate` boundary / max range, then the next feature spec.
- Owner confirmation of the brand definition, owner answers to Feature 08 blockers, then the next feature spec.

## Open Questions

- **Unverified assumptions (blockers for real integration):** GAAP `createdDate` boundary inclusivity (reporting timezone is now decided: Africa/Harare); real department/product/brand/node discovery; GAAP currency field semantics. The UI states these as unconfirmed and uses only `DEMO-*` fixtures.

- **Security headers and rate limiting:** code-standards.md asks for secure HTTP headers and rate limiting before login exists, but no feature spec through 02 covers them. Decide whether to add them (e.g. helmet plus express-rate-limit) in Feature 28 or Feature 30, or as a small dedicated unit.
- **Exposed GAAP API key (security blocker for go-live):** root `sample.js` contains a hardcoded GAAP API key. It is git-ignored and was not committed, but architecture.md requires rotating any previously exposed key. Owner must rotate it and decide whether to delete `sample.js` or move its logic to reference docs without the key.
- **Spec folder location:** Feature 01 asks for `feature-specs/` and `docs/`, but specs live in `features/` and context docs in `context/` (as CLAUDE.md references). Folders were created with pointer READMEs; nothing was moved. Decide which location is canonical.
- **Dev-dependency audit:** `npm audit` reports 4 moderate findings (minimatch ReDoS) via eslint 10 tooling. Dev-only, not shipped. The only automatic fix downgrades ESLint to 9. Revisit when upstream patches.

## Architecture Decisions

- **GAAP client design:** one `GaapError` type with stable codes; the Axios error is never attached (its config holds the `apikey` query param). Redirects disabled. Retry only for timeouts/network/408/429/502/503/504 on idempotent requests. GAAP config is validated by `loadGaapConfig()` separately from `loadConfig`, and not yet required at startup.
- **Error envelope includes `requestId`:** `{ error: { code, message, requestId } }`. Extends the suggested shape in code-standards.md so users can quote an ID that matches server logs. Success envelope is exactly `{ data, meta }`.
- **CORS rejects disallowed origins with 403 `CORS_ORIGIN_NOT_ALLOWED`** instead of silently omitting headers. Requests with no Origin header (same-origin, curl, Railway health checks) are allowed.
- **Unsupported methods on known paths return the normalized 404**, not 405, to keep one predictable shape. Revisit if clients need 405 + Allow.
- **Only `ApiError` messages reach clients;** every other error becomes `INTERNAL_ERROR` and is logged server-side with the request ID.
- **Config validated once at startup** (`loadConfig`) and injected into `createApp`, so tests build apps with explicit config instead of mutating `process.env`.
- **supertest** added as the backend HTTP test helper alongside `node --test`.
- **npm workspaces monorepo** (`frontend`, `backend`, `shared`) with a single root lockfile — matches the approved monorepo architecture.
- **ESLint (flat config) + Prettier at the root** as the single shared configuration, replacing the oxlint default from create-vite — code-standards.md mandates ESLint and Prettier.
- **ES modules everywhere** (`"type": "module"`) — code-standards.md.
- **Backend env loading via Node's `--env-file-if-exists`** instead of dotenv — avoids an extra dependency; requires Node ≥ 22.9 (declared in `engines`).
- **Test runners:** Vitest for the frontend (shares Vite config), built-in `node --test` for the backend. Feature 02 may add supertest.
- **Vite dev proxy** sends `/api` to the backend so the browser only talks to the app's own API.

- **Tailwind v4 with CSS-first config:** no `tailwind.config.js`; tokens map to utilities in `globals.css` via `@theme inline`. `ui-context.md` token names are kept verbatim, with shadcn variables aliasing them.
- **`@` import alias** for `frontend/src` (Vite alias + jsconfig), matching shadcn/ui conventions.
- **React Router data router** (`createBrowserRouter`); the route tree is exported so tests use `createMemoryRouter` on the same routes.
- **Frontend tests run in jsdom** with Testing Library; the token test opts into the node environment.
- **Page routes:** `/`, `/reports/new`, `/reports`, `/reports/:reportId`, `/catalog`, `/nodes`, `/settings`, plus `*` for 404. Taken from the page list in Feature 04; revisit if that spec changes them.

- **Mongoose with explicit index creation:** the connection runs with `autoIndex: false`; `ensureModelIndexes()` runs once at startup. Decimal128 for money and quantities; one `reportRows` collection linked by `reportId`; completed-report immutability enforced in model middleware.
- **Backend requires MongoDB at startup** (fail fast, per code-standards.md). `MONGODB_URI` is validated separately from `loadConfig` in `config/database.js`, so existing config tests and the injected-config `createApp` are unchanged.

## Session Notes
- 2026-11-08: Feature 15 implemented and approved by the user (sales-line normalizer, decimal-string helper, fixtures, live read-only field probes). No later feature started.
- 2026-11-08: Feature 14 implemented (sales paging adapter, fixture tests, one live read-only probe). Awaiting approval. No later feature started.
- 2026-11-08: Feature 13 implemented and approved by the user (POST /api/v1/reports validation, gated execution; fixture-tested). No later feature started.
- 2026-11-08: Feature 12 implemented and approved by the user (YYYYMMDD dates, Africa/Harare, future dates rejected, Feature 05 model aligned). No later feature started.
- 2026-11-08: Features 09, 10 and 11 approved by the user. No later feature started.
- 2026-11-07: Feature 11 implemented (department/product selection wired to the catalog backend, product-id validation endpoint; fixture-tested). Awaiting approval. No later feature started.
- 2026-11-07: Feature 10 implemented (backend filter options/resolve endpoints, three-mode node selector; fixture-tested, brand definition still unconfirmed). Awaiting approval. No later feature started.
- 2026-11-07: Feature 09 implemented (catalog backend on GAAP /products, stored in MongoDB; live service-level check passed). Awaiting approval. No later feature started.

- 2026-11-07: Feature 08 implemented (docs/gaap-catalog-source.md; live read-only discovery; blockers recorded). Approved by the user. No later feature started.
- 2026-11-07: Feature 07 implemented (nodes adapter, GET /api/v1/nodes; live-verified against GAAP /nodes). Approved by the user. No later feature started.
- 2026-11-07: Feature 06 implemented (GAAP Axios client, fixture and loopback tests only; no live GAAP call). Approved by the user. No later feature started.
- 2026-11-07: Feature 01 completed. Tailwind, shadcn/ui, Router (Feature 03) and Express health/CORS/error handling (Feature 02) intentionally not added.
- 2026-11-07: Feature 02 completed. No feature beyond 02 was started.
- 2026-11-07: Feature 03 completed and approved by the user. No feature beyond 03 was started.
- 2026-11-07: Feature 04 implemented (fixture-only UI). Approved by the user. No later feature started.
- 2026-11-07: Feature 05 implemented (MongoDB connection, Report/ReportRow/CatalogCache models, integration tests against local MongoDB). Approved by the user. No later feature started.
- Copy `backend/.env.example` to `backend/.env` for local values; never commit `.env` files.

## Frontend UI cleanup (2026-11-09)
- Removed warning alerts and per-row warnings, and product/node/brand IDs, from all frontend pages (report IDs kept).
- Generate Report: the four filter panels share one viewport-height row on xl screens with internal scrolling; the department card now has a search field.

## Chicken Inn focus, spinner, catalog removal (2026-11-09)
- Frontend node/brand lists (Generate Report + Nodes page) are filtered by `focusChickenInn` in `nodes-catalog.js`: brands named Chicken Inn, plus nodes named Chicken Inn or under those brands. Display-only; backend unchanged. Remove the call in `use-nodes.js` / `use-node-filters.js` to restore all nodes.
- Generate Report shows a spinning loader on the button and in the status panel while submitting/pending.
- Product Catalog page, route, nav item and dashboard shortcut removed (`mocks/catalog.js` kept; still used by `mocks/reports.js`).

## Saved reports, Excel download, report names (2026-11-09)
- Download Excel now calls GET /api/v1/reports/:id/export and saves the workbook (enabled only for completed reports).
- Saved Reports table: no horizontal scroll; Report ID/Source data columns replaced by a name column, freshness under Generated at, and an eye icon to open the report.
- Reports get a display `name` ("<node> - <product> sales", first saved line plus "+N more") built at read time in `report-name.js`; returned by list and detail endpoints. Not stored.

## Cancel report generation (2026-11-09)
- New `DELETE /api/v1/reports/:reportId` cancels a PENDING report: aborts its job (abort reason `cancelled`), deletes the report and any rows, so a cancelled report is never saved. Completed/failed reports answer 409 REPORT_NOT_CANCELLABLE. Wired via `execution.cancelReport` -> `service.cancelReport` -> `repository.discardPending`.
- Generate Report page has a Cancel button while submitting/pending; cancelling during the POST waits for the report id, then deletes it.

## Railway deployment prep (2026-11-09)
- Added `railway.json` (build `npm run build`, start `node scripts/start.js`). Single service: backend on a private port, built frontend served on Railway's `PORT` with `/api` proxied.
- README "Render deployment" replaced by "Railway deployment (via GitHub)"; `backend/.env.example` wording updated. Required variables: `MONGODB_URI`, `GAAP_API_KEY`, `GAAP_API_BASE_URL`, `CORS_ORIGIN` (public origin).
