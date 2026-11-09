/**
 * Report generation tests. GAAP sales are FIXTURES (invented ids and amounts, live field shape) and
 * the repository is an in-memory double: these prove the orchestration and its failure handling,
 * not GAAP's behaviour and not MongoDB persistence (see report.repository.test.js for that).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAAP_ERROR_CODES, GaapError, createSalesAdapter } from '../gaap/index.js';
import {
  fixtureForex,
  fixtureRawLine,
  fixtureRawSale,
} from '../gaap/fixtures/sales-lines.fixture.js';
import {
  ABORT_REASONS,
  FAILURE_CODES,
  buildCalculationVersion,
  createReportGenerator,
  decideSalesSource,
} from './report-generation.js';
import { createReportMemoryRepository } from './support/report-memory-repository.js';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const REQUEST = Object.freeze({
  startDate: '20261105',
  endDate: '20261105',
  productIds: ['prod-1'],
  nodes: { mode: 'nodes', brandIds: [], nodeIds: ['node-a'] },
  cachePolicy: 'bypass_cache',
});

/** Extraction result as `fetchSales` would return it. */
function extraction(sales, overrides = {}) {
  return {
    sales,
    complete: true,
    partial: false,
    failures: [],
    incompleteReasons: [],
    pageCount: 1,
    queryCount: 1,
    pages: [],
    receivedCount: sales.length,
    duplicateCount: 0,
    excluded: {},
    fetchedAt: '2026-11-08T09:59:00.000Z',
    sourceStartedAt: '2026-11-08T09:58:00.000Z',
    range: { startDate: '20261105', endDate: '20261105' },
    ...overrides,
  };
}

function build({
  result,
  fetch,
  repo = createReportMemoryRepository(),
  rulesVerified = true,
} = {}) {
  const calls = [];
  const salesAdapter = {
    async fetchSales(input) {
      calls.push(input);
      if (fetch) return fetch(input);
      return result;
    },
  };
  const generator = createReportGenerator({
    salesAdapter,
    repository: repo,
    salesCachePolicy: { enabled: false },
    rulesVerified,
    now: () => NOW,
    maxQueries: 4,
  });
  return { generator, repo, calls };
}

async function run(ctx, { request = REQUEST, signal } = {}) {
  const { reportId } = await ctx.repo.createPending({ request, startedAt: NOW });
  const outcome = await ctx.generator.generate({ reportId, request, requestId: 'req-1', signal });
  return { reportId, outcome, report: ctx.repo.reports.get(reportId) };
}

const turnoverOf = (report, currency) =>
  report.totals.find((entry) => entry.currency === currency)?.turnover;

