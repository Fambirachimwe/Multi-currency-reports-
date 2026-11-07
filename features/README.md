# Feature Specifications — Simbisa Multi-Currency Sales Reporting

## How to use

Work through the numbered specs in dependency order. **Each spec is a single outcome**; features labeled **batch** are explicitly bounded accelerators (project scaffolding, full UI prototype, test suite, release review), not permission to implement all business logic at once. Every spec starts with the instruction to read `CLAUDE.md`.

Keep `progress-tracker.md` updated after each unit. Do not mark fixture-only screens as integrated. Where GAAP semantics or endpoints are unverified, stop the affected feature and record an open question.

## Feature index

| ID | Feature | Type | Depends on |
|---|---|---|---|
| 01 | [Project Bootstrap](01-project-bootstrap.md) | Foundation batch | None |
| 02 | [Backend Foundation](02-backend-foundation.md) | Foundation | 01 |
| 03 | [Frontend Foundation](03-frontend-foundation.md) | Foundation | 01 |
| 04 | [Complete UI Shell and All Pages](04-complete-ui-shell-and-all-pages.md) | UI batch | 03 |
| 05 | [MongoDB Connection and Models](05-mongodb-connection-and-models.md) | Data | 02 |
| 06 | [GAAP HTTP Client](06-gaap-http-client.md) | Integration | 02 |
| 07 | [GAAP Nodes Retrieval](07-gaap-nodes-retrieval.md) | Integration | 06 |
| 08 | [Catalog Source Verification](08-catalog-source-verification.md) | Discovery gate | 06 |
| 09 | [Catalog Backend](09-catalog-backend.md) | Integration | 08,05 |
| 10 | [Brand and Node Filtering](10-brand-and-node-filtering.md) | Functional | 07,08 |
| 11 | [Department and Product Selection](11-department-and-product-selection.md) | Functional | 09,04 |
| 12 | [Date Range Selection](12-date-range-selection.md) | Functional | 04 |
| 13 | [Report Request Validation](13-report-request-validation.md) | Functional | 10,11,12,02 |
| 14 | [GAAP Sales Pagination](14-gaap-sales-pagination.md) | Integration | 06,13 |
| 15 | [Sales Line Normalization](15-sales-line-normalization.md) | Functional | 14 |
| 16 | [Currency Classification](16-currency-classification.md) | Financial | 15 |
| 17 | [Transaction Eligibility Rules](17-transaction-eligibility-rules.md) | Financial | 15 |
| 18 | [Financial Aggregation Engine](18-financial-aggregation-engine.md) | Financial | 16,17 |
| 19 | [Hybrid Cache Layer](19-hybrid-cache-layer.md) | Data | 05,07,09 |
| 20 | [Report Generation Orchestration](20-report-generation-orchestration.md) | Functional | 13,14,18,19 |
| 21 | [Save Immutable Report Snapshot](21-save-immutable-report-snapshot.md) | Data | 20,05 |
| 22 | [Saved Reports List](22-saved-reports-list.md) | Functional | 21,04 |
| 23 | [Report Summary View](23-report-summary-view.md) | Functional | 21,04 |
| 24 | [Report Detail Table](24-report-detail-table.md) | Functional | 21,23 |
| 25 | [Currency Breakdown View](25-currency-breakdown-view.md) | Functional | 23 |
| 26 | [Excel Export from Saved Snapshot](26-excel-export-from-saved-snapshot.md) | Functional | 21,23 |
| 27 | [Dashboard Wiring](27-dashboard-wiring.md) | Functional | 22,23 |
| 28 | [Operational Error Handling](28-operational-error-handling.md) | Quality | 20,26 |
| 29 | [Reconciliation and Regression Tests](29-reconciliation-and-regression-tests.md) | Quality batch | 18,21,26 |
| 30 | [Railway Deployment](30-railway-deployment.md) | Deployment | 02,03,05,28 |
| 31 | [Production Readiness and Handoff](31-production-readiness-and-handoff.md) | Release batch | 29,30 |
