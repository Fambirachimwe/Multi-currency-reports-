import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixturePage, fixtureSale, fixtureSales } from './fixtures/sales.fixture.js';
import { GAAP_ERROR_CODES, GaapError } from './gaap.errors.js';
import {
  buildMatch,
  buildQueries,
  createSalesAdapter,
  EXCLUSION_REASONS,
  SALES_SORT,
} from './sales.adapter.js';

/** Reads the tuple-format `match` string `[("a", "eq", "b"), ...]` back into arrays (test ids contain no parentheses). */
function parseMatch(match) {
  return JSON.parse(match.replace(/^\[\(/, '[[').replaceAll('), (', '], [').replace(/\)\]$/, ']]'));
}

// All tests use a scripted client (FIXTURE). None of this is live GAAP evidence.

const RANGE = { startDate: '20261105', endDate: '20261105' };
const NOW = () => new Date('2026-11-08T10:00:00.000Z');

/** Client whose responses come from `handler(params, callIndex)`; records every call. */
function scriptedClient(handler) {
  const calls = [];
  return {
    calls,
    async get(path, params, options) {
      calls.push({ path, params: { ...params }, options });
      const result = await handler(params, calls.length - 1);
      return { data: result };
    },
  };
}

/** A paged data set served by `skip`/`limit`, like GAAP does for one match. */
function pagedClient(all, { onCall } = {}) {
  return scriptedClient((params, index) => {
    onCall?.(params, index);
    const skip = Number(params.skip);
    const limit = Number(params.limit);
    return fixturePage(all.slice(skip, skip + limit), limit);
  });
}

const transient = () =>
  new GaapError({ code: GAAP_ERROR_CODES.TIMEOUT, message: 'timeout', retryable: true });
const fatal = () =>
  new GaapError({ code: GAAP_ERROR_CODES.AUTH, message: 'denied', status: 401, retryable: false });

function adapter(client, options = {}) {
  return createSalesAdapter({ client, pageSize: 10, now: NOW, ...options });
}

describe('request shape', () => {
  it('sends the demonstrated match/limit/skip/sort and the eligibility filters', async () => {
    const client = pagedClient(fixtureSales(1, 3));
    await adapter(client).fetchSales({ ...RANGE });

    assert.equal(client.calls.length, 1);
    const { path, params } = client.calls[0];
    assert.equal(path, '/sales');
    assert.equal(params.limit, 10);
    assert.equal(params.skip, 0);
    assert.equal(params.sort, SALES_SORT);
    assert.deepEqual(parseMatch(params.match), [
      ['createdDate', 'gte', '20261105'],
      ['createdDate', 'lte', '20261105'],
      ['status', 'eq', 'TENDERED'],
      ['isNegative', 'eq', false],
    ]);
  });

  it('writes match in the tuple format GAAP documents', () => {
    assert.equal(
      buildMatch({ ...RANGE, productId: 'p1' }),
      '[("createdDate", "gte", "20261105"), ("createdDate", "lte", "20261105"), ("status", "eq", "TENDERED"), ("isNegative", "eq", false), ("items.product._id", "eq", "p1")]',
    );
  });

  it('adds product and node filters with eq', () => {
    const match = parseMatch(buildMatch({ ...RANGE, productId: 'p1', nodeId: 'n1' }));
    assert.deepEqual(match.slice(4), [
      ['items.product._id', 'eq', 'p1'],
      ['nodeId', 'eq', 'n1'],
    ]);
  });

  it('plans one query per product x node, de-duplicating the inputs', () => {
    const queries = buildQueries(
      { ...RANGE, productIds: ['p2', 'p1', 'p1'], nodeIds: ['n1', 'n2'] },
      { maxQueries: 10 },
    );
    assert.equal(queries.length, 4);
  });

  it('refuses a plan larger than the query cap before calling GAAP', async () => {
    const client = pagedClient([]);
    await assert.rejects(
      adapter(client, { maxQueries: 3 }).fetchSales({
        ...RANGE,
        productIds: ['a', 'b'],
        nodeIds: ['x', 'y'],
      }),
      { code: GAAP_ERROR_CODES.INVALID_REQUEST },
    );
    assert.equal(client.calls.length, 0);
  });

  it('rejects invalid input without calling GAAP', async () => {
    const client = pagedClient([]);
    const bad = [
      { startDate: '2026-11-05', endDate: '20261105' },
      { startDate: '20261106', endDate: '20261105' },
      { ...RANGE, productIds: 'p1' },
      { ...RANGE, nodeIds: [''] },
      undefined,
    ];
    for (const input of bad) {
      await assert.rejects(adapter(client).fetchSales(input), GaapError);
    }
    assert.equal(client.calls.length, 0);
  });
});

