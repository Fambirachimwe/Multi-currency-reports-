# Feature 04: Complete UI Shell and All Pages

**Type:** UI batch  
**Dependencies:** 03  
**Objective:** Build every approved screen as a navigable, responsive visual prototype with fixture data only.

## Mandatory preflight

1. **Read `CLAUDE.md` before starting.** If it does not exist, do not pretend to have read it; report the gap and consult available context files.
2. Read `project-overview.md`, `architecture.md`, `code-standards.md`, `ui-context.md`, `ai-workflow-rules.md` and `progress-tracker.md` where available, focusing on relevant sections.
3. Inspect existing code before editing; preserve approved decisions.
4. Implement **only this feature**. Do not begin dependent or unrelated features.

## Implementation tasks

1. Implement sidebar, header, navigation, filter-card visual patterns, compact data tables and responsive layout.
2. Create pages: Dashboard, Generate Report, Saved Reports, Report Details, Product Catalog, Nodes/Brands, and Settings/Integration Status (read-only placeholder).
3. Create department/category picker, product multiselect, brand/node selector, date range picker, report status view, summary cards, detail table, export action placement, loading/empty/error views.
4. Create mock fixtures under `frontend/src/mocks/`; label all fixture-backed views as demo/mock.
5. Ensure buttons that are not implemented are disabled or explicitly marked not connected; do not fake report success.
6. Use shadcn/ui primitives, Lucide React and approved screenshot-inspired palette.
7. Verify mobile, tablet and desktop layouts and keyboard navigation.

## Scope boundaries

- Do not add authentication; it is excluded from v1. Protect commercially sensitive deployments through approved infrastructure access controls.
- Do not expose GAAP API credentials in frontend code, source control, sample payloads or logs.
- Do not invent GAAP endpoints, currency semantics, product mappings or transaction rules. Record unverified assumptions as blockers.
- Do not combine monetary values from different currencies. Unknown currencies remain `UNKNOWN`.
- Do not overwrite a completed saved report; exports must use saved MongoDB data.
- Use mock fixtures only when clearly labeled; a mocked pass is not live integration evidence.

## Acceptance criteria

- [ ] All pages route without errors
- [ ] No direct GAAP calls
- [ ] No misleading working controls
- [ ] Responsive UI verified
- [ ] Feature follows approved architecture, code standards and UI context.
- [ ] Relevant automated tests pass; affected workspace build succeeds.
- [ ] `progress-tracker.md` updated with files changed, verification evidence, blockers and next feature.

## Verification

1. Run the smallest unit/API/UI tests covering the acceptance criteria.
2. Run `npm run build` for the affected workspace(s); run lint/test scripts if defined.
3. Check failure, empty and invalid-input cases where applicable.
4. Record exact commands, outcomes and any checks not run in `progress-tracker.md`.
5. If live GAAP, MongoDB or Railway access is unavailable, state which claims remain fixture-only.

## Definition of done

The feature accomplishes its stated objective, its acceptance criteria are evidenced, no architecture invariant is broken, and progress documentation is updated. **Stop after this feature** and request approval or the next spec before continuing.
