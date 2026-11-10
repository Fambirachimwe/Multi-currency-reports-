/**
 * Exact decimal addition on decimal STRINGS (Feature 18). No floating point is ever used: values are
 * parsed into a scaled BigInt, so sums of any size and precision are exact and independent of order.
 * Inputs must be plain decimal text such as "-12.5" (the output of `toDecimalString`); anything else
 * is rejected, never coerced.
 */

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** @param {unknown} text @returns {boolean} True for plain signed decimal text (no exponent, no spaces). */
export function isDecimalString(text) {
  return typeof text === 'string' && DECIMAL_PATTERN.test(text);
}

/** An exact running total. `add` throws a TypeError on anything that is not decimal text. */
export function createDecimalSum() {
  let value = 0n;
  let scale = 0;

  return {
    /** @param {string} text */
    add(text) {
      const match = typeof text === 'string' ? DECIMAL_PATTERN.exec(text) : null;
      if (match === null) throw new TypeError('add() requires a plain decimal string');
      const [, sign, whole, fraction = ''] = match;
      let amount = BigInt(whole + fraction);
      if (sign === '-') amount = -amount;
      if (fraction.length > scale) {
        value *= 10n ** BigInt(fraction.length - scale);
        scale = fraction.length;
      } else if (fraction.length < scale) {
        amount *= 10n ** BigInt(scale - fraction.length);
      }
      value += amount;
      return this;
    },
    /** @returns {string} Canonical text: no trailing fraction zeros, no "-0", e.g. "12.5", "0". */
    toString() {
      const negative = value < 0n;
      const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
      const whole = digits.slice(0, digits.length - scale);
      const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
      const body = fraction === '' ? whole : `${whole}.${fraction}`;
      return negative ? `-${body}` : body;
    },
  };
}

/**
 * Exact product of two decimal strings (BigInt, no floats). Canonical output like `toString()`.
 * @param {string} a @param {string} b @returns {string}
 */
export function multiplyDecimalStrings(a, b) {
  const parse = (text) => {
    const match = typeof text === 'string' ? DECIMAL_PATTERN.exec(text) : null;
    if (match === null) throw new TypeError('multiplyDecimalStrings() requires decimal strings');
    const [, sign, whole, fraction = ''] = match;
    const amount = BigInt(whole + fraction);
    return { amount: sign === '-' ? -amount : amount, scale: fraction.length };
  };
  const x = parse(a);
  const y = parse(b);
  const product = x.amount * y.amount;
  const scale = x.scale + y.scale;
  const negative = product < 0n;
  const digits = (negative ? -product : product).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  const body = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/** @param {string[]} texts @returns {string} Exact sum of decimal strings; "0" for an empty list. */
export function sumDecimalStrings(texts) {
  const sum = createDecimalSum();
  for (const text of texts) sum.add(text);
  return sum.toString();
}
