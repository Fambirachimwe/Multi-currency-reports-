/**
 * Execution wiring tests: FIXTURE sales, in-memory repository double. Not live GAAP/MongoDB evidence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureRawLine, fixtureRawSale } from '../gaap/fixtures/sales-lines.fixture.js';
import { ReportBusyError } from './report-runner.js';
import { createReportExecution, loadReportExecutionConfig } from './report-execution.js';
import { ReportRejectedError } from './reports.service.js';
import { createReportMemoryRepository } from './support/report-memory-repository.js';

const REQUEST = Object.freeze({
  startDate: '20261105',
  endDate: '20261105',
  productIds: ['prod-1'],
  nodes: { mode: 'nodes', brandIds: [], nodeIds: ['node-a'] },
  cachePolicy: 'bypass_cache',
});

function sales() {
  return {
    sales: [fixtureRawSale('s1', [fixtureRawLine('l1', { priceIncl: 5 })])],
    complete: true,
    partial: false,
    failures: [],
    incompleteReasons: [],
    pageCount: 1,
    queryCount: 1,
    duplicateCount: 0,
    fetchedAt: '2026-11-08T09:59:00.000Z',
    sourceStartedAt: '2026-11-08T09:58:00.000Z',
  };
}

function build({ fetchSales = async () => sales(), repo, config } = {}) {
  const repository = repo ?? createReportMemoryRepository();
  const execution = createReportExecution({
    repository,
    salesAdapter: { fetchSales },
    salesCachePolicy: { enabled: false },
    config: loadReportExecutionConfig({ REPORT_REQUIRE_VERIFIED_RULES: 'false', ...config }),
  });
  return { execution, repository };
}

describe('report execution', () => {
  it('returns pending immediately and completes in the background', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { execution, repository } = build({
      fetchSales: async () => {
        await gate;
        return sales();
      },
    });
    const started = await execution.startReport({ request: REQUEST, requestId: 'r' });
    assert.equal(started.status, 'pending');
    assert.equal(repository.reports.get(started.reportId).status, 'pending');
    release();
    await execution.idle();
    assert.equal(repository.reports.get(started.reportId).status, 'completed');
  });

  it('refuses when the runner is full, creating no report', async () => {
    const gate = new Promise(() => {});
    const { execution, repository } = build({
      fetchSales: () => gate,
      config: { REPORT_MAX_CONCURRENT_RUNS: '1', REPORT_MAX_QUEUED_RUNS: '0' },
    });
    await execution.startReport({ request: REQUEST });
    await assert.rejects(execution.startReport({ request: REQUEST }), ReportBusyError);
    assert.equal(repository.reports.size, 1);
    execution.stop(); // aborts the stuck fetch is not possible; just don't await
  });

  it('refuses to start while eligibility rules are unverified and enforcement is on', async () => {
    const repository = createReportMemoryRepository();
    const execution = createReportExecution({
      repository,
      salesAdapter: { fetchSales: async () => sales() },
      salesCachePolicy: { enabled: false },
      config: loadReportExecutionConfig({}),
    });
    await assert.rejects(execution.startReport({ request: REQUEST }), (error) => {
      assert.ok(error instanceof ReportRejectedError);
      assert.equal(error.code, 'ELIGIBILITY_RULES_UNVERIFIED');
      return true;
    });
    assert.equal(repository.reports.size, 0);
  });

  it('records the override in the calculation version when enforcement is off', async () => {
    const { execution, repository } = build();
    const { reportId } = await execution.startReport({ request: REQUEST });
    await execution.idle();
    assert.match(repository.reports.get(reportId).calculationVersion, /\+unverified-rules$/);
  });

  it('frees the slot and creates nothing when the pending report cannot be saved', async () => {
    const repo = createReportMemoryRepository({ failOn: { createPending: true } });
    const { execution } = build({ repo, config: { REPORT_MAX_QUEUED_RUNS: '0' } });
    await assert.rejects(execution.startReport({ request: REQUEST }), /createPending failed/);
    assert.equal(execution.stats().reserved, 0);
  });

  it('cancelling a running report stops it and saves nothing', async () => {
    let aborted = false;
    const { execution, repository } = build({
      fetchSales: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    const started = await execution.startReport({ request: REQUEST });
    const result = await execution.cancelReport(started.reportId);
    await execution.idle();
    assert.deepEqual(result, { found: true, cancelled: true });
    assert.equal(aborted, true);
    assert.equal(repository.reports.size, 0, 'a cancelled report is not saved, not even as failed');
  });

  it('cancel leaves finished reports alone and reports unknown ones', async () => {
    const { execution, repository } = build();
    const started = await execution.startReport({ request: REQUEST });
    await execution.idle();
    assert.deepEqual(await execution.cancelReport(started.reportId), {
      found: true,
      cancelled: false,
      status: 'completed',
    });
    assert.equal(repository.reports.get(started.reportId).status, 'completed');
    assert.deepEqual(await execution.cancelReport('x'.repeat(24)), {
      found: false,
      cancelled: false,
    });
  });

  it('a shutdown records in-flight reports as failed/interrupted, never completed', async () => {
    const { execution, repository } = build({
      fetchSales: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const { reportId } = await execution.startReport({ request: REQUEST });
    await new Promise((resolve) => setImmediate(resolve));
    await execution.stop();
    const report = repository.reports.get(reportId);
    assert.equal(report.status, 'failed');
    assert.equal(report.error.code, 'GENERATION_INTERRUPTED');
  });
});

describe('loadReportExecutionConfig', () => {
  it('defaults to safe values with verified rules required', () => {
    const config = loadReportExecutionConfig({});
    assert.equal(config.requireVerifiedRules, true);
    assert.equal(config.maxConcurrent, 1);
  });

  it('rejects invalid values naming the variable only', () => {
    assert.throws(
      () =>
        loadReportExecutionConfig({
          REPORT_MAX_CONCURRENT_RUNS: '0',
          REPORT_RUN_TIMEOUT_MS: 'abc',
          REPORT_REQUIRE_VERIFIED_RULES: 'maybe',
        }),
      (error) =>
        /REPORT_MAX_CONCURRENT_RUNS/.test(error.message) &&
        /REPORT_RUN_TIMEOUT_MS/.test(error.message) &&
        /REPORT_REQUIRE_VERIFIED_RULES/.test(error.message) &&
        !/abc|maybe/.test(error.message),
    );
  });
});