describe('generateReport: success', () => {
  it('completes with per-currency totals, rows and source provenance', async () => {
    const sales = [
      fixtureRawSale('s1', [
        fixtureRawLine('l1', { qty: 2, priceIncl: 5 }), // USD 10
        fixtureRawLine('l2', { product: { _id: 'prod-2' } }), // not selected
      ]),
      fixtureRawSale('s2', [fixtureRawLine('l1', { qty: 1, priceIncl: 3.5 })], {
        forex: fixtureForex('ZAR', 'ZAR'),
      }),
      fixtureRawSale('s3', [fixtureRawLine('l1', { qty: 1, priceIncl: 2 })], { forex: undefined }),
    ];
    const ctx = build({ result: extraction(sales) });
    const { outcome, report, reportId } = await run(ctx);

    assert.deepEqual(outcome, { status: 'completed' });
    assert.equal(report.status, 'completed');
    // Alphabetical, UNKNOWN last, never merged into a real currency.
    assert.deepEqual(
      report.totals.map((t) => t.currency),
      ['USD', 'ZAR', 'UNKNOWN'],
    );
    assert.equal(turnoverOf(report, 'USD'), '10');
    assert.equal(turnoverOf(report, 'ZAR'), '3.5');
    assert.equal(turnoverOf(report, 'UNKNOWN'), '2');
    assert.equal(report.rowCount, 3);

    const rows = ctx.repo.rowsByReport.get(reportId);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.lineIndex),
      [0, 1, 2],
    );
    assert.ok(rows.every((r) => r.productId === 'prod-1'));
    // Row detail adds up to the totals, currency by currency.
    for (const total of report.totals) {
      const mine = rows.filter((r) => r.currency === total.currency);
      assert.equal(mine.length, total.lineCount);
    }

    assert.equal(report.provenance.source, 'GAAP_UNITY');
    assert.equal(report.provenance.complete, true);
    assert.equal(report.provenance.usedCache, false);
    assert.equal(report.provenance.cacheFreshness, 'not_applicable');
    assert.equal(report.provenance.fetchedAt.toISOString(), '2026-11-08T09:59:00.000Z');
    assert.equal(report.provenance.sourceStartedAt.toISOString(), '2026-11-08T09:58:00.000Z');
    assert.equal(report.completedAt, NOW);
    assert.equal(report.calculationVersion, buildCalculationVersion({ rulesVerified: true }));
  });

  it('keeps ineligible sales out of totals and rows', async () => {
    const sales = [
      fixtureRawSale('s1', [fixtureRawLine('l1', { qty: 1, priceIncl: 4 })]),
      fixtureRawSale('s2', [fixtureRawLine('l1', { qty: 1, priceIncl: 9 })], { isNegative: true }),
      fixtureRawSale('s3', [fixtureRawLine('l1', { qty: 1, priceIncl: 8 })], {
        status: 'CANCELED',
      }),
    ];
    const ctx = build({ result: extraction(sales) });
    const { report, reportId } = await run(ctx);
    assert.equal(report.status, 'completed');
    assert.equal(turnoverOf(report, 'USD'), '4');
    assert.equal(ctx.repo.rowsByReport.get(reportId).length, 1);
  });

  it('completes an empty result with no totals and no rows', async () => {
    const ctx = build({ result: extraction([]) });
    const { report, reportId } = await run(ctx);
    assert.equal(report.status, 'completed');
    assert.deepEqual(report.totals, []);
    assert.equal(report.rowCount, 0);
    assert.deepEqual(ctx.repo.rowsByReport.get(reportId), []);
  });

  it('records +unverified-rules in the calculation version when rules are unverified', async () => {
    const ctx = build({ result: extraction([]), rulesVerified: false });
    const { report } = await run(ctx);
    assert.match(report.calculationVersion, /\+unverified-rules$/);
  });

  it('passes the request filters to GAAP and the node filter when it fits the query cap', async () => {
    const ctx = build({ result: extraction([]) });
    await run(ctx);
    assert.equal(ctx.calls.length, 1);
    assert.deepEqual(ctx.calls[0].productIds, ['prod-1']);
    assert.deepEqual(ctx.calls[0].nodeIds, ['node-a']);
    assert.equal(ctx.calls[0].startDate, '20261105');
    assert.equal(ctx.calls[0].requestId, 'req-1');
  });

  it('filters nodes locally, exactly, when products x nodes exceeds the query cap', async () => {
    const request = {
      ...REQUEST,
      nodes: {
        mode: 'nodes',
        brandIds: [],
        nodeIds: ['node-a', 'node-b', 'node-c', 'node-d', 'node-e'],
      },
    };
    const sales = [
      fixtureRawSale('s1', [fixtureRawLine('l1', { priceIncl: 1 })], { nodeId: 'node-b' }),
      fixtureRawSale('s2', [fixtureRawLine('l1', { priceIncl: 100 })], { nodeId: 'node-z' }),
    ];
    const ctx = build({ result: extraction(sales) });
    const { report } = await run(ctx, { request });
    assert.equal(ctx.calls[0].nodeIds, undefined);
    assert.equal(turnoverOf(report, 'USD'), '1');
  });
});

