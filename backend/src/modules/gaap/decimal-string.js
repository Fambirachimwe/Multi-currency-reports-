/**
 * Decimal-safe handling of numbers read from GAAP JSON (Feature 15).
 *
 * GAAP sends money and quantities as JSON numbers. They are never summed or rounded here: a finite
 * number is converted to its shortest round-trip decimal STRING (no exponent), which Mongoose
 * Decimal128 accepts and which keeps the source precision. Strings, booleans, NaN, Infinity and
 * missing values are NOT coerced: the caller decides how to flag them (never `Number(x) || 0`).
 */

/**
 * @param {unknown} value
 * @returns {string | null} Plain decimal text such as "-12.5", or null if `value` is not a finite number.
 */
export function toDecimalString(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value === 0) return '0'; // also folds -0
  return expandExponent(String(value));
}

/** @param {string} text Output of `toDecimalString`. @returns {-1 | 0 | 1} */
export function decimalSign(text) {
  if (/^-?0(\.0+)?$/.test(text)) return 0;
  return text.startsWith('-') ? -1 : 1;
}

/** "1.5e-7" -> "0.00000015", "1e+21" -> "1000000000000000000000". Plain decimals pass through. */
function expandExponent(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (match === null) return text;
  const [, sign, whole, fraction = '', exponentText] = match;
  const exponent = Number(exponentText);
  const digits = whole + fraction;
  const pointAt = whole.length + exponent;
  let result;
  if (pointAt <= 0) {
    result = `0.${'0'.repeat(-pointAt)}${digits}`;
  } else if (pointAt >= digits.length) {
    result = digits + '0'.repeat(pointAt - digits.length);
  } else {
    result = `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  }
  return sign + result;
}
