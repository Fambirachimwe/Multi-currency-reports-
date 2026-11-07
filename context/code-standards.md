Code Standards
These standards apply to the Simbisa Multi-Currency Sales Reporting Application. The project uses a JavaScript monorepo with React + Vite, Node.js + Express, Tailwind CSS + shadcn/ui, MongoDB + Mongoose, and GAAP Unity Data API integration. Follow architecture.md when deciding module ownership.
General
- Keep modules small, cohesive, and single-purpose. Prefer clear names and straightforward control flow over clever abstractions.
- Fix root causes rather than layering workarounds. Record necessary temporary workarounds with a reason and removal condition.
- Separate UI rendering, HTTP handling, business rules, GAAP integration, persistence, and Excel generation.
- Reuse existing project patterns before introducing a new dependency or architectural pattern.
- Do not duplicate reporting calculations across frontend, backend, and export code. The backend is authoritative.
- Use async/`await` for asynchronous work; handle failures explicitly and never swallow exceptions silently.
- Keep secrets, credentials, and customer-sensitive transaction data out of source control, browser bundles, and logs.
- Write automated tests for financial calculations, currency grouping, filters, pagination, snapshot consistency, and exports.
- Use ESLint and Prettier with a shared configuration; run lint and tests before merging changes.
- Document assumptions about GAAP fields and endpoints; do not treat unverified API behavior as guaranteed.
JavaScript
- Use JavaScript throughout frontend and backend; do not introduce TypeScript without an explicit architecture decision.
- Use modern ES modules (import/`export`) consistently unless an integration requires otherwise; avoid mixing module systems in one package.
- Prefer const, use let only for reassignment, and never use var.
- Use descriptive camelCase for variables/functions, PascalCase for React components, and UPPER_SNAKE_CASE for true constants.
- Use strict equality (=== / !==) and explicit checks for null, undefined, and empty values when they have different meanings.
- Use JSDoc for non-obvious public functions, normalized sales records, report snapshots, and shared contracts.
- Validate untrusted input at every boundary: HTTP requests, environment variables, GAAP responses, and database records when necessary.
- Do not use floating-point arithmetic naively for money. Use a documented decimal-safe approach and explicit currency-specific rounding rules; retain source precision until display/export boundaries.
- Do not use Number(value) || 0 for financial fields: missing, invalid, and zero values must remain distinguishable.
- Use ISO 8601 timestamps for stored instants and explicitly document the reporting timezone and whether date-range endpoints are inclusive or exclusive.
- Avoid deeply nested conditionals; extract small pure functions for normalization, calculations, and grouping.
React + Vite
- Build a client-side React application using functional components and hooks.
- Organize domain UI under frontend/src/features/; keep generic reusable controls in frontend/src/components/.
- Keep page components focused on composition. Move API calls into dedicated client modules and report transformations into pure utilities or hooks.
- Keep server-owned report totals authoritative; frontend formatting and display must not recalculate financial truth independently.
- Treat filters (date range, brand, nodes, department/category, products, currencies) as explicit state; validate them before report generation.
- Support loading, empty, error, stale-cache, and success states for report-related screens.
- Avoid direct DOM manipulation, unnecessary effects, and duplicated derived state.
- Use stable identifiers for product, store, and report selections rather than array indexes or display labels.
- Do not place GAAP API keys, MongoDB credentials, or privileged integration URLs in Vite VITE_* variables; browser-exposed environment variables are public.
- Keep browser requests directed to the application's Express API, never directly to authenticated GAAP endpoints.
Node.js + Express
- Keep route definitions declarative and thin; controllers handle HTTP mapping and services implement domain behavior.
- Put GAAP HTTP calls and response mapping only in the GAAP integration module.
- Centralize asynchronous error handling and return consistent errors without exposing stack traces or credentials.
- Use request-scoped logging identifiers for traceability; redact API keys and sensitive transaction data.
- Configure explicit timeouts, bounded retries with backoff for transient failures, and safe pagination for GAAP requests.
- Never retry non-idempotent operations automatically unless their idempotency is established.
- Use environment-based configuration with startup validation. Fail fast when required configuration is missing.
- Do not start scheduled jobs automatically in every Railway web replica; run scheduled refresh work as an explicitly configured single worker/job.
- Keep report generation bounded by documented time, page-count, memory, and concurrency limits. Move expensive work to an explicit job mechanism if needed.
Styling
- Use Tailwind CSS utilities for layout, spacing, responsiveness, and visual states.
- Use shadcn/ui components as the accessible baseline; extend them consistently rather than building near-duplicates.
- Use theme tokens/CSS custom properties for colors, typography, spacing, and border radii; avoid scattered hardcoded hex values.
- Keep currency figures right-aligned, clearly labeled with currency codes, and formatted consistently.
- Do not use color alone to communicate report errors, status, or negative amounts.
- Preserve keyboard accessibility, focus visibility, semantic labels, and usable responsive tables.
- Follow a single documented design-token scale; if ui-context.md is introduced, treat it as the source of truth for visual tokens.
API Routes
- Version application endpoints (for example, /api/v1/...) and use consistent resource naming.
- Parse and validate query parameters, path parameters, and request bodies before running business logic.
- Validate date ranges, selected product IDs, node IDs, pagination, and allowable report options; reject invalid requests with actionable errors.
- Return predictable response envelopes and HTTP status codes. Suggested shape: { "data": ..., "meta": ... } for success and { "error": { "code": "...", "message": "..." } } for failure.
- Keep request handlers free of financial calculations, GAAP response-shape assumptions, and Excel formatting logic.
- Use server-side limits for page sizes, date ranges, and report generation concurrency to protect GAAP and MongoDB.
- Make report creation and retrieval distinct operations. A saved report must have a stable ID and clear status.
- Generate Excel only from the persisted report snapshot selected by report ID; downloading must not silently refresh sales data.
- No user authentication is implemented in v1. Do not imply that API endpoints are authorized per user; restrict deployment access operationally and add application authorization before broad exposure.
- Apply appropriate CORS restrictions, rate limiting, input size limits, and secure HTTP headers even before login is introduced.
Data and Storage
- Use MongoDB + Mongoose for saved report definitions, report snapshots/results, cached reference data, and operational metadata.
- GAAP Unity is the authoritative source of transaction data; local cached data must record its retrieval time and freshness status.
- Store the exact normalized filter set, report generation timestamp, source-data coverage, calculation/version metadata, and report status with each snapshot.
- Preserve the report's per-currency breakdown. Never sum USD, ZWG, or any other currency into a single unlabeled total.
- Determine transaction currency only from verified GAAP field semantics. Missing or ambiguous currency must be flagged as UNKNOWN or excluded with an explicit warning; never silently default to USD.
- Use validated source line totals and quantities according to documented rules; explicitly handle refunds, reversals, negative lines, and transaction status.
- Do not infer that every sale item belongs to the requested product without checking its normalized product identifier.
- Save report results in a structure that can be retrieved reproducibly. Use bounded documents or separate result collections when data may exceed MongoDB's 16 MiB document limit.
- Use indexes for report ID, creation date, status, and relevant lookup/filter fields; avoid unbounded collection scans.
- Cache reference data and optional sales data only under an explicit TTL/invalidation policy; do not treat cached data as fresh without checking metadata.
- Generate Excel workbooks on demand from saved MongoDB results; do not persist Excel binary files unless a later requirement explicitly calls for it.
- Stream or paginate large report exports where practical; set memory and response-size limits.
- Use schema validation and controlled migrations/versioning for persisted report formats. Do not mutate historical snapshots in ways that change previously reported totals.
- Store secrets in Railway environment variables or an approved secret manager, not MongoDB documents or committed .env files.
GAAP Unity Integration
- Centralize GAAP API authentication, base URL, timeouts, retry policy, pagination, and field mapping in backend/src/modules/gaap/.
- Treat GAAP responses as untrusted external data and validate/normalize them before calculations.
- Use only confirmed GAAP endpoints and fields. The existing integration demonstrates /nodes and /sales; product, department, and brand discovery must be verified before implementation.
- Keep raw external field names out of report calculations; map them to a documented internal sales-line contract.
- Confirm whether selected currency, base currency, and turnover amounts are denominated consistently before aggregating.
- Log fetch failures and partial retrieval explicitly. Never label a partial dataset as a complete report.
- Make GAAP pagination exhaustive within configured limits, and deduplicate records using stable source identifiers where needed.
Reporting and Excel
- Implement currency grouping, product grouping, node grouping, and turnover calculation as tested pure functions wherever possible.
- Keep summary, detailed product, and currency reports consistent by deriving them from the same normalized report dataset.
- Include selected filters, generation time, currency codes, and relevant warnings in report views and Excel output.
- Export a saved report by its ID. An export is a rendering of the snapshot, not a new reporting run.
- Keep worksheet names, columns, numeric formatting, and column ordering consistent; use ExcelJS in the exports module.
- Write numeric Excel cells as numbers with suitable formats, not as preformatted currency strings, while labeling each currency explicitly.
- Test edge cases: zero sales, multiple products, mixed currencies, missing currency, refunds, duplicate pages, partial API failure, and large reports.
File Organization
- frontend/ — React + Vite application, frontend package configuration, and static assets.
- frontend/src/components/ — Shared shadcn/ui-based components and generic UI controls.
- frontend/src/features/reports/ — Report filters, generation UI, saved-report views, and download interactions.
- frontend/src/lib/ — Frontend API client, formatting helpers, and shared browser utilities.
- backend/ — Express application, backend package configuration, and runtime entry point.
- backend/src/routes/ — Versioned Express route registration and request middleware wiring.
- backend/src/controllers/ — HTTP request validation/orchestration and response mapping.
- backend/src/modules/gaap/ — GAAP client, endpoint adapters, pagination, and normalization.
- backend/src/modules/catalog/ — Products, departments/categories, brands, and nodes reference-data logic.
- backend/src/modules/reports/ — Report business rules, generation, calculations, and snapshot retrieval.
- backend/src/modules/exports/ — ExcelJS workbook creation from saved reports.
- backend/src/modules/cache/ — Cache access, TTL policy, freshness checks, and invalidation.
- backend/src/models/ — Mongoose schemas, indexes, and persistence contracts.
- backend/src/config/ — Environment validation, database initialization, and application settings.
- backend/src/middleware/ — Error handling, request validation, logging, and security middleware.
- backend/src/jobs/ — Explicitly scheduled cache refresh and cleanup tasks.
- shared/ — Shared non-secret constants and documented API/report contracts.
- docs/ — SRS, project-overview.md, architecture.md, code standards, and operational notes.
- **/__tests__/ or *.test.js — Tests placed near the code they verify, following one consistent convention.
Quality Gates
- Every change passes linting and formatting checks.
- Every change to calculations, currency mapping, report filters, or exports includes relevant automated tests.
- API integrations use mock fixtures in tests; tests must not require production GAAP credentials.
- Changes to external API assumptions, persisted report structure, or module boundaries update the relevant documentation.
- Never merge hardcoded credentials, unhandled partial-report failures, or cross-currency totals.