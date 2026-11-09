import { isCompactDate } from '../../models/shared.js';

/**
 * Reporting-day helpers. Dates are calendar dates written YYYYMMDD with no time or timezone.
 * The reporting timezone is Africa/Harare (owner decision, 2026-11-08); "today", and so "future",
 * is judged there. How a day maps to GAAP `createdDate` bounds is UNVERIFIED and not decided here.
 */
export const REPORTING_TIMEZONE = 'Africa/Harare';

const MS_PER_DAY = 86_400_000;

export { isCompactDate };

/** Today's calendar date (YYYYMMDD) in the reporting timezone. */
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

function toUtcMs(date) {
  return Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`);
}

/** Calendar days from start to end counting both ends; null if either is not a valid date. */
export function inclusiveDayCount(startDate, endDate) {
  if (!isCompactDate(startDate) || !isCompactDate(endDate)) return null;
  return Math.round((toUtcMs(endDate) - toUtcMs(startDate)) / MS_PER_DAY) + 1;
}
