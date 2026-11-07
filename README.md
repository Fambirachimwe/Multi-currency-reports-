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

## Railway deployment overview

Full deployment configuration arrives in Feature 30. The intended shape is:

1. One Railway project containing two services built from this monorepo: `backend` (Express, `npm start`) and `frontend` (Vite static build from `frontend/dist`).
2. A managed MongoDB instance whose connection string is set as `MONGODB_URI` on the backend service.
3. Secrets such as `GAAP_API_KEY` set only as backend service variables. They are never committed or exposed to the frontend.
4. `CORS_ORIGIN` on the backend set to the deployed frontend URL.
5. Access restricted at the infrastructure level before exposure. v1 has no application authentication, and Railway hosting alone is not access control.
