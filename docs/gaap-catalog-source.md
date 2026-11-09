# GAAP Catalog Source Verification (Feature 08)

Status: discovery complete for what the API shows; **three items are blocked** (see Blockers).
Verified: 2026-11-07, read-only calls to the two endpoints already used by the existing integration (`GET /nodes`, `GET /sales`). Only field paths, types and counts were recorded. No IDs, names, amounts, keys or payloads are stored here.

## Evidence base and limits

- **No GAAP API documentation (OpenAPI, Postman collection or PDF) exists in this repository or was supplied.** The only prior sources are `context/*.md` (which say only `/nodes` and `/sales` are demonstrated) and the git-ignored `sample.js`.
- Evidence below is therefore **observed live responses** from one tenant, on **one trading day (2026-11-05), TENDERED sales, first 300 records**. It is a sample, not proof of every case.
- **No other endpoints were probed.** Guessing paths such as `/products`, `/departments` or `/brands` was deliberately not done (spec: do not invent endpoints). Whether such endpoints exist is **unknown** and is a blocker until GAAP documentation or the vendor confirms.
- Nothing here is mocked; nothing here is covered by automated tests (this feature adds documentation only).

## Verified endpoints

| Endpoint     | Used for                                        | Verified behaviour                                                            |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /nodes` | Node hierarchy                                  | `{ totalRecords, data[] }`, `limit`/`skip` work (details in Feature 07 notes) |
| `GET /sales` | Sale lines carrying product and department data | `{ totalRecords, data[] }`, `match`, `limit`, `skip` work                     |

Auth is the `apikey` query parameter (backend only).

## Source field map

### Nodes (`GET /nodes`, 249 records)

| Source field                         | Type   | Presence | Meaning / use                                                                                                                           |
| ------------------------------------ | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                                | string | 249/249  | **Unique node ID.** Equals `sales[].nodeId` (50/50 sampled sales matched a node `_id`).                                                 |
| `parent`                             | string | 249/249  | `_id` of the parent node. 8 nodes are roots; 241 are children of a root.                                                                |
| `nodeId`                             | string | 249/249  | Not unique (8 distinct values); for all 241 children it equals the root's `_id`. Do not use as a key.                                   |
| `path[]`                             | array  | 249/249  | Ancestor chain. Roots have length 1; children length 2 (`path[].rank` is 0 or 1). Every child's `path` contains a root `_id` (241/241). |
| `tradingDetails.name`                | string | 249/249  | Display name.                                                                                                                           |
| `status`, `nodeType`, `baseCurrency` | string | 249/249  | Meaning **unverified** (see Feature 07 notes).                                                                                          |

Hierarchy is exactly **two levels**: 8 roots, 241 children, no deeper nesting.

**Security finding:** each node record also contains `integrationConfig[]` with fields named like `apiKey`, `apiPassword`, `apiToken`, `client_secret`, `password`, `username`, `tenantToken` and terminal `accessToken` / `refreshToken`. These are credentials for third-party integrations. They must never be forwarded to the frontend, stored in MongoDB, cached or logged. The Feature 07 adapter whitelists fields into a small DTO (`id`, `name`, `parentId`, `sourceNodeId`, `sourceStatus`, `warnings`), so they are dropped; any future catalog code must keep using a whitelist, never pass raw node records through. Because the endpoint returns them, they should be reported to the GAAP/Simbisa owner (the API key can read them).

### Sales (`GET /sales`)

Sale-level fields relevant to the catalog:

| Source field                                                     | Type   | Observed | Meaning / use                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodeId`                                                         | string | 300/300  | Node `_id` (store). Brand = that node's root ancestor (see Brand mapping).                                                                                                                                                                        |
| `adminNodeId`, `adminNode`                                       | string | 300/300  | Did **not** equal any root node `_id` (0 of 50). Not a brand reference.                                                                                                                                                                           |
| `node`                                                           | string | 300/300  | A string (display value, not an object in this sample).                                                                                                                                                                                           |
| `items[]`                                                        | array  |          | Sale lines.                                                                                                                                                                                                                                       |
| `forex.selectedCurrency.currency`, `forex.baseCurrency.currency` | string | 20/20    | Currency candidates; **semantics unverified** (Feature 16).                                                                                                                                                                                       |
| `totalRecords`                                                   | number |          | **Equals the returned page size, not the number of matches** (limit 5 → 5, limit 300 → 300, also at `skip` 5 and 300). It cannot signal completeness. Pagination must stop on a short page; Feature 14 must handle this and cannot trust a total. |

Line (`items[]`) fields relevant to the catalog (83 lines in the first 50 sales; all present on every line):

