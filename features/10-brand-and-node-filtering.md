# Feature 10: Brand and Node Filtering

**Type:** Functional  
**Dependencies:** 07,08  
**Objective:** Enable all nodes, brand-based nodes, or selected individual nodes.

## Mandatory preflight

1. **Read `CLAUDE.md` before starting.** If it does not exist, do not pretend to have read it; report the gap and consult available context files.
2. Read `project-overview.md`, `architecture.md`, `code-standards.md`, `ui-context.md`, `ai-workflow-rules.md` and `progress-tracker.md` where available, focusing on relevant sections.
3. Inspect existing code before editing; preserve approved decisions.
4. Implement **only this feature**. Do not begin dependent or unrelated features.

## Implementation tasks

1. Implement verified brand-node association or approved configuration.
2. Expose backend normalized brand/node filter options.
3. Wire selection UI to backend, supporting All, Brand and Multi-node modes.
4. Ensure brand selection expands to exact permitted node IDs without duplicates.
5. Test zero nodes, multiple brands and stale node mapping.

## Scope boundaries

- Do not add authentication; it is excluded from v1. Protect commercially sensitive deployments through approved infrastructure access controls.
- Do not expose GAAP API credentials in frontend code, source control, sample payloads or logs.
- Do not invent GAAP endpoints, currency semantics, product mappings or transaction rules. Record unverified assumptions as blockers.
- Do not combine monetary values from different currencies. Unknown currencies remain `UNKNOWN`.
- Do not overwrite a completed saved report; exports must use saved MongoDB data.
- Use mock fixtures only when clearly labeled; a mocked pass is not live integration evidence.

## Acceptance criteria

- [ ] Selections deterministic
- [ ] No duplicate node IDs
- [ ] All-nodes mode explicit
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