describe('generateReport: failures never complete a report', () => {
  const assertFailed = (ctx, { report, reportId, outcome }, code) => {
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.code, code);
    assert.equal(report.status, 'failed');
    assert.equal(report.error.code, code);
    assert.ok(report.error.message.length > 0);
    assert.equal(report.totals, undefined);
    assert.equal(ctx.repo.rowsByReport.has(reportId), false);
  };

  it('fails when GAAP data is incomplete', async () => {
    const ctx = build({
      result: extraction([fixtureRawSale('s1', [fixtureRawLine('l1')])], {
        complete: false,
        partial: true,
        incompleteReasons: ['PAGE_FAILED'],
        failures: [{ code: 'GAAP_TIMEOUT', message: 'x', query: 0, skip: 500 }],
      }),
    });
    const result = await run(ctx);
    assertFailed(ctx, result, FAILURE_CODES.SOURCE_INCOMPLETE);
    assert.match(result.report.error.message, /PAGE_FAILED/);
  });

  for (const [gaapCode, expected] of [
    [GAAP_ERROR_CODES.TIMEOUT, FAILURE_CODES.SOURCE_TIMEOUT],
    [GAAP_ERROR_CODES.UNAVAILABLE, FAILURE_CODES.SOURCE_UNAVAILABLE],
    [GAAP_ERROR_CODES.AUTH, FAILURE_CODES.SOURCE_UNAVAILABLE],
    [GAAP_ERROR_CODES.INVALID_REQUEST, FAILURE_CODES.SOURCE_REQUEST_REJECTED],
  ]) {
    it(`maps a GAAP ${gaapCode} error to ${expected}`, async () => {
      const ctx = build({
        fetch: () => {
          throw new GaapError({ code: gaapCode, message: 'secret-looking detail apikey=abc' });
        },
      });
      const result = await run(ctx);
      assertFailed(ctx, result, expected);
      assert.doesNotMatch(result.report.error.message, /apikey|secret/);
    });
  }

  it('hides unexpected error details behind a generic failure', async () => {
    const ctx = build({
      fetch: () => {
        throw new Error('connection string mongodb://user:pass@host leaked');
      },
    });
    const result = await run(ctx);
    assertFailed(ctx, result, FAILURE_CODES.GENERATION_FAILED);
    assert.doesNotMatch(result.report.error.message, /mongodb|pass/);
  });

  it('fails when a selected sales line is unusable (missing turnover)', async () => {
    const bad = fixtureRawLine('l1');
    delete bad.lineTotals.turnover;
    const ctx = build({
      result: extraction([
        fixtureRawSale('s1', [fixtureRawLine('l0', { priceIncl: 1 })]),
        fixtureRawSale('s2', [bad]),
      ]),
    });
    assertFailed(ctx, await run(ctx), FAILURE_CODES.SOURCE_DATA_INVALID);
  });

  it('ignores an unusable line that belongs to a product that was not selected', async () => {
    const bad = fixtureRawLine('l2', { product: { _id: 'prod-2' } });
    delete bad.lineTotals.turnover;
    const ctx = build({
      result: extraction([fixtureRawSale('s1', [fixtureRawLine('l1', { priceIncl: 1 }), bad])]),
    });
    const { report } = await run(ctx);
    assert.equal(report.status, 'completed');
  });

  it('fails on a line with no product id (it cannot be ruled out)', async () => {
    const noProduct = fixtureRawLine('l1');
    delete noProduct.product;
    const ctx = build({ result: extraction([fixtureRawSale('s1', [noProduct])]) });
    assertFailed(ctx, await run(ctx), FAILURE_CODES.SOURCE_DATA_INVALID);
  });

  it('fails when a sale record cannot be read', async () => {
    const ctx = build({ result: extraction([fixtureRawSale('s1', undefined)]) });
    assertFailed(ctx, await run(ctx), FAILURE_CODES.SOURCE_DATA_INVALID);
  });

  it('fails when the same source line appears twice (no double counting)', async () => {
    const ctx = build({
      result: extraction([
        fixtureRawSale('s1', [
          fixtureRawLine('l1', { priceIncl: 5 }),
          fixtureRawLine('l1', { priceIncl: 5 }),
        ]),
      ]),
    });
    assertFailed(ctx, await run(ctx), FAILURE_CODES.SOURCE_DATA_INVALID);
  });

  it('fails, recording nothing as completed, when saving the snapshot fails', async () => {
    const repo = createReportMemoryRepository({ failOn: { markCompleted: true } });
    const ctx = build({ result: extraction([fixtureRawSale('s1', [fixtureRawLine('l1')])]), repo });
    const result = await run(ctx);
    assertFailed(ctx, result, FAILURE_CODES.SNAPSHOT_SAVE_FAILED);
  });

  it('leaves the report pending (and says so) if even the failure cannot be recorded', async () => {
    const repo = createReportMemoryRepository({ failOn: { markFailed: true } });
    const ctx = build({
      fetch: () => {
        throw new GaapError({ code: GAAP_ERROR_CODES.UNAVAILABLE, message: 'down' });
      },
      repo,
    });
    const { outcome, report } = await run(ctx);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.recorded, false);
    assert.equal(report.status, 'pending');
  });

  it('maps a deadline to GENERATION_TIMEOUT and a shutdown to GENERATION_INTERRUPTED', async () => {
    for (const [reason, code] of [
      [ABORT_REASONS.TIMEOUT, FAILURE_CODES.GENERATION_TIMEOUT],
      [ABORT_REASONS.SHUTDOWN, FAILURE_CODES.GENERATION_INTERRUPTED],
    ]) {
      // Aborted before the fetch.
      const early = new AbortController();
      early.abort(reason);
      const ctx = build({ result: extraction([]) });
      assertFailed(ctx, await run(ctx, { signal: early.signal }), code);
      assert.equal(ctx.calls.length, 0, 'no GAAP call after the deadline');

      // Aborted while the fetch is running: the adapter throws on abort.
      const live = new AbortController();
      const ctx2 = build({
        fetch: async ({ signal }) => {
          live.abort(reason);
          throw new GaapError({
            code: GAAP_ERROR_CODES.ABORTED,
            message: signal.aborted ? 'aborted' : '',
          });
        },
      });
      assertFailed(ctx2, await run(ctx2, { signal: live.signal }), code);
    }
  });
});