| Source field                                           | Type             | Meaning / use                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `product._id`                                          | string           | **Product ID.** Present on 100% of lines. `productId` and `product.id` are **absent** on `items[]` (`product.id` appears only inside `associatedActivities`, a different structure). |
| `product.name`                                         | string           | Product display name. One ID never had two names in the sample (39 products).                                                                                                        |
| `product.primaryCode`                                  | string           | Product code (not verified as unique or stable).                                                                                                                                     |
| `product.departments[]`                                | array of objects | Department membership, see below.                                                                                                                                                    |
| `qty`, `lineTotals.turnover`, `productTotals.turnover` | number           | Quantity and turnover candidates (aggregation features own these).                                                                                                                   |

## Department hierarchy and category membership

Each line's `product.departments[]` has **exactly 2 entries on every line (564/564 in the 300-sale sample)**, each with four string fields: `groupId`, `group`, `departmentId`, `department`. None were blank.

Observed shape (sample): **2 distinct `groupId` values and 11 distinct `departmentId` values**; every department appeared under exactly one group, and one group held 10 of the 11 departments. IDs mapped to one name each (0 conflicts). This is consistent with **group ⊃ department**, but with 11 departments and 2 groups from one day, the hierarchy direction and the meaning of two entries per product are an **inference, not a documented fact**.

- Product → department membership is **embedded in sale lines**; it is read per sale, not from a product master.
- A product can belong to more than one department entry (always 2 here); whether entries represent different dimensions or a duplicate pair is **unknown**.
- Inactive, never-sold or recently changed products and departments **do not appear** in sale data.

## Brand-to-node mapping

- **Verified structurally:** every one of the 241 child nodes has a `parent` / `nodeId` / `path[0]` equal to one of 8 root node `_id`s. A sale's `nodeId` is a child (store) `_id`, so `sale → store → root` is derivable from `/nodes` alone, with no extra call.
- **Not verified:** that these 8 roots _are_ Simbisa brands. Their names look like brands, but no field in the payload says "brand". The relationship is a naming/structure inference.
- A brand ID on the sale itself does not exist (`adminNodeId` is not a root).

## Approved-source decision (proposal, needs owner approval)

| Catalog entity | Proposed source                                                                                                                                                                                                                                     | Status                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Nodes (stores) | `GET /nodes` (Feature 07)                                                                                                                                                                                                                           | **Verified**                                                                                  |
| Brands         | Root nodes of `GET /nodes` (`parent` chain), only **after** the owner confirms root = brand. Fallback: an explicit configured mapping (`CONFIGURED_MAPPING` in `catalogCache`) of brand label → root node `_id`, supplied and approved by the owner | **Blocked on confirmation**                                                                   |
| Departments    | Distinct `product.departments[]` values observed in `/sales` lines, only if the owner accepts a sales-derived list; otherwise an owner-supplied export                                                                                              | **Blocked**: no verified department endpoint, and sales-derived lists omit unsold departments |
| Products       | No verified product endpoint. Options: (a) sales-derived, which only contains products that sold in the scanned window, or (b) an approved import (owner-provided export) stored as `CONFIGURED_MAPPING`                                            | **Blocked**                                                                                   |

Rules for whichever source is approved: label provenance (`GAAP_UNITY` vs `CONFIGURED_MAPPING`) and freshness in `catalogCache`; never fabricate catalog data; an incomplete derived list must be labelled `incomplete`, not presented as the full catalog.

## Filtering by department/product in `/sales`

- `["nodeId", "eq", <id>]` works (300/300 returned lines matched). `["items.product._id", "eq", <id>]` is used in the existing sample script; it was not re-tested here.
- `["items.product.departments.departmentId", "eq", <id>]` with a real department ID returned **0 records**, while the same day without it returned 300. So that path **does not filter as expected** and must not be relied on. (An `ne` match on the same path was accepted without error, so the server does not reject unknown paths: **an accepted filter is not proof that it filters correctly.**)
- Consequence: department filtering must be done **after fetch, on normalized lines** (using `product.departments[]`), unless a working server-side path is confirmed. Product-ID filtering server-side is plausible but unverified here.

## Blockers (explicit unknowns)

1. **Product master source.** No documented or verified endpoint lists products. Owner/GAAP to confirm an endpoint or supply an approved import.
2. **Department master source and hierarchy.** No verified endpoint; group/department direction and the two-entries-per-product meaning need confirmation.
3. **Brand definition.** Owner to confirm that the 8 root nodes are the brands, or provide the mapping.
4. Server-side filter path for department (and confirmation for product) in `/sales`.
5. Coverage: this was one tenant, one day, 300 sales. Different dates, inactive products, refunds (`isNegative`) and other sale statuses were not examined.
6. Currency semantics (`forex.selectedCurrency` vs `baseCurrency`, `ZWL` vs `ZWG`) remain open (Feature 16). Note the existing `sample.js` defaults a missing currency to `USD`, which this project forbids; unknown must stay `UNKNOWN`.

## Next steps (not done in this feature)

- Owner answers blockers 1 to 3; then Feature 09 (catalog backend) implements the chosen source with `catalogCache` and provenance. Feature 10 builds brand and node filtering from the confirmed brand definition.
- Feature 14 must not use `/sales` `totalRecords` for completeness.
