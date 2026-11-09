const AMOUNT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const QUANTITY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

const isMissing = (value) => value === null || value === undefined || value === '';

/**
 * Display-only formatting of a server-provided decimal string. The UI never
 * computes with these values, so floats are only used at the display boundary.
 * Missing and invalid values show an em dash, distinct from a real "0.00".
 */
export function formatAmount(value) {
  if (isMissing(value)) return '—';
  const number = Number(value);
  return Number.isFinite(number) ? AMOUNT_FORMAT.format(number) : '—';
}

export function formatQuantity(value) {
  if (isMissing(value)) return '—';
  const number = Number(value);
  return Number.isFinite(number) ? QUANTITY_FORMAT.format(number) : '—';
}

/** ISO instant → "2026-11-03 08:15 UTC". Always UTC so output is not machine-dependent. */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}
