import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReportName } from './report-name.js';

describe('buildReportName', () => {
  it('combines the node and product names', () => {
    assert.equal(
      buildReportName(
        { nodeName: 'Simbisa Chicken Inn', productName: 'Fastjet' },
        { nodeCount: 1, productCount: 1 },
      ),
      'Simbisa Chicken Inn - Fastjet sales',
    );
  });
  it('adds "+N more" when several were selected', () => {
    assert.equal(
      buildReportName({ nodeName: 'A', productName: 'P' }, { nodeCount: 3, productCount: 1 }),
      'A +2 more - P sales',
    );
  });
  it('falls back to what is known, or null', () => {
    assert.equal(buildReportName({ productName: 'P' }), 'P sales');
    assert.equal(buildReportName({ nodeName: 'N' }), 'N sales');
    assert.equal(buildReportName(null), null);
  });
});