describe('generateReport: retry', () => {
  /** A scripted GAAP client: one sale on the first page, optionally failing the first attempts. */
  function scriptedClient({ failFirst }) {
    let attempts = 0;
    return {
      get attempts() {
        return attempts;
      },
      async get() {
        attempts += 1;
        if (attempts <= failFirst) {
          throw new GaapError({
            code: GAAP_ERROR_CODES.UNAVAILABLE,
            message: 'temporary',
            retryable: true,
          });
        }
        return {
          data: {
            totalRecords: 1,
            data: [fixtureRawSale('s1', [fixtureRawLine('l1', { priceIncl: 6 })])],
          },
        };
      },
    };
  }

  it('retries a transient page failure and completes with the full data', async () => {
    const client = scriptedClient({ failFirst: 1 });
    const repo = createReportMemoryRepository();
    const generator = createReportGenerator({
      salesAdapter: createSalesAdapter({ client, now: () => NOW }),
      repository: repo,
      salesCachePolicy: { enabled: false },
      rulesVerified: true,
      now: () => NOW,
    });
    const { reportId } = await repo.createPending({ request: REQUEST, startedAt: NOW });
    const outcome = await generator.generate({ reportId, request: REQUEST });
    assert.equal(outcome.status, 'completed');
    assert.equal(client.attempts, 2);
    assert.equal(turnoverOf(repo.reports.get(reportId), 'USD'), '6');
  });

  it('fails when retries are exhausted, then a new report (new id) succeeds; the failed one is untouched', async () => {
    const repo = createReportMemoryRepository();
    let healthy = false;
    const client = {
      async get() {
        if (!healthy) {
          throw new GaapError({
            code: GAAP_ERROR_CODES.UNAVAILABLE,
            message: 'down',
            retryable: true,
          });
        }
        return {
          data: {
            totalRecords: 1,
            data: [fixtureRawSale('s1', [fixtureRawLine('l1', { priceIncl: 6 })])],
          },
        };
      },
    };
    const generator = createReportGenerator({
      salesAdapter: createSalesAdapter({ client, now: () => NOW }),
      repository: repo,
      salesCachePolicy: { enabled: false },
      rulesVerified: true,
      now: () => NOW,
    });
    const first = await repo.createPending({ request: REQUEST, startedAt: NOW });
    const failed = await generator.generate({ reportId: first.reportId, request: REQUEST });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.code, FAILURE_CODES.SOURCE_INCOMPLETE);

    healthy = true;
    const second = await repo.createPending({ request: REQUEST, startedAt: NOW });
    const ok = await generator.generate({ reportId: second.reportId, request: REQUEST });
    assert.equal(ok.status, 'completed');
    assert.notEqual(first.reportId, second.reportId);
    assert.equal(repo.reports.get(first.reportId).status, 'failed');
    // A failed report cannot be reopened or completed.
    await assert.rejects(
      repo.markCompleted({
        reportId: first.reportId,
        totals: [],
        rows: [],
        provenance: {},
        calculationVersion: 'x',
        completedAt: NOW,
      }),
    );
  });
});

describe('decideSalesSource', () => {
  it('always reads GAAP live and records that no cache was used, whatever the cachePolicy', () => {
    for (const cachePolicy of ['use_cache', 'bypass_cache']) {
      const decision = decideSalesSource({ cachePolicy }, { enabled: false });
      assert.equal(decision.source, 'live');
      assert.equal(decision.usedCache, false);
      assert.equal(decision.cacheFreshness, 'not_applicable');
      assert.equal(decision.requestedCachePolicy, cachePolicy);
    }
  });

  it('refuses to run if a sales cache is somehow enabled', () => {
    assert.throws(() => decideSalesSource({ cachePolicy: 'use_cache' }, { enabled: true }));
  });
});
