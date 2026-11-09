/**
 * DEMO / MOCK reference data. Not from GAAP Unity.
 *
 * Every id below is a made-up `DEMO-*` placeholder. Real department, product,
 * brand and node discovery is unverified (see architecture.md) and must not be
 * inferred from these fixtures.
 */

export const DEPARTMENTS = Object.freeze([
  { id: 'DEMO-DEPT-CHICKEN', name: 'Chicken' },
  { id: 'DEMO-DEPT-PIZZA', name: 'Pizza' },
  { id: 'DEMO-DEPT-BEVERAGES', name: 'Beverages' },
  { id: 'DEMO-DEPT-SIDES', name: 'Sides' },
  { id: 'DEMO-DEPT-DESSERTS', name: 'Desserts' },
]);

export const PRODUCTS = Object.freeze([
  { id: 'DEMO-PROD-001', name: 'Chicken 2-Piece Meal', departmentId: 'DEMO-DEPT-CHICKEN' },
  { id: 'DEMO-PROD-002', name: 'Chicken 4-Piece Meal', departmentId: 'DEMO-DEPT-CHICKEN' },
  { id: 'DEMO-PROD-003', name: 'Spicy Wings (6)', departmentId: 'DEMO-DEPT-CHICKEN' },
  { id: 'DEMO-PROD-004', name: 'Chicken Burger', departmentId: 'DEMO-DEPT-CHICKEN' },
  { id: 'DEMO-PROD-005', name: 'Margherita Pizza (Medium)', departmentId: 'DEMO-DEPT-PIZZA' },
  { id: 'DEMO-PROD-006', name: 'Pepperoni Pizza (Large)', departmentId: 'DEMO-DEPT-PIZZA' },
  { id: 'DEMO-PROD-007', name: 'Veggie Pizza (Medium)', departmentId: 'DEMO-DEPT-PIZZA' },
  { id: 'DEMO-PROD-008', name: 'Cola 500ml', departmentId: 'DEMO-DEPT-BEVERAGES' },
  { id: 'DEMO-PROD-009', name: 'Orange Juice 500ml', departmentId: 'DEMO-DEPT-BEVERAGES' },
  { id: 'DEMO-PROD-010', name: 'Bottled Water 500ml', departmentId: 'DEMO-DEPT-BEVERAGES' },
  { id: 'DEMO-PROD-011', name: 'Regular Chips', departmentId: 'DEMO-DEPT-SIDES' },
  { id: 'DEMO-PROD-012', name: 'Coleslaw', departmentId: 'DEMO-DEPT-SIDES' },
  { id: 'DEMO-PROD-013', name: 'Soft Serve Cone', departmentId: 'DEMO-DEPT-DESSERTS' },
  { id: 'DEMO-PROD-014', name: 'Sundae', departmentId: 'DEMO-DEPT-DESSERTS' },
]);

export const BRANDS = Object.freeze([
  { id: 'DEMO-BRAND-A', name: 'Demo Chicken Brand' },
  { id: 'DEMO-BRAND-B', name: 'Demo Pizza Brand' },
  { id: 'DEMO-BRAND-C', name: 'Demo Burger Brand' },
]);

export const NODES = Object.freeze([
  { id: 'DEMO-NODE-01', name: 'Harare CBD', brandId: 'DEMO-BRAND-A' },
  { id: 'DEMO-NODE-02', name: 'Bulawayo Centre', brandId: 'DEMO-BRAND-A' },
  { id: 'DEMO-NODE-03', name: 'Mutare Main', brandId: 'DEMO-BRAND-A' },
  { id: 'DEMO-NODE-04', name: 'Borrowdale', brandId: 'DEMO-BRAND-B' },
  { id: 'DEMO-NODE-05', name: 'Avondale', brandId: 'DEMO-BRAND-B' },
  { id: 'DEMO-NODE-06', name: 'Gweru Mall', brandId: 'DEMO-BRAND-B' },
  { id: 'DEMO-NODE-07', name: 'Chitungwiza', brandId: 'DEMO-BRAND-C' },
  { id: 'DEMO-NODE-08', name: 'Masvingo Plaza', brandId: 'DEMO-BRAND-C' },
]);

export const departmentById = (id) => DEPARTMENTS.find((d) => d.id === id);
export const productById = (id) => PRODUCTS.find((p) => p.id === id);
export const brandById = (id) => BRANDS.find((b) => b.id === id);
export const nodeById = (id) => NODES.find((n) => n.id === id);
