import { describe, expect, it } from 'vitest';
import { formatAmount, formatDateTime, formatQuantity } from '@/lib/format';
import { MOCK_REPORTS } from '@/mocks/reports';

const cents = (amount) => Math.round(Number(amount) * 100);

describe('mock report fixtures', () => {
  const completed = MOCK_REPORTS.filter((r) => r.status === 'completed');

  it('covers completed, pending and failed states', () => {
    expect(new Set(MOCK_REPORTS.map((r) => r.status))).toEqual(
      new Set(['completed', 'pending', 'failed']),
    );
  });

  it('keeps currency totals separate and consistent with the detail rows', () => {
    for (const report of completed) {
      for (const total of report.totals) {
        const rows = report.detailRows.filter((r) => r.currency === total.currency);
        expect(rows.reduce((sum, r) => sum + cents(r.turnover), 0)).toBe(cents(total.turnover));
        expect(rows.reduce((sum, r) => sum + Number(r.quantity), 0)).toBe(Number(total.quantity));
      }
      const currencies = report.totals.map((t) => t.currency);
      expect(new Set(currencies).size).toBe(currencies.length);
    }
  });

  it('never treats UNKNOWN as USD and warns about it', () => {
    const withUnknown = completed.filter((r) => r.detailRows.some((x) => x.currency === 'UNKNOWN'));
    expect(withUnknown.length).toBeGreaterThan(0);
    for (const report of withUnknown) {
      expect(report.totals.some((t) => t.currency === 'UNKNOWN')).toBe(true);
      expect(report.warnings.join(' ')).toMatch(/UNKNOWN/);
    }
  });

  it('contains no credentials or URLs', () => {
    expect(JSON.stringify(MOCK_REPORTS)).not.toMatch(/api[_-]?key|secret|token|https?:\/\//i);
  });
});

describe('formatting', () => {
  it('formats amounts with two decimals and distinguishes missing from zero', () => {
    expect(formatAmount('1234.5')).toBe('1,234.50');
    expect(formatAmount('0')).toBe('0.00');
    expect(formatAmount(null)).toBe('—');
    expect(formatAmount('')).toBe('—');
    expect(formatAmount('abc')).toBe('—');
  });

  it('formats quantities and instants deterministically', () => {
    expect(formatQuantity('1200')).toBe('1,200');
    expect(formatQuantity(undefined)).toBe('—');
    expect(formatDateTime('2026-11-03T08:15:00.000Z')).toBe('2026-11-03 08:15 UTC');
    expect(formatDateTime('nope')).toBe('—');
  });
});
