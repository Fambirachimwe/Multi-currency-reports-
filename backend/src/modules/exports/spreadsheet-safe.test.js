import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_CELL_TEXT_LENGTH,
  compactDateToDate,
  exportFilename,
  isoToDate,
  safeText,
  toExcelAmount,
} from './spreadsheet-safe.js';

describe('safeText (formula injection)', () => {
  it('prefixes every formula starter so the cell stays text', () => {
    for (const text of [
      '=1+1',
      '+SUM(A1)',
      '-2+3',
      '@SUM(A1)',
      '\t=1',
      '\r=1',
      '\n=1',
      ' =1',
      '  \t+1',
      '=HYPERLINK("http://evil","x")',
      "=cmd|' /C calc'!A0",
    ]) {
      assert.equal(safeText(text), `'${text}`, JSON.stringify(text));
    }
  });

  it('leaves ordinary text alone, including a dash or equals sign that is not first', () => {
    for (const text of ['Coca-Cola 2L', 'A=B', 'Store 12', '', '1+1', 'user@example.com']) {
      assert.equal(safeText(text), text);
    }
  });

  it('keeps empty cells empty instead of writing "null"', () => {
    assert.equal(safeText(null), null);
    assert.equal(safeText(undefined), null);
  });

  it('removes characters XML cannot hold and caps the length at the Excel limit', () => {
    assert.equal(safeText('a\u0000b\u0008c\u001fd'), 'abcd');
    assert.equal(safeText('x'.repeat(MAX_CELL_TEXT_LENGTH + 50)).length, MAX_CELL_TEXT_LENGTH);
    // The apostrophe never pushes the text past the cell limit.
    assert.equal(safeText(`=${'x'.repeat(MAX_CELL_TEXT_LENGTH)}`).length, MAX_CELL_TEXT_LENGTH);
  });

  it('escapes after removing illegal characters, so they cannot hide a formula start', () => {
    assert.equal(safeText('\u0000=1+1'), "'=1+1");
  });
});

describe('toExcelAmount', () => {
  it('writes exactly representable decimals as numbers', () => {
    assert.deepEqual(toExcelAmount('12.5'), { value: 12.5, exact: true });
    assert.deepEqual(toExcelAmount('0.1'), { value: 0.1, exact: true });
    assert.deepEqual(toExcelAmount('-3'), { value: -3, exact: true });
    assert.deepEqual(toExcelAmount('1200.50'), { value: 1200.5, exact: true });
    assert.deepEqual(toExcelAmount('123456789012345'), { value: 123456789012345, exact: true });
  });

  it('keeps the saved value distinguishable from zero and writes -0 as 0', () => {
    assert.deepEqual(toExcelAmount('0'), { value: 0, exact: true });
    assert.deepEqual(toExcelAmount('-0'), { value: 0, exact: true });
    assert.equal(Object.is(toExcelAmount('-0').value, -0), false);
  });

  it('writes amounts a double cannot hold exactly as their exact text', () => {
    assert.deepEqual(toExcelAmount('12345678901234567.89'), {
      value: '12345678901234567.89',
      exact: false,
    });
    assert.deepEqual(toExcelAmount('0.1234567890123456789'), {
      value: '0.1234567890123456789',
      exact: false,
    });
    assert.deepEqual(toExcelAmount('9007199254740993'), {
      value: '9007199254740993',
      exact: false,
    });
  });

  it('expands the exponent form MongoDB prints before judging it', () => {
    assert.deepEqual(toExcelAmount('1E-7'), { value: 0.0000001, exact: true });
  });

  it('never invents a value for missing or non-decimal input', () => {
    for (const bad of [null, undefined, '', 'abc', '1,5', 12.5, NaN, {}]) {
      assert.deepEqual(toExcelAmount(bad), { value: null, exact: false }, String(bad));
    }
  });
});

describe('dates and filename', () => {
  it('turns a compact calendar day into a UTC-midnight date and rejects impossible days', () => {
    assert.equal(compactDateToDate('20261108').toISOString(), '2026-11-08T00:00:00.000Z');
    for (const bad of ['20260230', '20261301', '2026-11-08', '', null, 20261108]) {
      assert.equal(compactDateToDate(bad), null, String(bad));
    }
  });

  it('parses ISO instants and refuses anything else', () => {
    assert.equal(isoToDate('2026-11-08T10:00:00.000Z').getTime(), Date.UTC(2026, 10, 8, 10));
    assert.equal(isoToDate('nope'), null);
    assert.equal(isoToDate(null), null);
  });

  it('builds the filename from the id and dates only, with a safe character set', () => {
    assert.equal(
      exportFilename({
        reportId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        filters: { startDate: '20261101', endDate: '20261107' },
      }),
      'simbisa-sales-report-aaaaaaaaaaaaaaaaaaaaaaaa-20261101-20261107.xlsx',
    );
    const hostile = exportFilename({
      reportId: '../../etc/passwd"\r\nX: y',
      filters: { startDate: '"; rm -rf', endDate: null },
    });
    assert.match(hostile, /^[A-Za-z0-9._-]+$/);
    assert.ok(hostile.endsWith('.xlsx'));
  });
});
