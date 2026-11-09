import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_REPORT_LIMITS, loadReportLimits } from './report-limits.js';

describe('loadReportLimits', () => {
  it('returns the provisional defaults, frozen', () => {
    const limits = loadReportLimits({});
    assert.deepEqual(limits, DEFAULT_REPORT_LIMITS);
    assert.equal(Object.isFrozen(limits), true);
  });

  it('applies overrides and ignores blank values', () => {
    const limits = loadReportLimits({ REPORT_MAX_RANGE_DAYS: ' 31 ', REPORT_MAX_NODES: '  ' });
    assert.equal(limits.maxRangeDays, 31);
    assert.equal(limits.maxNodes, DEFAULT_REPORT_LIMITS.maxNodes);
  });

  for (const bad of ['0', '-1', '1.5', 'abc', '1e3', '99999999999', '0x10']) {
    it(`rejects ${JSON.stringify(bad)} naming the variable but not echoing the value`, () => {
      assert.throws(
        () => loadReportLimits({ REPORT_MAX_PRODUCTS: bad }),
        (error) =>
          error.message.includes('REPORT_MAX_PRODUCTS') && !error.message.includes(`"${bad}"`),
      );
    });
  }
});
