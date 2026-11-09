# Simbisa Multi-Currency Sales Reporting

Web-based management reporting for Simbisa product sales across brands and stores. It reports quantities and turnover separately per currency (USD, ZWG and others) using data from the GAAP Unity Data API.

> **Status:** Feature 01 (Project Bootstrap) only. No business features are implemented yet. See `context/progress-tracker.md`.

## Repository layout

| Path             | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `frontend/`      | React + Vite single-page app (JavaScript)                         |
| `backend/`       | Node.js + Express API (JavaScript, ES modules)                    |
| `shared/`        | Non-secret shared contracts and constants                         |
| `docs/`          | SRS, integration notes and runbooks                               |
| `context/`       | Product, architecture, standards and UI context; progress tracker |
| `features/`      | Numbered feature specifications (01–31)                           |
| `feature-specs/` | Reserved for feature specs (see its README)                       |

## Prerequisites

- Node.js 22.9 or later (the backend uses `node --env-file-if-exists`)
- npm 10 or later
- MongoDB (needed from Feature 05 onwards)

## Setup

```bash
npm install
cp backend/.env.example backend/.env     # fill in local values; never commit .env
cp frontend/.env.example frontend/.env   # optional; public values only
```

The GAAP API key belongs **only** in `backend/.env` locally and in Railway variables in deployment. Never put it in any `VITE_*` variable, because those are bundled into the browser.

## Running locally

```bash
npm run dev
```

This starts both apps together:

- Frontend: http://localhost:5173 (proxies `/api` to the backend)
- Backend: http://localhost:4000

Run one app on its own with `npm run dev:frontend` or `npm run dev:backend`.

## Workspace scripts

| Command                                   | What it does                                                        |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                             | Start backend and frontend in watch mode                            |
| `npm start`                               | Start the backend without watch mode                                |
| `npm run lint`                            | ESLint across all workspaces (one shared config)                    |
| `npm run format` / `npm run format:check` | Prettier write / check                                              |
| `npm test`                                | Vitest (frontend) and `node --test` (backend)                       |
| `npm run build`                           | Build every workspace that defines a build (currently the frontend) |

## Backend API

All endpoints are versioned under `/api/v1`.

| Endpoint             | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `GET /api/v1/health` | Liveness check. Returns status, uptime and timestamp only. |

Success responses use `{ "data": ..., "meta": { ... } }`. Errors use `{ "error": { "code", "message", "requestId" } }`, and every response carries an `X-Request-Id` header for log correlation.

| Error code                | Status | When                                                   |
| ------------------------- | ------ | ------------------------------------------------------ |
| `INVALID_JSON`            | 400    | Request body is not valid JSON                         |
| `CORS_ORIGIN_NOT_ALLOWED` | 403    | Browser origin is not in `CORS_ORIGIN`                 |
| `NOT_FOUND`               | 404    | No route matches                                       |
| `PAYLOAD_TOO_LARGE`       | 413    | Body exceeds `JSON_BODY_LIMIT`                         |
| `UNSUPPORTED_ENCODING`    | 415    | Body encoding or charset is unsupported                |
| `INTERNAL_ERROR`          | 500    | Unexpected failure; details are logged, never returned |

The backend validates its environment at startup and exits if a value is invalid. See `backend/.env.example`.

### MongoDB

`MONGODB_URI` is required. The server validates it, connects, creates indexes, and exits (code 1) if any step fails. Errors and logs never include the URI or driver messages, since they may contain credentials.

Collections (Mongoose models in `backend/src/models/`): `reports` (status, filters, per-currency totals, provenance, schema version, error metadata), `reportRows` (normalized lines, keyed by `reportId`) and `catalogCache` (source, key, payload, fetchedAt, expiresAt, freshness). Completed reports cannot be modified through Mongoose.

Database tests need a MongoDB server (default `mongodb://127.0.0.1:27017`, override with `MONGODB_TEST_URI`). They use a uniquely named `simbisa_test_*` database and drop it afterwards. If no server is reachable, those tests are skipped and reported as skipped.

### GAAP HTTP client

`backend/src/modules/gaap/` holds the only code allowed to call GAAP. `createGaapClient({ config })` exposes an endpoint-agnostic `request({ method, path, params, data, signal, requestId })` (and a `get` shortcut). Startup now requires the GAAP variables (fails fast). Endpoint adapters live beside it (`nodes.adapter.js`); `/sales` comes in a later feature.

