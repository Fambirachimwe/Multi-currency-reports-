/**
 * DEMO / MOCK saved-report fixtures. Not from GAAP Unity or MongoDB.
 *
 * Amounts and quantities are decimal strings, as the real API is expected to
 * send them. Per-currency summary totals are precomputed here (with integer
 * cents) because the backend is authoritative for totals: UI code displays
 * them and never recalculates. Currencies are never combined; `UNKNOWN` rows
 * stay separate and carry a warning.
 */
import { brandById, departmentById, nodeById, productById } from '@/mocks/catalog';

const toCents = (amount) => Math.round(Number(amount) * 100);
const fromCents = (cents) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** [nodeId, productId, currency, quantity, turnover] */
function detailRows(rows) {
  return rows.map(([nodeId, productId, currency, quantity, turnover], index) => {
    const node = nodeById(nodeId);
    const product = productById(productId);
    return {
      id: `row-${index + 1}`,
      nodeId,
      nodeName: node.name,
      brandName: brandById(node.brandId).name,
      departmentName: departmentById(product.departmentId).name,
      productId,
      productName: product.name,
      currency,
      quantity: String(quantity),
      turnover,
    };
  });
}

/** Fixture construction only: group by node + currency using integer cents. */
function summaryRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.nodeId}|${row.currency}`;
    const group = groups.get(key) ?? { ...row, quantity: 0, cents: 0 };
    group.quantity += Number(row.quantity);
    group.cents += toCents(row.turnover);
    groups.set(key, group);
  }
  return [...groups.values()].map((g, index) => ({
    id: `sum-${index + 1}`,
    nodeId: g.nodeId,
    nodeName: g.nodeName,
    brandName: g.brandName,
    currency: g.currency,
    quantity: String(g.quantity),
    turnover: fromCents(g.cents),
  }));
}

/** Fixture construction only: one total per currency, never a mixed total. */
function currencyTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const total = totals.get(row.currency) ?? { currency: row.currency, quantity: 0, cents: 0 };
    total.quantity += Number(row.quantity);
    total.cents += toCents(row.turnover);
    totals.set(row.currency, total);
  }
  return [...totals.values()].map((t) => ({
    currency: t.currency,
    quantity: String(t.quantity),
    turnover: fromCents(t.cents),
  }));
}

const chickenDetails = detailRows([
  ['DEMO-NODE-01', 'DEMO-PROD-001', 'USD', 412, '2060.00'],
  ['DEMO-NODE-01', 'DEMO-PROD-001', 'ZWG', 380, '57000.00'],
  ['DEMO-NODE-01', 'DEMO-PROD-002', 'USD', 268, '2144.00'],
  ['DEMO-NODE-01', 'DEMO-PROD-003', 'USD', 190, '855.50'],
  ['DEMO-NODE-02', 'DEMO-PROD-001', 'USD', 305, '1525.00'],
  ['DEMO-NODE-02', 'DEMO-PROD-001', 'ZWG', 210, '31500.00'],
  ['DEMO-NODE-02', 'DEMO-PROD-002', 'ZWG', 144, '28800.00'],
  ['DEMO-NODE-02', 'DEMO-PROD-003', 'USD', 98, '441.00'],
  ['DEMO-NODE-03', 'DEMO-PROD-001', 'USD', 120, '600.00'],
  ['DEMO-NODE-03', 'DEMO-PROD-002', 'ZWG', 75, '15000.00'],
  ['DEMO-NODE-03', 'DEMO-PROD-003', 'UNKNOWN', 12, '54.00'],
]);

const pizzaDetails = detailRows([
  ['DEMO-NODE-04', 'DEMO-PROD-005', 'USD', 220, '1980.00'],
  ['DEMO-NODE-04', 'DEMO-PROD-006', 'USD', 175, '2187.50'],
  ['DEMO-NODE-05', 'DEMO-PROD-005', 'USD', 140, '1260.00'],
  ['DEMO-NODE-05', 'DEMO-PROD-005', 'ZWG', 96, '28800.00'],
  ['DEMO-NODE-05', 'DEMO-PROD-006', 'ZWG', 64, '24000.00'],
  ['DEMO-NODE-06', 'DEMO-PROD-007', 'ZWG', 58, '14500.00'],
]);

function completedReport(base, details) {
  return {
    ...base,
    status: 'completed',
    detailRows: details,
    summaryRows: summaryRows(details),
    totals: currencyTotals(details),
  };
}

export const MOCK_REPORTS = Object.freeze([
  completedReport(
    {
      id: 'demo-rpt-001',
      name: 'October chicken sales',
      generatedAt: '2026-11-03T08:15:00.000Z',
      dateRange: { start: '2026-10-01', end: '2026-10-31' },
      department: 'Chicken',
      products: ['Chicken 2-Piece Meal', 'Chicken 4-Piece Meal', 'Spicy Wings (6)'],
      brand: 'Demo Chicken Brand',
      nodes: ['Harare CBD', 'Bulawayo Centre', 'Mutare Main'],
      warnings: [
        '1 row has an unknown currency (UNKNOWN). It is shown separately and is not counted as USD or ZWG.',
      ],
    },
    chickenDetails,
  ),
  {
    id: 'demo-rpt-002',
    name: 'Q3 beverages',
    status: 'failed',
    generatedAt: '2026-11-02T14:40:00.000Z',
    dateRange: { start: '2026-07-01', end: '2026-09-30' },
    department: 'Beverages',
    products: ['Cola 500ml', 'Orange Juice 500ml'],
    brand: 'Demo Burger Brand',
    nodes: ['Chitungwiza', 'Masvingo Plaza'],
    warnings: [],
    errorSummary:
      'Demo failure: the source system could not be reached. No partial data was saved.',
    detailRows: [],
    summaryRows: [],
    totals: [],
  },
  {
    id: 'demo-rpt-003',
    name: 'Weekend pizza run',
    status: 'pending',
    generatedAt: '2026-11-05T16:02:00.000Z',
    dateRange: { start: '2026-10-30', end: '2026-11-02' },
    department: 'Pizza',
    products: ['Margherita Pizza (Medium)'],
    brand: 'Demo Pizza Brand',
    nodes: ['Borrowdale', 'Avondale'],
    warnings: [],
    detailRows: [],
    summaryRows: [],
    totals: [],
  },
  completedReport(
    {
      id: 'demo-rpt-004',
      name: 'September pizza sales',
      generatedAt: '2026-10-02T09:30:00.000Z',
      dateRange: { start: '2026-09-01', end: '2026-09-30' },
      department: 'Pizza',
      products: ['Margherita Pizza (Medium)', 'Pepperoni Pizza (Large)', 'Veggie Pizza (Medium)'],
      brand: 'Demo Pizza Brand',
      nodes: ['Borrowdale', 'Avondale', 'Gweru Mall'],
      warnings: [],
    },
    pizzaDetails,
  ),
]);

export const getMockReport = (id) => MOCK_REPORTS.find((report) => report.id === id);
