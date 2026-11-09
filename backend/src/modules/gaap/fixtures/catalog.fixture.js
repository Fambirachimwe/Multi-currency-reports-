/**
 * FIXTURE: hand-written GAAP `GET /products` payloads for catalog tests. Invented ids and names;
 * no real data. The SHAPE follows the sample supplied by the project owner (2026-11-07):
 * `_id`, `name`, `primaryCode`, `status`, `isDeleted`, and `departments[]` entries of
 * `{ departmentGroup, departmentInGroup, departmentGroupName, departmentInGroupName }`.
 * Passing against these proves the mapping logic, not that GAAP still behaves this way.
 */

export const dept = (n, groupN = 1) => ({
  _id: `FX-ENTRY-${n}-${groupN}`,
  departmentGroup: `FX-GROUP-${groupN}`,
  // Group 1 is the POS Department (the only group exposed); group 2 is Reporting (ignored).
  departmentGroupName: groupN === 1 ? 'POS Department' : 'Reporting',
  departmentInGroup: `FX-DEPT-${n}`,
  departmentInGroupName: `Department ${String.fromCharCode(64 + n)}`,
});

/** A product record carrying extra fields that must never reach the output. */
export function fixtureProduct(n, departments, overrides = {}) {
  return {
    _id: `FX-PROD-${n}`,
    nodeId: 'FX-NODE-1',
    status: true,
    isDeleted: false,
    name: `Product ${n}`,
    primaryCode: `CODE-${n}`,
    pricing: { hqCost: 1.5, pricings: [{ sellingInclusive: 9 }] },
    recipe: [{ productId: 'FX-INGREDIENT' }],
    departments,
    ...overrides,
  };
}

export const fixturePage = (records, totalRecords = records.length) => ({
  totalRecords,
  data: records,
});

/** Unsorted; products 1-3 also have a Reporting entry (ignored); product 9 has no department. */
export const MIXED_PRODUCTS = [
  fixtureProduct(3, [dept(2), dept(5, 2)]),
  fixtureProduct(1, [dept(1), dept(5, 2)]),
  fixtureProduct(9, []),
  fixtureProduct(2, [dept(2), dept(5, 2)]),
];