describe('multi-page extraction', () => {
  it('accounts for every page and every record across several pages', async () => {
    const all = fixtureSales(1, 25);
    const result = await adapter(pagedClient(all)).fetchSales({ ...RANGE });

    assert.equal(result.complete, true);
    assert.equal(result.partial, false);
    assert.equal(result.pageCount, 3);
    assert.deepEqual(
      result.pages.map((p) => [p.skip, p.received]),
      [
        [0, 10],
        [10, 10],
        [20, 5],
      ],
    );
    assert.equal(result.receivedCount, 25);
    assert.equal(result.sales.length, 25);
    assert.equal(new Set(result.sales.map((s) => s._id)).size, 25);
    assert.equal(result.duplicateCount, 0);
    assert.equal(result.fetchedAt, '2026-11-08T10:00:00.000Z');
    assert.deepEqual(result.range, RANGE);
  });

  it('needs the extra empty page when the total is an exact multiple of the page size', async () => {
    const result = await adapter(pagedClient(fixtureSales(1, 20))).fetchSales({ ...RANGE });
    assert.equal(result.complete, true);
    assert.deepEqual(
      result.pages.map((p) => p.received),
      [10, 10, 0],
    );
    assert.equal(result.sales.length, 20);
  });

  it('returns an empty complete result for a day with no sales', async () => {
    const result = await adapter(pagedClient([])).fetchSales({ ...RANGE });
    assert.equal(result.complete, true);
    assert.equal(result.sales.length, 0);
    assert.equal(result.pageCount, 1);
  });

  it('ignores totalRecords, which GAAP sets to the page size', async () => {
    const client = scriptedClient((params) => {
      const skip = Number(params.skip);
      const data = fixtureSales(1, 14).slice(skip, skip + 10);
      return { totalRecords: 3, data };
    });
    const result = await adapter(client).fetchSales({ ...RANGE });
    assert.equal(result.sales.length, 14);
    assert.equal(result.complete, true);
  });

  it('sorts output deterministically by createdDate then _id', async () => {
    const shuffled = [fixtureSale(5), fixtureSale(2), fixtureSale(9)];
    const result = await adapter(pagedClient(shuffled)).fetchSales({ ...RANGE });
    assert.deepEqual(
      result.sales.map((s) => s._id),
      ['sale000002', 'sale000005', 'sale000009'],
    );
  });

  it('forwards the abort signal and request id to the client', async () => {
    const client = pagedClient(fixtureSales(1, 2));
    const controller = new AbortController();
    await adapter(client).fetchSales({ ...RANGE, signal: controller.signal, requestId: 'req-1' });
    assert.equal(client.calls[0].options.signal, controller.signal);
    assert.equal(client.calls[0].options.requestId, 'req-1');
  });
});

