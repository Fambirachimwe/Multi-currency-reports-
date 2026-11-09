import { Schema } from 'mongoose';

/** Currency code used when the source does not state one. It is never defaulted to USD. */
export const CURRENCY_UNKNOWN = 'UNKNOWN';

const CURRENCY_PATTERN = /^([A-Z]{3}|UNKNOWN)$/;
const DATE_PATTERN = /^\d{8}$/;

/**
 * True for a real calendar date written as YYYYMMDD, the format of GAAP's createdDate filter
 * (e.g. "20261105"). Rejects 20260231 and dashed 2026-11-05.
 */
export function isCompactDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso);
}

/**
 * Required currency code: a three-letter upper-case code or UNKNOWN.
 * No default and no coercion, so a missing currency is a validation error
 * rather than a silent USD.
 */
export const currencyField = Object.freeze({
  type: String,
  required: [true, 'currency is required; use UNKNOWN when the source does not say'],
  validate: {
    validator: (value) => CURRENCY_PATTERN.test(value),
    message: 'currency must be a 3-letter upper-case code or UNKNOWN',
  },
});

/**
 * Required exact decimal for money and quantities. Decimal128 avoids binary
 * floating point; missing values fail validation instead of becoming 0.
 */
export function decimalField(label) {
  return {
    type: Schema.Types.Decimal128,
    required: [true, `${label} is required`],
    validate: {
      validator: (value) => /^-?\d/.test(value.toString()),
      message: `${label} must be a finite number`,
    },
  };
}
