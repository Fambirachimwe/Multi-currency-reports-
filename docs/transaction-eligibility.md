# Transaction Eligibility Rules (Feature 17)

Code: `backend/src/modules/gaap/transaction-eligibility.js` (`evaluateLineEligibility`, `applyEligibility`,
`getEligibilityReadiness`, `assertEligibilityProductionReady`, `RULES`). Input: Feature 15 normalized lines.
Pure; no I/O, no money arithmetic, no currency handling, not wired to a route or report.

**One rule for every report and export.** Reports and exports must call `evaluateLineEligibility` /
`applyEligibility` and never write their own filter. Ineligible lines are kept (never dropped) with
`eligibility.reasons`, so every exclusion is auditable. Exports read saved MongoDB data, so the result
(or its reason codes) must be stored with the report when reports are built.

## Evidence (read-only live probes, 2026-11-08; one tenant, one day)

200 TENDERED sales / 354 lines; `CANCELED` sales exist; 6 sales with `isNegative: true` (8 lines).
Feature 14 already requests TENDERED + `isNegative false`; this module re-checks every line.
Nothing else about status, void, refund or return meaning is known.

## Rules and reason codes

A line is **eligible exactly when it has no reasons**. Reasons are listed in a fixed order.

| Reason                                                                     | When                                                                                                      | Verified?       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
| `INVALID_LINE`                                                             | input is not an object                                                                                    | yes (integrity) |
| `LINE_UNUSABLE` (+ `issueCodes`)                                           | Feature 15 `usable !== true` for any error other than duplicate (missing ids/quantity/turnover/timestamp) | yes (integrity) |
| `DUPLICATE_LINE`                                                           | repeated `sourceLineKey` (first occurrence counts)                                                        | yes (integrity) |
| `STATUS_CANCELED`                                                          | `CANCELED` sales never count (owner, 2026-11-08); `TENDERED` counts                                       | yes (owner)     |
| `STATUS_MISSING` / `STATUS_NOT_TENDERED`                                   | status absent / any other status than `TENDERED` and `CANCELED`                                           | **no**          |
| `NON_TURNOVER_LINE`                                                        | `lineTotals.nonTurnover` is non-zero: non-turnover is not included (owner, 2026-11-08)                    | yes (owner)     |
| `NEGATIVE_FLAG_MISSING` / `NEGATIVE_SALE`                                  | `sale.isNegative` not a boolean / `true`                                                                  | **no**          |
| `ZERO_QUANTITY`, `NEGATIVE_QUANTITY`, `NEGATIVE_TURNOVER`, `SIGN_MISMATCH` | quantity 0 or < 0, turnover < 0, or opposite signs                                                        | **no**          |

Notes (never change eligibility): `ZERO_TURNOVER` (positive quantity, zero turnover),
`UNEXPECTED_DISCOUNT`,
`ADD_ON_PRICE_BASIS_UNVERIFIED` (carried from Feature 15). Currency is not read: `UNKNOWN`-currency
lines stay eligible and visible (Feature 16); nothing is combined across currencies. Reasons carry codes
only, never source values.

## Unverified rules block production

`getEligibilityReadiness()` returns `productionReady: false` while any rule is unverified, and
`assertEligibilityProductionReady()` throws `ELIGIBILITY_RULES_UNVERIFIED`. Report generation (when
built) must call the assert before producing a non-demo report. To release: the owner confirms the
rules below, then flip `verified` in `RULES` (and update the tests that pin it).

## Blockers for the business owner

1. Which other statuses exist (e.g. void)? Currently all are excluded.
2. Are `isNegative` sales refunds/returns? Should they be **excluded** (current) or **netted** against turnover?
3. Can a negative or zero-quantity line occur inside a non-negative sale, and what does it mean?
4. Does zero turnover with positive quantity (free/comped item) count as a sale (currently yes, with a note)?

Owner decisions 2026-11-08: TENDERED included, CANCELED excluded, non-turnover not included (a line with non-zero `nonTurnover` is excluded whole; if only the non-turnover amount should be dropped, say so). The remaining defaults are conservative and unconfirmed.