describe('overlap and duplicates', () => {
  it('drops a sale that appears on two pages (overlap) and counts it', async () => {
    const page0 = fixtureSales(1, 10); // sales 1..10
    const page1 = [fixtureSale(10), ...fixtureSales(11, 4)]; // sale 10 repeated across the boundary
    const client = scriptedClient((params) =>
      fixturePage(Number(params.skip) === 0 ? page0 : page1, 10),
    );
    const result = await adapter(client).fetchSales({ ...RANGE });

    assert.equal(result.receivedCount, 15);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.sales.length, 14);
    assert.equal(new Set(result.sales.map((s) => s._id)).size, 14);
    assert.equal(result.complete, true);
  });

  it('keeps one copy when a whole page is returned twice', async () => {
    const same = fixtureSales(1, 10);
    const client = scriptedClient((params) =>
      Number(params.skip) < 20 ? fixturePage(same, 10) : fixturePage([], 10),
    );
    const result = await adapter(client).fetchSales({ ...RANGE });
    assert.equal(result.sales.length, 10);
    assert.equal(result.duplicateCount, 10);
  });

  it('counts a sale once when several selected products return it', async () => {
    const shared = fixtureSale(1, {
      items: [{ product: { _id: 'p1' } }, { product: { _id: 'p2' } }],
    });
    const onlyP2 = fixtureSale(2, { items: [{ product: { _id: 'p2' } }] });
    const client = scriptedClient((params) => {
      const product = parseMatch(params.match).find((c) => c[0] === 'items.product._id')[2];
      return fixturePage(product === 'p1' ? [shared] : [shared, onlyP2], 10);
    });
    const result = await adapter(client).fetchSales({ ...RANGE, productIds: ['p1', 'p2'] });

    assert.equal(client.calls.length, 2);
    assert.equal(result.queryCount, 2);
    assert.deepEqual(
      result.sales.map((s) => s._id),
      [shared._id, onlyP2._id],
    );
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.complete, true);
  });
});

