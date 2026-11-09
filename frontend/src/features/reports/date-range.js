/**
 * Report date range: validation, normalization and API serialization (pure, no I/O).
 *
 * Semantics (see docs/date-range-semantics.md):
 * - Dates are calendar dates written as YYYYMMDD, the format GAAP's createdDate filter uses in
 *   sample.js ("20261105"). They carry no time or timezone and are never
 *   converted through the browser's local timezone.
 * - The range is INCLUSIVE of both days: start 20261001, end 20261031 covers 31 days.
 * - Reporting timezone (owner decision, 2026-11-08): Central Africa Time, Africa/Harare (UTC+2, no
 *   daylight saving). "Today", and therefore "future", is judged in that timezone.
 * - Future dates are rejected.
 * - OPEN DECISION (unconfirmed): how a day maps to GAAP's `createdDate` boundaries. Nothing here
 *   converts a date to an instant.
 */

export const REPORTING_TIMEZONE = 'Africa/Harare';

const COMPACT_DATE = /^\d{8}$/;
const MS_PER_DAY = 86_400_000;

/**
 * Provisional cap on the span in days (inclusive count). The architecture requires a cap but no
 * value is approved yet; override with VITE_REPORT_MAX_RANGE_DAYS. The server must enforce its own.
 */
export const DEFAULT_MAX_RANGE_DAYS = 92;

export function configuredMaxRangeDays(env = import.meta.env) {
  const raw = env?.VITE_REPORT_MAX_RANGE_DAYS;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return DEFAULT_MAX_RANGE_DAYS;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_MAX_RANGE_DAYS;
}

/** True only for a real calendar date written as YYYYMMDD (rejects 20260230, 20261301, 2026-10-01). */
export function isValidDate(value) {
  if (typeof value !== 'string' || !COMPACT_DATE.test(value)) return false;
  const date = new Date(`${toInputValue(value)}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && fromInputValue(date.toISOString().slice(0, 10)) === value;
}

/**
 * Conversion for the browser's `<input type="date">`, which only speaks YYYY-MM-DD. The app itself
 * uses YYYYMMDD; this is used only at that edge. Anything that is not a full date maps to ''.
 */
export function toInputValue(value) {
  return typeof value === 'string' && COMPACT_DATE.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '';
}

export function fromInputValue(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.replaceAll('-', '')
    : '';
}

/** Number of calendar days from start to end, counting both ends; null if either is invalid. */
export function inclusiveDayCount(startDate, endDate) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) return null;
  const start = Date.parse(`${toInputValue(startDate)}T00:00:00.000Z`);
  const end = Date.parse(`${toInputValue(endDate)}T00:00:00.000Z`);
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/** Today's calendar date (YYYYMMDD) in the reporting timezone, whatever the browser's timezone. */
export function todayInReportingTimezone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

/**
 * @param {{startDate: string, endDate: string}} range
 * @param {{maxDays?: number, today?: string}} [options] `today` (YYYYMMDD) is for tests.
 * @returns {Record<string, string>} field → message; empty when valid.
 */
export function validateDateRange(
  range,
  { maxDays = configuredMaxRangeDays(), today = todayInReportingTimezone() } = {},
) {
  const errors = {};
  const startOk = isValidDate(range.startDate);
  const endOk = isValidDate(range.endDate);
  if (!startOk) {
    errors.startDate = range.startDate ? 'Enter a valid start date.' : 'Choose a start date.';
  }
  if (!endOk) {
    errors.endDate = range.endDate ? 'Enter a valid end date.' : 'Choose an end date.';
  }
  if (!startOk || !endOk) return errors;

  if (range.startDate > today) errors.startDate = 'Start date cannot be in the future.';
  if (range.endDate > today) errors.endDate = 'End date cannot be in the future.';
  if (errors.startDate || errors.endDate) return errors;

  if (range.startDate > range.endDate) {
    errors.endDate = 'End date must be on or after the start date.';
    return errors;
  }
  const days = inclusiveDayCount(range.startDate, range.endDate);
  if (days > maxDays) {
    errors.endDate = `The range is ${days} days; the maximum is ${maxDays} days.`;
  }
  return errors;
}

/**
 * The one shape sent to the API for a date range. Throws if the range is invalid, so an
 * unvalidated range can never be serialized by accident. Output is trimmed, key order is fixed.
 */
export function serializeDateRange(range, options) {
  const startDate = typeof range.startDate === 'string' ? range.startDate.trim() : '';
  const endDate = typeof range.endDate === 'string' ? range.endDate.trim() : '';
  const errors = validateDateRange({ startDate, endDate }, options);
  const message = Object.values(errors)[0];
  if (message) throw new RangeError(`Invalid date range: ${message}`);
  return { startDate, endDate };
}
