/**
 * DEMO / MOCK integration status for the read-only Settings page.
 * Nothing here was checked against a live system; every entry is "not connected".
 * Never put endpoint URLs, keys or credentials in this file.
 */
export const INTEGRATIONS = Object.freeze([
  {
    id: 'gaap',
    name: 'GAAP Unity Data API',
    status: 'not-connected',
    detail:
      'Accessed only by the backend. Endpoints, field semantics and currency rules are unverified.',
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    status: 'not-connected',
    detail: 'Stores saved report snapshots. No connection exists in this build.',
  },
  {
    id: 'backend',
    name: 'Application API',
    status: 'not-connected',
    detail: 'The UI does not call the backend yet. Every screen reads local demo fixtures.',
  },
  {
    id: 'railway',
    name: 'Railway deployment',
    status: 'not-checked',
    detail: 'Deployment health is not checked from this prototype.',
  },
]);
