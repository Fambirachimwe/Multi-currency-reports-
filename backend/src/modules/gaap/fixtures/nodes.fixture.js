/**
 * FIXTURE: hand-written GAAP `GET /nodes` payloads for contract tests. Invented names and ids;
 * no real data. The SHAPE follows what was observed live on 2026-11-07 (see nodes.adapter.js):
 * `{ totalRecords, data: [...] }`, `_id` unique, `nodeId` shared by children, `status` a string.
 * Passing against these proves the adapter's mapping, not that GAAP still behaves this way.
 */

const id = (n) => n.toString(16).padStart(24, '0');

/** A child store: `nodeId` equals `parent` and is shared with siblings. */
export function fixtureStore(n, overrides = {}) {
  return {
    _id: id(n),
    nodeType: 'admin',
    tradingDetails: { name: `Store ${String(n).padStart(3, '0')}` },
    parent: id(1),
    status: '1',
    nodeId: id(1),
    baseCurrency: 'USD',
    path: [id(1), id(n)],
    ...overrides,
  };
}

/** A top-level record: `nodeId` equals its own `_id`. */
export function fixtureRoot(n, overrides = {}) {
  return {
    _id: id(n),
    nodeType: 'admin',
    tradingDetails: { name: `Group ${n}` },
    parent: id(900),
    status: '1',
    nodeId: id(n),
    baseCurrency: 'USD',
    path: [id(n)],
    ...overrides,
  };
}

export const FIXTURE_ID = id;

export function fixturePage(records, totalRecords = records.length) {
  return { totalRecords, data: records };
}

/** Realistic mixed page: roots, children sharing a nodeId, unsorted. */
export const MIXED_NODES = [
  fixtureStore(12),
  fixtureRoot(1),
  fixtureStore(10),
  fixtureStore(11, { status: '3' }),
];