describe('failure, retry and partial results', () => {
  it('retries a transient page failure and then completes', async () => {
    let failedOnce = false;
    const all = fixtureSales(1, 15);
    const client = scriptedClient((params) => {
      if (Number(params.skip) === 10 && !failedOnce) {
        failedOnce = true;
        throw transient();
      }
      return fixturePage(all.slice(Number(params.skip), Number(params.skip) + 10), 10);
    });
    const result = await adapter(client, { pageRetries: 1 }).fetchSales({ ...RANGE });

    assert.equal(result.complete, true);
    assert.equal(result.sales.length, 15);
    assert.equal(client.calls.length, 3);
    assert.equal(result.pages[1].attempts, 2);
  });

  it('marks the result partial when a page keeps failing, and keeps what was fetched', async () => {
    const all = fixtureSales(1, 30);
    const client = scriptedClient((params) => {
      if (Number(params.skip) === 10) throw transient();
      return fixturePage(all.slice(Number(params.skip), Number(params.skip) + 10), 10);
    });
    const result = await adapter(client, { pageRetries: 2 }).fetchSales({ ...RANGE });

    assert.equal(result.complete, false);
    assert.equal(result.partial, true);
    assert.deepEqual(result.incompleteReasons, ['PAGE_FAILED']);
    assert.equal(result.sales.length, 10);
    assert.deepEqual(result.failures, [
      { code: GAAP_ERROR_CODES.TIMEOUT, message: 'timeout', query: 0, skip: 10 },
    ]);
    // 1 good page + 3 attempts at the failing one; no pages after the gap are fetched.
    assert.equal(client.calls.length, 4);
  });

  it('does not retry a non-retryable error', async () => {
    const client = scriptedClient(() => {
      throw fatal();
    });
    const result = await adapter(client, { pageRetries: 3 }).fetchSales({ ...RANGE });
    assert.equal(client.calls.length, 1);
    assert.equal(result.complete, false);
    assert.equal(result.failures[0].code, GAAP_ERROR_CODES.AUTH);
    assert.equal(result.sales.length, 0);
  });

  it('retries a malformed page body and fails closed if it stays malformed', async () => {
    const client = scriptedClient(() => ({ totalRecords: 1 }));
    const result = await adapter(client, { pageRetries: 1 }).fetchSales({ ...RANGE });
    assert.equal(client.calls.length, 2);
    assert.equal(result.complete, false);
    assert.equal(result.failures[0].code, GAAP_ERROR_CODES.INVALID_RESPONSE);
  });

  it('fails one product query but still reports the others, as partial', async () => {
    const client = scriptedClient((params) => {
      const product = parseMatch(params.match).find((c) => c[0] === 'items.product._id')[2];
      if (product === 'p2') throw transient();
      return fixturePage([fixtureSale(1, { items: [{ product: { _id: 'p1' } }] })], 10);
    });
    const result = await adapter(client, { pageRetries: 0 }).fetchSales({
      ...RANGE,
      productIds: ['p1', 'p2'],
    });
    assert.equal(result.partial, true);
    assert.equal(result.failures[0].query, 1);
    assert.equal(result.sales.length, 1);
  });

  it('is partial when the page cap truncates the data', async () => {
    const client = pagedClient(fixtureSales(1, 100));
    const result = await adapter(client, { maxPages: 3 }).fetchSales({ ...RANGE });
    assert.equal(result.complete, false);
    assert.deepEqual(result.incompleteReasons, ['PAGE_CAP_REACHED']);
    assert.equal(result.pageCount, 3);
    assert.equal(result.sales.length, 30);
    assert.equal(client.calls.length, 3);
  });

  it('is partial when GAAP returns records that cannot be identified', async () => {
    const client = pagedClient([fixtureSale(1), { createdDate: 'x' }, 'junk', null]);
    const result = await adapter(client).fetchSales({ ...RANGE });
    assert.equal(result.complete, false);
    assert.deepEqual(result.incompleteReasons, ['UNUSABLE_RECORDS']);
    assert.equal(result.excluded[EXCLUSION_REASONS.MISSING_ID], 1);
    assert.equal(result.excluded[EXCLUSION_REASONS.NOT_AN_OBJECT], 2);
    assert.equal(result.sales.length, 1);
  });

  it('rethrows when the caller aborts instead of reporting a partial result', async () => {
    const controller = new AbortController();
    const client = scriptedClient(() => {
      controller.abort();
      throw new GaapError({ code: GAAP_ERROR_CODES.ABORTED, message: 'aborted' });
    });
    await assert.rejects(adapter(client).fetchSales({ ...RANGE, signal: controller.signal }), {
      code: GAAP_ERROR_CODES.ABORTED,
    });
  });

  it('never puts GAAP content in failure messages', async () => {
    const client = scriptedClient(() => {
      throw new Error('apikey=SECRET https://host/sales?apikey=SECRET');
    });
    const result = await adapter(client).fetchSales({ ...RANGE });
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  });
});

describe('eligibility re-check', () => {
  it('excludes and counts non-tendered, negative and out-of-filter sales', async () => {
    const records = [
      fixtureSale(1),
      fixtureSale(2, { status: 'OPEN' }),
      fixtureSale(3, { isNegative: true }),
      fixtureSale(4, { isNegative: undefined }),
      fixtureSale(5, { nodeId: 'node-z' }),
      fixtureSale(6, { items: [{ product: { _id: 'other' } }] }),
    ];
    const result = await adapter(pagedClient(records)).fetchSales({
      ...RANGE,
      nodeIds: ['node-a'],
      productIds: ['prod-1'],
    });

    assert.deepEqual(
      result.sales.map((s) => s._id),
      ['sale000001'],
    );
    assert.equal(result.excluded[EXCLUSION_REASONS.NOT_TENDERED], 1);
    assert.equal(result.excluded[EXCLUSION_REASONS.NEGATIVE], 2);
    assert.equal(result.excluded[EXCLUSION_REASONS.OUTSIDE_NODE_FILTER], 1);
    assert.equal(result.excluded[EXCLUSION_REASONS.OUTSIDE_PRODUCT_FILTER], 1);
    // Filter mismatches are reported, but they are not missing data.
    assert.equal(result.complete, true);
  });
});
