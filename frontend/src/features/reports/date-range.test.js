import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RANGE_DAYS,
  configuredMaxRangeDays,
  inclusiveDayCount,
  isValidDate,
  serializeDateRange,
  todayInReportingTimezone,
  validateDateRange,
} from '@/features/reports/date-range';

const range = (startDate, endDate) => ({ startDate, endDate });
const TODAY = '20300101'; // fixed so tests do not depend on the real clock

describe('isValidDate', () => {
  it.each(['20261001', '20240229', '20261231', '20260101'])('accepts %s', (v) => {
    expect(isValidDate(v)).toBe(true);
  });

  it.each([
    '',
    '20260230',
    '20250229',
    '20261301',
    '20260010',
    '20260431',
    '10/01/2026',
    '2026-1-1',
    '2026-10-01', // dashed ISO is not the app format
    ' 2026-10-01',
    '2026-10-01T00:00:00Z',
    'abc',
    null,
    undefined,
    20261001,
  ])('rejects %j', (v) => {
    expect(isValidDate(v)).toBe(false);
  });
});

describe('inclusiveDayCount', () => {
  it('counts both end days', () => {
    expect(inclusiveDayCount('20261005', '20261005')).toBe(1);
    expect(inclusiveDayCount('20261001', '20261031')).toBe(31);
  });

  it('crosses month and year boundaries', () => {
    expect(inclusiveDayCount('20260131', '20260201')).toBe(2);
    expect(inclusiveDayCount('20251231', '20260101')).toBe(2);
    expect(inclusiveDayCount('20260101', '20261231')).toBe(365);
  });

  it('handles leap years', () => {
    expect(inclusiveDayCount('20240228', '20240301')).toBe(3);
    expect(inclusiveDayCount('20250228', '20250301')).toBe(2);
    expect(inclusiveDayCount('20240101', '20241231')).toBe(366);
  });

  it('is not shifted by daylight-saving transitions', () => {
    expect(inclusiveDayCount('20260328', '20260330')).toBe(3);
    expect(inclusiveDayCount('20261024', '20261026')).toBe(3);
  });

  it('is null for invalid input', () => {
    expect(inclusiveDayCount('', '20261001')).toBeNull();
    expect(inclusiveDayCount('20260230', '20260301')).toBeNull();
  });
});

describe('validateDateRange', () => {
  it('accepts valid ranges, including single day and boundary crossings', () => {
    expect(validateDateRange(range('20261005', '20261005'), { today: TODAY })).toEqual({});
    expect(validateDateRange(range('20261001', '20261031'), { today: TODAY })).toEqual({});
    expect(validateDateRange(range('20261220', '20270110'), { today: TODAY })).toEqual({});
    expect(validateDateRange(range('20240228', '20240301'), { today: TODAY })).toEqual({});
  });

  it('blocks missing dates with a clear message per field', () => {
    expect(validateDateRange(range('', ''), { today: TODAY })).toEqual({
      startDate: 'Choose a start date.',
      endDate: 'Choose an end date.',
    });
    expect(validateDateRange(range('20261001', ''), { today: TODAY })).toEqual({
      endDate: 'Choose an end date.',
    });
  });

  it('blocks impossible dates', () => {
    expect(validateDateRange(range('20260230', '20260305'), { today: TODAY })).toEqual({
      startDate: 'Enter a valid start date.',
    });
    expect(validateDateRange(range('20260301', '20261305'), { today: TODAY })).toEqual({
      endDate: 'Enter a valid end date.',
    });
  });

  it('blocks start after end, including by one day and across years', () => {
    const message = 'End date must be on or after the start date.';
    expect(validateDateRange(range('20261002', '20261001'), { today: TODAY })).toEqual({
      endDate: message,
    });
    expect(validateDateRange(range('20270101', '20261231'), { today: TODAY })).toEqual({
      endDate: message,
    });
  });

  it('enforces the maximum range inclusively', () => {
    expect(validateDateRange(range('20260101', '20260110'), { maxDays: 10, today: TODAY })).toEqual(
      {},
    );
    expect(validateDateRange(range('20260101', '20260111'), { maxDays: 10, today: TODAY })).toEqual(
      {
        endDate: 'The range is 11 days; the maximum is 10 days.',
      },
    );
  });

  it('uses the default maximum when none is given', () => {
    const ok = validateDateRange(range('20260101', '20260402'), { today: TODAY }); // 92 days
    const tooLong = validateDateRange(range('20260101', '20260403'), { today: TODAY }); // 93 days
    expect(inclusiveDayCount('20260101', '20260402')).toBe(DEFAULT_MAX_RANGE_DAYS);
    expect(ok).toEqual({});
    expect(tooLong.endDate).toMatch(/maximum is 92 days/);
  });
});

