# Report Request Contract: `POST /api/v1/reports`

Feature 13. Accepts, validates and normalizes one report generation request. **It does not generate
reports**: GAAP extraction is not implemented and execution is feature-gated off. No authentication
(excluded from v1; protect deployments with infrastructure access controls).

## Request

`Content-Type: application/json`. Every field is required; nothing is defaulted. Unknown fields,
unknown query parameters and a non-object body are rejected.

```json
{
  "startDate": "20261101",
  "endDate": "20261107",
  "productIds": ["<product id>", "..."],
  "nodes": { "mode": "brands", "brandIds": ["<brand id>"] },
  "cachePolicy": "use_cache"
}
```

| Field | Rule |
| --- | --- |
| `startDate`, `endDate` | `YYYYMMDD` strings (trimmed), real calendar dates, **inclusive** both ends, not in the future (judged in Africa/Harare), `startDate <= endDate`, inclusive span <= max range. |
| `productIds` | Array of 1..`maxProducts` strings. Each trimmed, non-blank, <= 200 chars, no control characters. Duplicates removed, sorted. The cap applies to the raw length, so duplicates cannot dodge it. Every id must be a currently selectable catalog product (inactive/deleted are not). |
| `nodes.mode` | `all`, `brands` or `nodes`. |
| `nodes.brandIds` | Required, non-empty, only with `brands`. |
| `nodes.nodeIds` | Required, non-empty, only with `nodes`. |
| `cachePolicy` | `use_cache` or `bypass_cache`. **Provisional values**: no sales cache exists yet, so they are recorded and validated but change nothing. |

Unsupported combinations are rejected, not ignored: `brandIds` outside `brands`, `nodeIds` outside
`nodes`, an empty list for the chosen mode, `all` while the stored node list is incomplete.

## Normalization

Brands/nodes are expanded by the Feature 10 rules into the **exact node ids** (unique, sorted by id).
The normalized request stores `nodes: { mode, brandIds, nodeIds }` with the resolved `nodeIds`, so it
means the same thing later. Equivalent requests (different order, duplicates, whitespace) normalize
identically. Brand = top-level node with children is **still an unconfirmed assumption**
(`meta.brandDefinition`).

## Workload caps (all provisional; no approved values)

| Env var | Default | Meaning |
| --- | --- | --- |
| `REPORT_MAX_RANGE_DAYS` | 92 | Inclusive days between start and end (400 if exceeded). |
| `REPORT_MAX_PRODUCTS` | 2000 | Product ids in one request (400). |
| `REPORT_MAX_NODES` | 1000 | Resolved nodes (also caps ids in `nodes`) (422 `WORKLOAD_TOO_LARGE`). |
| `REPORT_MAX_NODE_DAYS` | 50000 | Resolved nodes x inclusive days (422 `WORKLOAD_TOO_LARGE`). |

Invalid values abort startup. The request body is also limited by `JSON_BODY_LIMIT` (default 100kb,
413 if exceeded); about 2000 product ids plus 1000 node ids fit, so raise that limit before raising
the id caps.

## Responses

Envelopes follow the rest of the API: `{ data, meta }` and `{ error: { code, message, requestId, details? } }`.

| Status | Code | When |
| --- | --- | --- |
| 202 | n/a | Execution enabled: `data = { reportId, status: "pending", request }` (the normalized request). Creating a report only ever answers `pending`; any other answer from execution is a 500. **Not reachable in this build** (see gate). |
| 400 | `INVALID_REPORT_REQUEST` | Shape or field errors. `details.fields` maps every invalid field to a message (input values are never echoed). |
| 400 | `INVALID_QUERY` / `INVALID_JSON` | Query string present / malformed JSON. |
| 413 | | Body over `JSON_BODY_LIMIT`. |
| 422 | `UNKNOWN_PRODUCT`, `UNKNOWN_NODE`, `UNKNOWN_BRAND` | Stale or unknown ids; `details.unknownIds`. |
| 422 | `NO_NODES`, `NODE_LIST_INCOMPLETE`, `WORKLOAD_TOO_LARGE` | Empty selection, incomplete node list for `all`, over a cap (`details` carries the counts and limits). |
| 501 | `REPORT_EXECUTION_NOT_ENABLED` | **Current behaviour for every valid request.** `details = { validated: true, reportCreated: false, request: { startDate, endDate, days, productCount, nodeMode, nodeCount, cachePolicy } }`. |
| 502/503/504 | `GAAP_*` | Loading nodes/products from GAAP failed. |

## Feature gate and "no false reports"

`createReportsService` creates a report only through an injected `startReport` function. `server.js`
does not provide one, so a valid request is validated and then refused with 501. **No report ID is
minted and nothing is written to MongoDB**: an ID with no stored report, or a `pending` report that
nothing will ever run, would be a false record. A later feature supplies `startReport` (create the
`pending` report, then run it) and the 202 contract above applies. A report can never be returned as
`completed` from this endpoint.

## Not verified / blockers

- Fixture tests only: no live GAAP, MongoDB or Railway call was made for this feature.
- Caps, `cachePolicy` values and the reporting-day to GAAP `createdDate` boundary mapping are
  unapproved (see `docs/date-range-semantics.md`). Brand definition is unconfirmed.
- Product and node validation use the stored catalog/nodes, which may be stale until refreshed.
- The date helpers are duplicated from the frontend (`date-range.js`); keep the two in sync.
