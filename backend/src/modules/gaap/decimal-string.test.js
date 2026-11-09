import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decimalSign, toDecimalString } from './decimal-string.js';

describe('toDecimalString', () => {
  it('keeps ordinary decimals exactly as the shortest round-trip text', () => {
    assert.equal(toDecimalString(12.5), '12.5');
    assert.equal(toDecimalString(0.1), '0.1');
    assert.equal(toDecimalString(1.1), '1.1');
    assert.equal(toDecimalString(-3), '-3');
    assert.equal(toDecimalString(1234567.89), '1234567.89');
  });

  it('keeps zero distinct from missing and folds negative zero', () => {
    assert.equal(toDecimalString(0), '0');
    assert.equal(toDecimalString(-0), '0');
    assert.equal(toDecimalString(undefined), null);
    assert.equal(toDecimalString(null), null);
  });

  it('expands exponent notation into plain decimals', () => {
    assert.equal(toDecimalString(1e-7), '0.0000001');
    assert.equal(toDecimalString(-1.5e-7), '-0.00000015');
    assert.equal(toDecimalString(1e21), '1000000000000000000000');
    assert.equal(toDecimalString(1.25e21), '1250000000000000000000');
    assert.equal(toDecimalString(1.2345e-10), '0.00000000012345');
  });

  it('never coerces non-numbers', () => {
    for (const bad of ['12.5', '', ' ', true, false, [], {}, NaN, Infinity, -Infinity, 10n]) {
      assert.equal(toDecimalString(bad), null, `${String(bad)} must not become a number`);
    }
  });
});

describe('decimalSign', () => {
  it('reports sign without floating point', () => {
    assert.equal(decimalSign('0'), 0);
    assert.equal(decimalSign('-0.0'), 0);
    assert.equal(decimalSign('12.5'), 1);
    assert.equal(decimalSign('-0.0000001'), -1);
    assert.equal(decimalSign('0.0000001'), 1);
  });
});