- Config: `GAAP_API_BASE_URL` (https) and `GAAP_API_KEY` are required by `loadGaapConfig()`; optional `GAAP_TIMEOUT_MS`, `GAAP_MAX_CONCURRENCY`, `GAAP_MAX_RETRIES`, `GAAP_RETRY_BASE_DELAY_MS`. See `backend/.env.example`.
- The key travels as the `apikey` query parameter, so URLs, query values, bodies and Axios errors are never logged or returned. Redirects are not followed and absolute URLs in `path` are rejected.
- Retries (default 2, exponential backoff with jitter, honours `Retry-After`, capped) apply only to timeouts, network errors and HTTP 408/429/502/503/504, and only for GET/HEAD/OPTIONS unless the caller sets `idempotent: true`.
- Failures are always a `GaapError` with a stable `code` (`GAAP_TIMEOUT`, `GAAP_NETWORK_ERROR`, `GAAP_RATE_LIMITED`, `GAAP_UNAVAILABLE`, `GAAP_UPSTREAM_ERROR`, `GAAP_AUTH_ERROR`, `GAAP_NOT_FOUND`, `GAAP_BAD_REQUEST`, `GAAP_INVALID_RESPONSE`, `GAAP_RESPONSE_TOO_LARGE`, `GAAP_ABORTED`, `GAAP_INVALID_REQUEST`).
- Tests use scripted fixtures and a loopback server only. They are not live GAAP evidence.

### Nodes (`GET /api/v1/nodes`)

Reads GAAP `GET /nodes` (paged with `limit`/`skip`, at most 10 pages of 1000), normalizes, **stores the result in MongoDB** (`catalogCache`, source `GAAP_UNITY`, key `nodes`) and serves it from there. GAAP is called only when nothing is stored yet or on `POST /api/v1/nodes/refresh` (same query parameters), so reloading a page never makes a GAAP request. Stored nodes older than `NODES_CACHE_TTL_HOURS` (default 24) are still served, labelled `meta.cacheFreshness: "stale"`. Only normalized fields are stored; raw GAAP node records (which can contain integration credentials) are never saved or returned. A failed refresh leaves the stored nodes untouched. Query: `limit` (1-1000, default 500) and `offset` (>= 0); anything else is a 400 `INVALID_QUERY`.

- Each node: `id` (GAAP `_id`, unique), `name` (`tradingDetails.name`, else `name`, else null), `parentId`, `sourceNodeId`, `sourceStatus` (raw values, meaning unverified) and `warnings`. There is no brand field: the brand relationship is unverified.
- `meta`: `source`, `origin` (`database` or `gaap`), `persisted`, `cacheFreshness` (`fresh`/`stale`/`incomplete`), `cacheExpiresAt`, `fetchedAt`, `complete` (false means the list may be missing nodes), `total`, `limit`, `offset`, `returned`, `upstreamTotal`, `malformedCount`, `malformed` (first 50: index, reason, id), `warningCount`.
- Non-object records, records without a usable `_id` and duplicate ids are excluded and listed in `meta.malformed`; the request still succeeds. GAAP failures map to 504 `GAAP_TIMEOUT`, 503 `GAAP_UNAVAILABLE` or 502 `GAAP_UPSTREAM_ERROR` with no upstream detail. Nothing is cached yet (Feature 19).

### Catalog (`/api/v1/catalog`)

Product and department selection data from GAAP `GET /products` (endpoint and payload shape supplied by the project owner), paged with `limit`/`skip` (1000 per page, at most 50 pages). Only `_id`, `name`, `primaryCode`, `status`, `isDeleted` and `departments[]` are read; pricing, recipes and the rest are never stored or returned. The result is **stored in MongoDB** (`catalogCache`, source `GAAP_UNITY`, key `catalog`) and served from there: GAAP is called only when nothing is stored or on `POST /api/v1/catalog/refresh`, so reloading a page never calls GAAP. `CATALOG_CACHE_TTL_HOURS` (default 24) only sets `meta.expired` and `cacheFreshness: "stale"`; stale data is still served. `meta.complete` is false only if the page cap truncated the list. Inactive (`status` not true) and deleted (`isDeleted`) products are excluded (`meta.scan.excludedInactive`), and only the **POS Department** group's departments are used; other groups (e.g. Reporting) are ignored.

