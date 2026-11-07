AI Workflow Rules
Approach
Build the Simbisa multi-currency sales reporting application incrementally using a spec-driven, testable workflow. Treat project-overview.md (product intent and scope), architecture.md (stack, boundaries, storage and invariants), code-standards.md (implementation conventions), and ui-context.md (visual design) as the primary context. Use the detailed SRS when available for functional requirements. Record implementation state, decisions, blockers, and open questions in progress-tracker.md. Do not infer missing business rules, fabricate GAAP Unity API capabilities, or replace documented decisions with personal preferences.

The approved architecture is a JavaScript monorepo, with React + Vite, Tailwind CSS + shadcn/ui, Node.js + Express, MongoDB + Mongoose, GAAP Unity Data API, ExcelJS, Railway deployment, and a modular monolith. Authentication is not part of v1; do not introduce an authentication provider or role-based access control without approval. Treat the absence of application authentication as a security constraint, not permission to expose the app or credentials publicly.

For each feature: read relevant context → define a small acceptance criterion → implement → test → update progress and relevant documentation → move on. Prefer working vertical slices that can be verified through the frontend, backend, and storage boundaries over broad scaffolding with unimplemented behavior.
Scoping Rules
- Work on one feature unit at a time, with a clear objective and observable acceptance criteria.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single implementation step.
- Respect the monorepo/module boundaries in architecture.md; keep HTTP handlers thin and business logic in the responsible service/module.
- Do not change the chosen stack, database, deployment platform, or architecture style without explicit approval.
- Before coding, identify the files to change, dependencies, assumptions, and the smallest end-to-end test.
- Do not build future-scope features (authentication, advanced analytics, scheduled report emails, etc.) unless explicitly requested.
- Reuse existing project patterns and shadcn/ui components; avoid duplicate utilities, components, or competing implementations.
- Keep each change reviewable. Avoid unrelated refactors, mass formatting changes, or dependency upgrades during feature work.
- Do not treat mocked GAAP responses as proof that a live endpoint, field, or currency calculation works.
When to Split Work
Split an implementation step if it combines:
- Frontend UI changes with a new, independently complex GAAP API integration or data synchronization job.
- Multiple unrelated Express routes, business modules, or persistence models.
- Report generation, MongoDB snapshot persistence, and Excel formatting when each can be tested independently.
- A catalog/department selection feature and a separate financial aggregation feature.
- A database migration or cache-policy change with unrelated UI redesign.
- Any behavior whose source fields, currency semantics, department/product relationships, or refund handling are not defined or verified.
- New infrastructure/deployment work and unrelated feature development.
If a change cannot be verified end to end quickly, the scope is too broad — split it into smaller units with explicit intermediate acceptance criteria. A vertical slice may cross UI, API, and database layers when all changes serve the same single feature.
Handling Missing Requirements
- Do not invent product behavior not defined in the context files or approved SRS.
- If a requirement is ambiguous, document the ambiguity in the relevant context file and ask for clarification before implementing behavior that depends on it.
- If a requirement is missing, add it as an Open Question in progress-tracker.md, identify its impact, and stop the affected feature until resolved. Continue unrelated, unblocked work when appropriate.
- Treat GAAP Unity documentation and observed API responses as evidence, not assumptions. The currently demonstrated endpoints are /nodes and /sales; do not invent /products, /departments, /brands, or any other endpoint without verification.
- Confirm the actual GAAP response shapes and semantics for product IDs, node/brand relationships, departments, pagination, tendered status, negative sales, refunds, dates, and currencies before relying on them.
- Never default an unknown or missing currency to USD. Preserve the unknown status and surface it for investigation.
- Never sum different currencies into a single monetary total without an explicitly approved conversion rule and rate source.
- Verify whether line turnover is recorded in transaction currency, base currency, or another field before calculating or labeling USD/ZWG totals.
- Never silently omit transactions, failed pages, or unmatched items from a report that appears complete; surface partial-data/error states explicitly.
- If documentation conflicts, report the conflict and request a decision; do not silently pick whichever implementation is easiest.
- Record approved decisions in the appropriate context file and close the corresponding progress-tracker question.
Protected Files
Do not modify the following unless explicitly instructed or a clearly approved task requires it:
- architecture.md, code-standards.md, ui-context.md, project-overview.md — do not silently rewrite established product or architectural decisions; propose changes first. Exception: after an approved decision or implementation change, make the necessary synchronized documentation update.
- frontend/src/components/ui/ — shadcn/ui-generated primitives; prefer composition and wrappers instead of editing library components directly.
- node_modules/, third-party package internals, and generated build output (dist/, build/, coverage/).
- Lockfiles (package-lock.json, etc.) — change only as a consequence of an approved dependency operation; never hand-edit them.
- .env, .env.production, and any file containing real secrets or credentials — never print, commit, overwrite, or copy secrets into examples. Use .env.example with placeholders.
- Existing database records, stored report snapshots, and production data — do not delete, overwrite, backfill, or migrate without an explicit plan and approval.
- Deployment configuration and production Railway settings — do not change live services, secrets, or data stores without explicit approval.
progress-tracker.md is not protected from normal status updates: maintain it as part of every feature unit.
Keeping Docs in Sync
Update the relevant context file whenever an approved implementation change affects:
- System architecture, module ownership, API contracts, or deployment boundaries → architecture.md.
- MongoDB schemas, report snapshot structure, cache freshness/invalidation, or storage decisions → architecture.md and any relevant SRS/data-model section.
- JavaScript, React, Express, validation, testing, or naming conventions → code-standards.md.
- UI tokens, colors, typography, component usage, navigation, or layout conventions → ui-context.md.
- User-visible feature scope, reporting behavior, or business requirements → project-overview.md and the SRS where available.
- Verified GAAP endpoints, field mappings, assumptions, and integration limitations → integration notes and the relevant architecture/requirements sections.
After every feature unit, update progress-tracker.md with: feature name; status (Not Started / In Progress / Blocked / Done); changed files; tests performed and results; decisions; outstanding questions; and the next recommended unit. Create the tracker if it does not yet exist, using this minimal structure. Never mark a feature Done solely because code was written.
Before Moving to the Next Unit
1. The current unit works end to end within its defined scope, or its documented, isolated portion has passed explicit acceptance tests.
2. No invariant defined in architecture.md was violated, especially the GAAP source-of-truth, currency segregation, report-snapshot, and secret-handling rules.
3. progress-tracker.md reflects completed work, test evidence, blockers, and the next unit.
4. npm run build passes for every affected app/package that defines a build script. If the root has no build script, run the relevant workspace build commands; do not claim a nonexistent command passed.
5. Relevant automated tests and lint checks pass where scripts exist. If scripts do not yet exist, record that gap rather than claiming success.
6. Any new Express endpoint validates input and returns consistent error/response shapes; any new MongoDB write has tested persistence and retrieval behavior.
7. Reporting changes have tests for currency isolation, date boundaries, pagination, empty results, unknown currencies, and the applicable refund/negative-sale rules.
8. Saved-report downloads use MongoDB report snapshots to generate Excel on demand; they do not refetch live GAAP sales during export.
9. The UI follows ui-context.md, including the GAAP-inspired dark palette, responsive filters, readable tables, and clear loading/error/empty states.
10. No API keys, real credentials, sensitive raw payloads, or production data have been committed or exposed to the browser or logs.
11. Any remaining uncertainty is recorded explicitly; do not describe unverified integrations or untested flows as complete.
AI Execution Protocol
For each coding request, respond and work in this order:
1. Context check: Identify the relevant requirements, boundaries, and existing implementation. Read the applicable files before editing.
2. Unit definition: State the one feature being built, acceptance criteria, and any assumptions that require confirmation.
3. Implementation plan: List the intended files/modules and the smallest viable sequence of changes.
4. Implementation: Write maintainable JavaScript using the approved stack and established project conventions.
5. Verification: Run available tests/builds, inspect results, and distinguish verified behavior from assumptions or mocks.
6. Documentation: Update progress-tracker.md and any approved context-file changes.
7. Handoff: Summarize what changed, what passed, what is blocked, and the recommended next unit. Never claim a test or deployment succeeded unless it actually ran successfully.
When a user asks only for planning or documentation, produce the requested artifact without starting implementation. When access to the real GAAP API, MongoDB, or Railway is unavailable, use clearly labeled fixtures for local tests and identify the required live verification steps.