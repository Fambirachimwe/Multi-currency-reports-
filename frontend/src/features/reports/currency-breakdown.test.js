import { describe, expect, it } from 'vitest';
import {
  buildCurrencySections,
  compareCurrencies,
  filterCurrencySections,
} from '@/features/reports/currency-breakdown';

const total = (currency, turnover) => ({ currency, lineCount: 1, quantity: '1', turnover });
const group = (currency, id) => ({ currency, id, name: id, lineCount: 1, quantity: '1' });

describe('currency breakdown sections', () => {
  it('orders USD, ZWG, additional currencies alphabetically, UNKNOWN last', () => {
    const codes = ['UNKNOWN', 'ZAR', 'ZWG', 'BWP', 'USD'].sort(compareCurrencies);
    expect(codes).toEqual(['USD', 'ZWG', 'BWP', 'ZAR', 'UNKNOWN']);
  });

  it('always has USD and ZWG sections, with null totals when there is no data', () => {
    const sections = buildCurrencySections([total('ZAR', '5')], { products: [], nodes: [] });
    expect(sections.map((s) => s.currency)).toEqual(['USD', 'ZWG', 'ZAR']);
    expect(sections[0].totals).toBeNull();
    expect(sections[2].totals).toEqual(total('ZAR', '5'));
  });

  it('adds UNKNOWN only when the report has it, and never merges it into another currency', () => {
    expect(buildCurrencySections([total('USD', '1')]).map((s) => s.currency)).toEqual([
      'USD',
      'ZWG',
    ]);
    const sections = buildCurrencySections([total('USD', '1'), total('UNKNOWN', '9')], {
      products: [group('USD', 'a'), group('UNKNOWN', 'a')],
      nodes: [],
    });
    expect(sections.map((s) => s.currency)).toEqual(['USD', 'ZWG', 'UNKNOWN']);
    expect(sections[0].products.map((g) => g.currency)).toEqual(['USD']);
    expect(sections[2].products.map((g) => g.currency)).toEqual(['UNKNOWN']);
    expect(sections[2].totals.turnover).toBe('9');
  });

  it('copies saved totals untouched and handles empty input', () => {
    const totals = [total('USD', '1.10')];
    const sections = buildCurrencySections(totals);
    expect(sections[0].totals).toBe(totals[0]);
    expect(buildCurrencySections().map((s) => s.currency)).toEqual(['USD', 'ZWG']);
  });

  it('filters sections without altering them', () => {
    const sections = buildCurrencySections([total('USD', '1'), total('ZAR', '2')]);
    expect(filterCurrencySections(sections, 'all')).toBe(sections);
    const only = filterCurrencySections(sections, 'ZAR');
    expect(only).toHaveLength(1);
    expect(only[0]).toBe(sections[2]);
    expect(filterCurrencySections(sections, 'EUR')).toEqual([]);
  });
});