- `GET /departments` — departments sorted by name then id: `id` (`departmentInGroup`), `name`, `groupId` (`departmentGroup`, e.g. POS Department or Reporting), `groupName`, `productCount`, `warnings`.
- `GET /departments/:departmentId/products` — products in that department (404 `DEPARTMENT_NOT_FOUND` if unknown): `id`, `name`, `code`, `departmentIds`, `mapped`, `warnings`.
- `GET /products/unmapped` — products with no POS department (`mapped: false`, warning `UNMAPPED_DEPARTMENT`). Membership is never guessed.
- `POST /refresh` — explicit GAAP read that replaces the stored catalog (same query as the departments list). A failed refresh keeps the old data.
- `POST /products/validate` — body `{ "productIds": [...] }`; returns the ids unique and sorted. 400 `INVALID_SELECTION` for an empty or malformed list, 422 `UNKNOWN_PRODUCT` (ids in `error.details.unknownIds`) for ids that are not current selectable products.
- All lists take `limit` (1-1000, default 100) and `offset` (>= 0); anything else is 400 `INVALID_QUERY`.
- A repeated product `_id` keeps the first record and is listed in `meta.malformed`.

### Brand and node filters (`/api/v1/filters/nodes`)

Built on the stored nodes (no extra GAAP calls). **Brand definition is an unverified assumption:** a brand is a top-level node (`sourceNodeId === id`) that has child nodes; its nodes are those whose `parentId` is the brand id. Top-level nodes without children are ordinary, ungrouped nodes. `meta.brandDefinition` says so on every response.

- `GET /filters/nodes` — `{ brands: [{ id, name, nodeIds }], nodes: [{ id, name, brandId|null }] }`, sorted by name then id. Brands are not in `nodes`. `meta` carries `origin`, `fetchedAt`, `cacheFreshness`, `complete`, `brandCount`, `nodeCount`.
- `POST /filters/nodes/resolve` — body `{ "mode": "all" }`, `{ "mode": "brands", "brandIds": [...] }` or `{ "mode": "nodes", "nodeIds": [...] }`. Returns the exact permitted node IDs: unique, sorted by id. All-nodes mode must be requested explicitly. Invalid bodies (unknown field, wrong mode/ids combination, empty list) are 400 `INVALID_SELECTION`. A brand or node id that is not in the current list (stale mapping) is 422 `UNKNOWN_BRAND` / `UNKNOWN_NODE` with `error.details.unknownIds`; it is never silently dropped. A selection that resolves to zero nodes is 422 `NO_NODES`.

## Frontend

React 19 + Vite + React Router + Tailwind CSS v4 + shadcn/ui (JavaScript, dark-only).

- Theme tokens live in `frontend/src/styles/globals.css` (source: `context/ui-context.md`). Use semantic utilities such as `bg-surface` and `text-text-muted`; never raw hex values.
- Routes are defined in `frontend/src/routes/routes.jsx`; sidebar items in `frontend/src/routes/paths.js`.
- Browser requests go through `frontend/src/lib/api-client.js` to the app's own `/api/v1` only. Never put secrets in `VITE_*` variables.
- Add shadcn/ui primitives under `frontend/src/components/ui/` (config: `frontend/components.json`).

## Railway deployment overview

Full deployment configuration arrives in Feature 30. The intended shape is:

1. One Railway project containing two services built from this monorepo: `backend` (Express, `npm start`) and `frontend` (Vite static build from `frontend/dist`).
2. A managed MongoDB instance whose connection string is set as `MONGODB_URI` on the backend service.
3. Secrets such as `GAAP_API_KEY` set only as backend service variables. They are never committed or exposed to the frontend.
4. `CORS_ORIGIN` on the backend set to the deployed frontend URL.
5. Access restricted at the infrastructure level before exposure. v1 has no application authentication, and Railway hosting alone is not access control.
   ed yet (Feature 19).

### Hybrid cache layer

Nodes and the catalog share one read-through cache (`backend/src/modules/cache/read-through-cache.js`). Every nodes/catalog response has `meta.cache`: `status` (`hit`, `miss`, `refresh`, `stale_fallback`), `hit`, `source`, `key`, `fetchedAt`, `expiresAt`, `freshness` (`fresh`, `stale`, `incomplete`), `refreshPolicy`, `fallback` and `persisted`. Policy per cache is set with `NODES_`/`CATALOG_` `CACHE_TTL_HOURS`, `CACHE_REFRESH_POLICY` (`manual` default, or `on_expiry`) and `CACHE_RETRY_COOLDOWN_SECONDS`. Under `on_expiry`, if GAAP fails the stored copy is served labelled `stale` (`fallback: UPSTREAM_UNAVAILABLE`); with nothing stored the error is returned and nothing is invented. Concurrent refreshes share one GAAP call per process. **Sales are not cached**: `SALES_CACHE_ENABLED` other than `false` aborts startup until completeness, invalidation and reconciliation rules are approved.