describe('future dates and the Harare timezone', () => {
  it('computes today in Africa/Harare, not UTC', () => {
    // 22:30 UTC on 31 Oct is 00:30 on 1 Nov in Harare (UTC+2).
    expect(todayInReportingTimezone(new Date('2026-10-31T22:30:00Z'))).toBe('20261101');
    expect(todayInReportingTimezone(new Date('2026-10-31T21:59:59Z'))).toBe('20261031');
    expect(todayInReportingTimezone(new Date('2026-12-31T22:00:00Z'))).toBe('20270101');
  });

  it('allows today and rejects anything after it, per field', () => {
    const today = '20261108';
    expect(validateDateRange(range('20261108', '20261108'), { today })).toEqual({});
    expect(validateDateRange(range('20261101', '20261109'), { today })).toEqual({
      endDate: 'End date cannot be in the future.',
    });
    expect(validateDateRange(range('20261109', '20261110'), { today })).toEqual({
      startDate: 'Start date cannot be in the future.',
      endDate: 'End date cannot be in the future.',
    });
  });

  it('judges "future" in Harare time at the midnight boundary', () => {
    const now = new Date('2026-10-31T22:30:00Z'); // 1 Nov in Harare, still 31 Oct in UTC
    const today = todayInReportingTimezone(now);
    expect(validateDateRange(range('20261101', '20261101'), { today })).toEqual({});
    expect(validateDateRange(range('20261101', '20261102'), { today }).endDate).toMatch(/future/);
  });

  it('uses the real clock by default', () => {
    expect(validateDateRange(range('20990101', '20990102')).startDate).toMatch(/future/);
  });
});

describe('configuredMaxRangeDays', () => {
  it('falls back to the default for missing or bad values', () => {
    for (const raw of [undefined, '', 'abc', '0', '-5', '1.5', '1e3', '99999999999999999999']) {
      expect(configuredMaxRangeDays({ VITE_REPORT_MAX_RANGE_DAYS: raw })).toBe(
        DEFAULT_MAX_RANGE_DAYS,
      );
    }
  });

  it('reads a positive integer', () => {
    expect(configuredMaxRangeDays({ VITE_REPORT_MAX_RANGE_DAYS: '31' })).toBe(31);
    expect(configuredMaxRangeDays({ VITE_REPORT_MAX_RANGE_DAYS: ' 366 ' })).toBe(366);
  });
});

describe('serializeDateRange', () => {
  it('returns the normalized shape with fixed keys and no timezone conversion', () => {
    const result = serializeDateRange({ endDate: ' 20261031 ', startDate: '20261001', extra: 'x' });
    expect(result).toEqual({ startDate: '20261001', endDate: '20261031' });
    expect(Object.keys(result)).toEqual(['startDate', 'endDate']);
    expect(JSON.stringify(result)).toBe('{"startDate":"20261001","endDate":"20261031"}');
  });

  it('is the same across year boundaries and does not depend on the local timezone', () => {
    expect(serializeDateRange(range('20251231', '20260101'))).toEqual(
      range('20251231', '20260101'),
    );
  });

  it('throws instead of serializing an invalid range', () => {
    expect(() => serializeDateRange(range('', ''))).toThrow(RangeError);
    expect(() => serializeDateRange(range('20261002', '20261001'))).toThrow(/on or after/);
    expect(() => serializeDateRange(range('20260101', '20260111'), { maxDays: 10 })).toThrow(
      /maximum/,
    );
    expect(() => serializeDateRange({ startDate: null, endDate: undefined })).toThrow(RangeError);
  });
});
