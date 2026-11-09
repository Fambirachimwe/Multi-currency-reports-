/**
 * FIXTURE: hand-written GAAP `GET /sales` payloads for pagination tests. Invented ids, no real
 * data. Only the fields the paging adapter reads are present (`_id`, `createdDate`, `status`,
 * `isNegative`, `nodeId`, `items[].product._id`), matching the live shape observed 2026-11-08.
 * Passing against these proves the adapter's paging logic, not GAAP's behaviour.
 */

export const fixtureId = (n) => `sale${String(n).padStart(6, '0')}`;

export function fixtureSale(n, overrides = {}) {
  return {
    _id: fixtureId(n),
    createdDate: `2026-11-05T${String(8 + (Math.floor(n / 3600) % 12)).padStart(2, '0')}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
    status: 'TENDERED',
    isNegative: false,
    nodeId: 'node-a',
    items: [{ product: { _id: 'prod-1' }, qty: 1 }],
    ...overrides,
  };
}

export function fixtureSales(from, count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => fixtureSale(from + i, overrides));
}

/** `totalRecords` mirrors live behaviour: the page size, not the match count. */
export function fixturePage(records, limit = records.length) {
  return { totalRecords: limit, data: records };
}
