# Feature 01: Project Bootstrap

**Type:** Foundation batch  
**Dependencies:** None  
**Objective:** Initialize the complete runnable monorepo without implementing business features.

## Mandatory preflight

1. **Read `CLAUDE.md` before starting.** If it does not exist, do not pretend to have read it; report the gap and consult available context files.
2. Read `project-overview.md`, `architecture.md`, `code-standards.md`, `ui-context.md`, `ai-workflow-rules.md` and `progress-tracker.md` where available, focusing on relevant sections.
3. Inspect existing code before editing; preserve approved decisions.
4. Implement **only this feature**. Do not begin dependent or unrelated features.

## Implementation tasks

1. Read `CLAUDE.md` before starting; if missing, report this and request/create only an approved minimal pointer file.
2. Create root structure: `frontend/`, `backend/`, `shared/`, `docs/`, `feature-specs/`.
3. Initialize `frontend/` with React + Vite and JavaScript; initialize `backend/` with Node.js + Express and JavaScript.
4. Initialize Git only if the directory is not already a repository; do not overwrite history.
5. Configure `.gitignore` for dependencies, build output, `.env*` (allow `.env.example`), logs and coverage.
6. Create root, frontend and backend `.env.example` files with placeholder values and no credentials.
7. Install minimum runtime and dev dependencies consistent with approved architecture; commit lockfiles.
8. Create root npm workspace scripts for dev, lint, test, and build where applicable.
9. Add a README with setup, local run instructions, and Railway deployment overview.
10. Create or update `progress-tracker.md`.

## Scope boundaries

- Do not add authentication; it is excluded from v1. Protect commercially sensitive deployments through approved infrastructure access controls.
- Do not expose GAAP API credentials in frontend code, source control, sample payloads or logs.
- Do not invent GAAP endpoints, currency semantics, product mappings or transaction rules. Record unverified assumptions as blockers.
- Do not combine monetary values from different currencies. Unknown currencies remain `UNKNOWN`.
- Do not overwrite a completed saved report; exports must use saved MongoDB data.
- Use mock fixtures only when clearly labeled; a mocked pass is not live integration evidence.

## Acceptance criteria

- [ ] Both apps start locally
- [ ] Root workspace commands work
- [ ] No secrets or generated files tracked
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
