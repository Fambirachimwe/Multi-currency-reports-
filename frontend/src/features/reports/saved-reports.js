/**
 * Pure display helpers for the Saved Reports list. They only describe what the server sent;
 * nothing here recalculates or infers report data.
 */
import { formatDateTime } from '@/lib/format';

export const PAGE_SIZE = 20;

export const STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'In progress' },
  { value: 'failed', label: 'Failed' },
]);

export const SORT_OPTIONS = Object.freeze([
  { value: 'createdAt', label: 'Generated date' },
  { value: 'startDate', label: 'Report start date' },
  { value: 'status', label: 'Status' },
]);

/** "20261105" -> "2026-11-05"; anything else shows an em dash (missing is not a date). */
export function formatCompactDate(value) {
  return typeof value === 'string' && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '—';
}

export function describeDateRange(filters) {
  const start = formatCompactDate(filters?.startDate);
  const end = formatCompactDate(filters?.endDate);
  return start === end && start !== '—' ? start : `${start} → ${end}`;
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Counts of what was selected. Unknown counts are omitted, never shown as 0. */
export function describeSelection(filters) {
  const parts = [];
  if (Number.isInteger(filters?.productCount)) parts.push(plural(filters.productCount, 'product'));
  if (Number.isInteger(filters?.nodeCount)) parts.push(plural(filters.nodeCount, 'node'));
  if (Number.isInteger(filters?.brandCount) && filters.brandCount > 0) {
    parts.push(plural(filters.brandCount, 'brand'));
  }
  return parts.length > 0 ? parts.join(' · ') : 'Not recorded';
}

/**
 * Where the report's data came from and how current it was when saved. Cached data is never
 * described as live, and incomplete source data is called out.
 */
export function describeFreshness(provenance) {
  if (provenance === null || provenance === undefined) return 'Not recorded';
  if (!provenance.fetchedAt) return 'Not fetched yet';
  const fetched = `fetched ${formatDateTime(provenance.fetchedAt)}`;
  if (provenance.complete === false) return `Incomplete source data · ${fetched}`;
  if (provenance.usedCache === true) {
    const freshness = provenance.cacheFreshness === 'stale' ? 'stale' : 'fresh';
    return `Cached (${freshness}) · ${fetched}`;
  }
  return `Live from GAAP · ${fetched}`;
}

/** Which instant to show as "generated": completion, else failure, else when it was requested. */
export function generatedAt(report) {
  return report.completedAt ?? report.failedAt ?? report.createdAt ?? null;
}
