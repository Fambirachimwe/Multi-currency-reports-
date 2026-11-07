# Progress Tracker

Update this file after every meaningful implementation
change.

## Current Phase

- Feature 01: Project Bootstrap — Done (awaiting approval before Feature 02).

## Current Goal

- Obtain approval for Feature 01, then start Feature 02 (Backend Foundation).

## Completed

### Feature 01: Project Bootstrap — Done (2026-11-07)

**Files created/changed**

- Root: `package.json` (npm workspaces: frontend, backend, shared), `package-lock.json`, `eslint.config.js` (single shared ESLint flat config), `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.gitattributes`, `.env.example`, `README.md`.
- `frontend/`: Vite + React (JavaScript) scaffold reduced to a placeholder page — `package.json`, `index.html`, `vite.config.js` (dev proxy `/api` → backend), `src/main.jsx`, `src/App.jsx`, `src/App.test.jsx`, `src/index.css`, `public/favicon.svg`, `.env.example`.
- `backend/`: Express 5 (ES modules) — `package.json`, `src/app.js` (`createApp`), `src/server.js`, `src/app.test.js`, `.env.example`.
- `shared/`: `package.json`, `src/index.js` (empty export), `README.md`.
- `docs/README.md`, `feature-specs/README.md`.
- Git repository initialized (`main`); none existed before.

**Dependencies**

- frontend runtime: react, react-dom. dev: vite, @vitejs/plugin-react, vitest.
- backend runtime: express. (axios, mongoose, exceljs deferred to the features that need them.)
- root dev: eslint, @eslint/js, globals, eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint-config-prettier, prettier, concurrently.

**Verification evidence (2026-11-07, Node v22.22.0, npm 10.9.4)**

| Command | Result |
| --- | --- |
| `npm run lint` | Pass (0 problems) |
| `npm run lint --workspaces --if-present` | Pass in frontend, backend, shared |
| `npm run format:check` | Pass |
| `npm test` | Pass — frontend Vitest 1/1, backend `node --test` 1/1 |
| `npm run build` | Pass — frontend `vite build` produced `frontend/dist` |
| `npm run dev` | Both started: frontend http://localhost:5173 → 200; backend http://localhost:4000 → 404 (expected, no routes until Feature 02); Vite `/api` proxy reaches backend |
| `git status` / `git grep` on staged files | No `.env`, `node_modules`, `dist`, `sample.js` or GAAP key tracked |

**Checks not run / limitations**

- Backend and shared have no build step; root `build` runs only workspaces that define one.
- No GAAP, MongoDB or Railway access was used or required. Nothing here is live-integration evidence.
- Failure/invalid-input cases: not applicable yet (no endpoints or inputs exist).

## In Progress

- None.

## Next Up

- Feature 02: Backend Foundation (health endpoint, error envelope, CORS, 404 handler).
- Feature 03: Frontend Foundation can follow independently (Router, Tailwind, shadcn/ui, tokens).

## Open Questions

- **Exposed GAAP API key (security blocker for go-live):** root `sample.js` contains a hardcoded GAAP API key. It is git-ignored and was not committed, but architecture.md requires rotating any previously exposed key. Owner must rotate it and decide whether to delete `sample.js` or move its logic to reference docs without the key.
- **Spec folder location:** Feature 01 asks for `feature-specs/` and `docs/`, but specs live in `features/` and context docs in `context/` (as CLAUDE.md references). Folders were created with pointer READMEs; nothing was moved. Decide which location is canonical.
- **Dev-dependency audit:** `npm audit` reports 4 moderate findings (minimatch ReDoS) via eslint 10 tooling. Dev-only, not shipped. The only automatic fix downgrades ESLint to 9. Revisit when upstream patches.

## Architecture Decisions

- **npm workspaces monorepo** (`frontend`, `backend`, `shared`) with a single root lockfile — matches the approved monorepo architecture.
- **ESLint (flat config) + Prettier at the root** as the single shared configuration, replacing the oxlint default from create-vite — code-standards.md mandates ESLint and Prettier.
- **ES modules everywhere** (`"type": "module"`) — code-standards.md.
- **Backend env loading via Node's `--env-file-if-exists`** instead of dotenv — avoids an extra dependency; requires Node ≥ 22.9 (declared in `engines`).
- **Test runners:** Vitest for the frontend (shares Vite config), built-in `node --test` for the backend. Feature 02 may add supertest.
- **Vite dev proxy** sends `/api` to the backend so the browser only talks to the app's own API.

## Session Notes

- 2026-11-07: Feature 01 completed. Tailwind, shadcn/ui, Router (Feature 03) and Express health/CORS/error handling (Feature 02) intentionally not added.
- Copy `backend/.env.example` to `backend/.env` for local values; never commit `.env` files.
