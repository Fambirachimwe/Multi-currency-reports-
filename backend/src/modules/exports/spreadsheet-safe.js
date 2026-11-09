import { createDecimalSum, isDecimalString } from '../gaap/decimal-sum.js';
import { toPlainDecimal } from '../reports/report-snapshot.js';

/**
 * Pure helpers that make values safe to put in a spreadsheet (Feature 26): formula-injection
 * escaping for text, exact-or-text handling of amounts, and a safe download filename.
 */

/** Excel's hard limit for the text in one cell. */
export const MAX_CELL_TEXT_LENGTH = 32_767;

// Characters that are illegal in XML 1.0 (and therefore in a worksheet): C0 controls except tab, LF, CR.
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

// A cell whose text starts with one of these (after any leading whitespace/control characters) can be
// read as a formula by Excel/LibreOffice/Sheets, or by anything that later converts the sheet to CSV.
// eslint-disable-next-line no-control-regex
const FORMULA_START = /^[\s\u0000-\u001f]*[=+\-@]/;
const LEADING_TAB_OR_BREAK = /^[\t\r\n]/;

/**
 * Text that is safe to write in a cell. Values that could be interpreted as a formula (`=`, `+`, `-`,
 * `@`, or a leading tab/CR/LF) get a leading apostrophe so they stay plain text; characters that
 * cannot exist in XML are removed and over-long text is cut to Excel's cell limit.
 * `null`/`undefined` become an empty cell (`null`), never the text "null".
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeText(value) {
  if (value === null || value === undefined) return null;
  let text = String(value);
  const dangerous = FORMULA_START.test(text) || LEADING_TAB_OR_BREAK.test(text);
  text = text.replace(XML_ILLEGAL, '');
  if (dangerous) text = `'${text}`;
  return text.length > MAX_CELL_TEXT_LENGTH ? text.slice(0, MAX_CELL_TEXT_LENGTH) : text;
}

/** Canonical decimal text ("12.50" -> "12.5", "-0" -> "0"); null when not decimal text. */
function canonical(text) {
  return isDecimalString(text) ? createDecimalSum().add(text).toString() : null;
}

/**
 * A saved decimal amount as an Excel cell value. It is written as a NUMBER only when the number
 * represents the saved text exactly (Excel doubles hold about 15 significant digits); otherwise the
 * exact saved text is written as text, so the export never rounds a saved amount silently.
 * @param {unknown} value decimal text as saved
 * @returns {{ value: number | string | null, exact: boolean }}
 *   `exact: false` means the value is text (too precise for a number) or unreadable (`null`).
 */
export function toExcelAmount(value) {
  const plain = toPlainDecimal(value);
  const saved = plain === null ? null : canonical(plain);
  if (saved === null) return { value: null, exact: false };
  const number = Number(saved);
  const roundTrip = Number.isFinite(number) ? canonical(toPlainDecimal(String(number))) : null;
  if (roundTrip === saved) return { value: number === 0 ? 0 : number, exact: true };
  return { value: saved, exact: false };
}

/** `YYYYMMDD` as a UTC-midnight Date (a calendar day, no time zone); null when not a real day. */
export function compactDateToDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

/** ISO instant text as a Date; null when absent or invalid. */
export function isoToDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Download filename built only from the report id and the saved dates, reduced to a safe character
 * set, so no source or user text can reach the Content-Disposition header.
 * @param {{ reportId: string, filters?: { startDate?: unknown, endDate?: unknown } }} report
 */
export function exportFilename({ reportId, filters }) {
  const part = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '');
  const pieces = [
    'simbisa-sales-report',
    part(reportId),
    part(filters?.startDate),
    part(filters?.endDate),
  ];
  return `${pieces.filter((piece) => piece !== '').join('-')}.xlsx`;
}
