Architecture Context
Stack
Layer	Technology	Role
Frontend framework	React + Vite + JavaScript	Single-page application for report configuration, generation, viewing, and downloads
UI	Tailwind CSS + shadcn/ui	Responsive components, filters, tables, and reporting dashboard
Backend	Node.js + Express + JavaScript	REST API, report orchestration, validation, and Excel export
Architecture	Modular monolith	One backend deployment with clearly separated domain modules
Database	MongoDB + Mongoose	Persist generated report snapshots, user-selected filters, cached reference data, and operational metadata
External data source	GAAP Unity Data API	Authoritative source for nodes and sales transactions; other reference-data endpoints require verification
HTTP client	Axios	Server-side GAAP API requests, retries, timeouts, and pagination
Excel export	ExcelJS	Build Excel workbooks from previously saved report data on demand
Deployment	Railway	Host frontend, backend, and managed MongoDB connection, using environment variables for secrets
Repository	Monorepo	Keep frontend, backend, and shared project documentation together
Authentication	None (initial version)	No sign-in or role enforcement in v1; deployment must be access-restricted operationally


System Boundaries
- frontend/ — Owns the React/Vite application, routing, dashboard, filters, report views, and download interactions; never calls GAAP Unity directly or handles its API key.
- frontend/src/components/ — Owns reusable Tailwind/shadcn-based UI components, tables, selectors, and feedback states.
- frontend/src/features/reports/ — Owns report configuration screens, saved-report history, summaries, detailed views, and frontend report state.
- backend/src/routes/ — Defines versioned HTTP endpoints and delegates requests to controllers; contains no reporting calculations.
- backend/src/controllers/ — Validates request boundaries, maps HTTP input/output, and invokes application services.
- backend/src/modules/gaap/ — Owns GAAP API authentication, endpoint adapters, pagination, rate-limit handling, response validation, and mapping to internal data structures.
- backend/src/modules/catalog/ — Owns department/category, product, brand, and node selection data; uses confirmed GAAP endpoints or an explicitly configured mapping where endpoints are unavailable.
- backend/src/modules/reports/ — Owns report generation, filter normalization, sales-line calculations, currency grouping, snapshot persistence, retrieval, and report status.
- backend/src/modules/exports/ — Owns on-demand Excel generation from stored report snapshots; does not independently refetch sales.
- backend/src/modules/cache/ — Owns cached GAAP reference data, freshness policy, invalidation, and any deliberately enabled sales-data cache.
- backend/src/models/ — Owns Mongoose schemas, indexes, and MongoDB persistence contracts.
- backend/src/config/ — Owns environment validation, database connection, GAAP API configuration, and application settings.
- backend/src/jobs/ — Owns optional scheduled cache refresh and cleanup work; jobs must not be started implicitly in every web replica.
- shared/ — Owns versioned, non-secret API contracts, shared constants, and report field definitions where useful.
- docs/ — Owns project overview, SRS, architecture decisions, API integration notes, and operational runbooks.
Dependency direction: UI → backend HTTP API → application modules → GAAP adapter and MongoDB repositories. The frontend must never access MongoDB or the GAAP API directly.
Storage Model
- MongoDB — generated report snapshots: Store a unique report ID, normalized filter selections, report generation timestamp, data coverage, currency-specific summary totals, product/store breakdowns, and the underlying normalized detail rows needed for later viewing and Excel export. Save a consistent snapshot so downloading the same report does not silently change its numbers.
- MongoDB — report metadata: Store generation status (pending, completed, failed), progress/error metadata where applicable, source fetch timestamps, row counts, schema version, and export-related metadata. No user ownership field is required until authentication is introduced.
- MongoDB — cache: Store cached nodes, brands, departments/categories, products, and optionally sales pages or aggregates, each with a cache key, source timestamp, expiry, and refresh status. Cache policies must be configurable; cached sales data must be labeled with its freshness.
- MongoDB — configuration and audit metadata: Store non-secret application settings and operational records as needed. Secrets remain in Railway environment variables, not MongoDB documents.
- Excel files — generated transiently: Do not persist .xlsx binaries by default. When an export is requested, read the saved report snapshot from MongoDB, generate the workbook using ExcelJS, stream it to the client, and discard temporary resources. If reports grow beyond MongoDB's 16 MB document limit, store detail rows in a separate reportRows collection linked by reportId, with pagination and suitable indexes.
- External source — GAAP Unity Data API: Remains the system of record for sales. MongoDB report snapshots are historical outputs of calculations, not an independent replacement for GAAP transactions.
Suggested collections: reports, reportRows, catalogCache, salesCache (optional), appSettings, and jobRuns (optional). Define indexes for reports.createdAt, reports.status, reportRows.reportId, and cache expiry fields.
Auth and Access Model
- No application authentication in v1: Users do not sign in and there are no application-enforced Head Office or Regional Manager roles. Any person who can reach the application can potentially generate, view, and download saved reports.
- Deployment-level restriction: Because sales data is commercially sensitive, restrict application access through an approved private network, gateway, or other access control before production exposure. Railway deployment alone must not be treated as authentication.
- No per-user ownership in v1: Generated reports are shared at application level; report IDs are identifiers, not access-control tokens.
- GAAP API credentials: Only the backend reads the GAAP API key from Railway secrets/environment variables. Never embed the key in frontend bundles, URLs shown to users, logs, or repository files. Rotate any previously exposed key.
- API protection: Validate input, cap report date ranges and row volumes, enforce request limits and sensible timeouts, configure CORS for the approved frontend origin, and avoid exposing internal error details.
- Future access model: Keep report-service interfaces independent of authentication so user identities, Head Office/Regional Manager roles, report ownership, and audit attribution can be added later without rewriting reporting calculations.
Invariants
1. GAAP is authoritative: Report calculations derive from GAAP Unity data or a clearly timestamped cache/snapshot of that data; never fabricate missing transactions or reference values.
2. Currency totals remain separate: USD, ZWG, and any other returned currency are aggregated independently. Never sum different currencies into a single monetary total without an explicit, documented conversion process.
3. Unknown currency is not USD: Missing or ambiguous currency metadata must be marked UNKNOWN or rejected according to a documented validation rule; never silently default it to USD.
4. A saved report is immutable as a result set: Once marked completed, its filters, normalized detail rows, calculation version, and totals must remain consistent. Regeneration creates a new report ID/version rather than silently overwriting historical results.
5. Excel exports use saved data: Downloading a report must load its persisted snapshot and detail rows from MongoDB, not call GAAP again or recalculate from newly fetched transactions.
6. Filters are applied consistently: The same start/end dates, selected products, nodes/brands, transaction eligibility rules, and currency logic must govern summary totals, detailed rows, and Excel worksheets.
7. No double counting: Pagination, retries, cache overlap, and duplicate transaction retrieval must not cause a sales line to be counted twice. Deduplication must use stable source identifiers where available.
8. Transaction semantics are explicit: Handling of TENDERED status, voids, returns, negative sales, discounts, tax, and turnover fields must follow verified GAAP payload semantics; unverified assumptions must be documented and tested.
9. Hybrid cache freshness is visible: Every generated report records when its source data was fetched and whether cached data was used. Expired or incomplete caches must not be represented as current data.
10. GAAP credentials stay server-side: Only the backend GAAP adapter may use the API key; secrets must never be returned to the browser or committed to source control.
11. MongoDB limits are respected: Large reports must use chunked/paginated detail-row storage and retrieval rather than attempting to put unlimited rows into one MongoDB document.
12. Failures cannot produce completed reports: A report may be marked completed only after all required pages are processed, validations pass, and its persisted totals and details are consistent. Partial failures must be marked and surfaced.
13. Request handlers remain bounded: Large GAAP fetches, calculations, and Excel exports must use bounded concurrency, pagination, streaming, and timeouts; introduce a dedicated worker/job process when report volume makes synchronous requests unreliable.
14. No implicit authorization: Until authentication exists, neither the UI nor backend may claim that reports are private to individual users or restricted by role.
Implementation Notes and Open Decisions
- Verified integration surface: The current example implementation demonstrates GET /nodes and GET /sales. Confirm available endpoints and schemas for departments/categories, products, and brands before finalizing the catalog adapter.
- Currency semantics: Verify whether forex.selectedCurrency.currency, baseCurrency.currency, and sales-line turnover are in the same monetary basis. Currency grouping must be based on confirmed API behavior.
- Report generation strategy: Start with request-driven generation and cached reference data. Add a Railway worker for long-running jobs and scheduled refreshes when operational needs justify it.
- Cache policy: Define TTLs, refresh intervals, maximum report date range, and how users distinguish fresh from cached results before production release.
- Retention policy: Decide how long saved reports and optional cached sales rows remain in MongoDB; implement cleanup only after agreeing retention requirements.
- Railway setup: Deploy the frontend and backend as separate Railway services within one project if convenient, backed by MongoDB. Configure production environment variables, health checks, and persistent database storage appropriately.