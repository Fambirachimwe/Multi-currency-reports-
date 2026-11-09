/**
 * Pure helpers for the report filter form. They hold UI selection state only;
 * report numbers are never computed in the browser.
 *
 * Date range rules live in `date-range.js`. The reporting timezone is Africa/Harare; the GAAP `createdDate`
 * boundary mapping is an open decision (docs/date-range-semantics.md).
 */

import { validateDateRange } from '@/features/reports/date-range';

export { isValidDate } from '@/features/reports/date-range';

/**
 * `departmentId` is browse state only (which department's products are listed); the report filter
 * is `productIds`. Selection lives in form state only and is not saved anywhere.
 * @typedef {{departmentId: string, productIds: string[], nodeMode: 'all'|'brands'|'nodes', brandIds: string[], nodeIds: string[], startDate: string, endDate: string}} ReportFilters */

/** @type {ReportFilters} */
export const EMPTY_FILTERS = Object.freeze({
  departmentId: '',
  productIds: [],
  // All-nodes is an explicit choice; the default is a manual selection that starts empty.
  nodeMode: 'nodes',
  brandIds: [],
  nodeIds: [],
  startDate: '',
  endDate: '',
});

/**
 * Choosing a department only changes which products are browsed. The product selection spans
 * departments and is never dropped by browsing.
 */
export function withDepartment(filters, departmentId) {
  return { ...filters, departmentId };
}

/** Drops the given product ids from the selection (deselect, or remove unavailable products). */
export function withoutProducts(filters, productIds) {
  const gone = new Set(productIds);
  return { ...filters, productIds: filters.productIds.filter((id) => !gone.has(id)) };
}

/** The body for the backend's `POST /filters/nodes/resolve`; only the active mode's ids. */
export function nodeSelectionBody(filters) {
  if (filters.nodeMode === 'all') return { mode: 'all' };
  if (filters.nodeMode === 'brands') return { mode: 'brands', brandIds: filters.brandIds };
  return { mode: 'nodes', nodeIds: filters.nodeIds };
}

/**
 * Validate the filter set before a report could be generated.
 * @returns {Record<string, string>} field → message; empty when valid.
 */
export function validateFilters(filters) {
  const errors = {};
  if (filters.productIds.length === 0) errors.productIds = 'Select at least one product.';
  if (filters.nodeMode === 'brands' && filters.brandIds.length === 0) {
    errors.nodeIds = 'Select at least one brand.';
  }
  if (filters.nodeMode === 'nodes' && filters.nodeIds.length === 0) {
    errors.nodeIds = 'Select at least one node.';
  }

  return { ...errors, ...validateDateRange(filters) };
}

/** Departments grouped under their department group, in the order the backend returned them. */
export function groupDepartments(departments) {
  const groups = new Map();
  for (const department of departments) {
    const key = department.groupId ?? '';
    if (!groups.has(key)) {
      groups.set(key, { id: key, name: department.groupName ?? 'Other', departments: [] });
    }
    groups.get(key).departments.push(department);
  }
  return [...groups.values()];
}
