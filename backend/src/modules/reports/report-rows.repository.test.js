/**
 * Report detail table (Feature 24) tests against a real, isolated local MongoDB database (dropped
 * afterwards). Skipped when no MongoDB answers. Rows are FIXTURES; no GAAP adapter exists in this test.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { ensureModelIndexes } from '../../models/index.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { createReportRepository, ROWS_MAX_LIMIT } from './report.repository.js';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const REQUEST = Object.freeze({
  startDate: '20261101',
  endDate: '20261107',
  productIds: ['p1', 'p2', 'p3'],
  nodes: { mode: 'nodes', nodeIds: ['n1', 'n2'] },
  cachePolicy: 'bypass_cache',
});
const provenance = {
  source: 'GAAP_UNITY',
  sourceStartedAt: new Date('2026-11-08T09:58:00Z'),
  fetchedAt: new Date('2026-11-08T09:59:00Z'),
  usedCache: false,
  cacheFreshness: 'not_applicable',
  complete: true,
};

const skip = await skipUnlessMongo();

describe('report repository listRows (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  const repository = createReportRepository({ batchSize: 50 });

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });
  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  const CURRENCIES = ['USD', 'ZWG', 'UNKNOWN'];
  /** Deterministic fixture rows: many lines share the same turnover so sorting needs a tiebreak. */
  function makeRows(count, tag) {
    return Array.from({ length: count }, (_, i) => ({
      lineIndex: i,
      sourceLineKey: `${tag}-s${i}/l1`,
      transactionAt: new Date(Date.UTC(2026, 10, 1 + (i % 5), 8, i % 60)),
      nodeId: `n${(i % 2) + 1}`,
      nodeName: i % 2 === 0 ? 'Harare Store' : 'Bulawayo Store',
      productId: `p${(i % 3) + 1}`,
      productName: `Product ${(i % 3) + 1}`,
      currency: CURRENCIES[i % 3],
      quantity: String((i % 4) + 1),
      turnover: `${(i % 7) + 1}.${i % 100 < 10 ? '0' : ''}${i % 100}`,
      warnings: [],
    }));
  }

  function totalsOf(rows) {
    const map = new Map();
    for (const row of rows) {
      const entry = map.get(row.currency) ?? { lineCount: 0, quantity: 0n, turnover: 0n };
      entry.lineCount += 1;
      entry.quantity += BigInt(row.quantity);
      // Fixture turnovers have at most two decimals; counted in cents.
      const [whole, fraction = ''] = row.turnover.replace('-', '').split('.');
      const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
      entry.turnover += row.turnover.startsWith('-') ? -cents : cents;
      map.set(row.currency, entry);
    }
    return map;
  }
  const savedTotals = (rows) =>
    [...totalsOf(rows)].map(([currency, entry]) => ({
      currency,
      lineCount: entry.lineCount,
      quantity: String(entry.quantity),
      turnover: `${entry.turnover / 100n}.${String(entry.turnover % 100n).padStart(2, '0')}`,
    }));

  async function completed(rows) {
    const { reportId } = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markCompleted({
      reportId,
      totals: savedTotals(rows),
      rows,
      provenance,
      calculationVersion: 'v-test',
      completedAt: NOW,
    });
    return reportId;
  }

  async function walk(reportId, query, pageSize) {
    const seen = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await repository.listRows(reportId, { ...query, limit: pageSize, offset });
      seen.push(...page.rows);
      if (page.rows.length < pageSize) return seen;
    }
  }

  it('pages every row exactly once in every sort, ascending and descending (stable, no repeats or gaps)', async () => {
    const rows = makeRows(257, 'a');
    const reportId = await completed(rows);
    for (const sort of [
      'lineIndex',
      'transactionAt',
      'productName',
      'nodeName',
      'currency',
      'quantity',
      'turnover',
    ]) {
      for (const order of ['asc', 'desc']) {
        const all = await walk(reportId, { sort, order }, 40);
        assert.equal(all.length, 257, `${sort} ${order}`);
        assert.deepEqual(
          all.map((r) => r.lineIndex).sort((a, b) => a - b),
          rows.map((r) => r.lineIndex),
          `${sort} ${order}`,
        );
        // Re-reading gives the identical order (stable pagination).
        const again = await walk(reportId, { sort, order }, 40);
        assert.deepEqual(again, all, `${sort} ${order} repeat`);
        // Page size does not change the order either.
        const other = await walk(reportId, { sort, order }, 97);
        assert.deepEqual(other, all, `${sort} ${order} page size`);
      }
    }
  });

  it('sorts amounts numerically (not as text) and strings correctly', async () => {
    const reportId = await completed([
      { ...makeRows(1, 'n')[0], lineIndex: 0, sourceLineKey: 'n0', turnover: '9', quantity: '10' },
      { ...makeRows(1, 'n')[0], lineIndex: 1, sourceLineKey: 'n1', turnover: '100', quantity: '2' },
      { ...makeRows(1, 'n')[0], lineIndex: 2, sourceLineKey: 'n2', turnover: '-5', quantity: '-1' },
    ]);
    const byTurnover = await repository.listRows(reportId, { sort: 'turnover', order: 'desc' });
    assert.deepEqual(
      byTurnover.rows.map((r) => r.turnover),
      ['100', '9', '-5'],
    );
    const byQuantity = await repository.listRows(reportId, { sort: 'quantity', order: 'asc' });
    assert.deepEqual(
      byQuantity.rows.map((r) => r.quantity),
      ['-1', '2', '10'],
    );
  });

  it("returns only this report's rows, never another report's (row isolation)", async () => {
    const first = await completed(makeRows(30, 'iso1'));
    const second = await completed(makeRows(45, 'iso2'));
    const firstRows = await walk(first, {}, 7);
    const secondRows = await walk(second, {}, 7);
    assert.equal(firstRows.length, 30);
    assert.equal(secondRows.length, 45);
    assert.ok(firstRows.every((r) => r.sourceLineKey.startsWith('iso1-')));
    assert.ok(secondRows.every((r) => r.sourceLineKey.startsWith('iso2-')));
    // A search for the other report's key finds nothing.
    const cross = await repository.listRows(first, { search: 'iso2-' });
    assert.equal(cross.total, 0);
    assert.deepEqual(cross.rows, []);
    // Row views expose neither the report id nor internal ids.
    for (const row of firstRows) {
      assert.equal('reportId' in row, false);
      assert.equal('_id' in row, false);
    }
  });

  it('never returns more than the page cap and refuses oversized or invalid paging', async () => {
    const reportId = await completed(makeRows(300, 'cap'));
    const page = await repository.listRows(reportId, { limit: ROWS_MAX_LIMIT });
    assert.equal(page.rows.length, ROWS_MAX_LIMIT);
    assert.equal(page.total, 300);
    for (const bad of [
      { limit: ROWS_MAX_LIMIT + 1 },
      { limit: 0 },
      { limit: 1.5 },
      { offset: -1 },
      { offset: 1_000_001 },
      { sort: 'reportId' },
      { sort: '$where' },
      { order: 'up' },
      { currency: 'usd' },
      { search: '' },
      { productId: '' },
    ]) {
      await assert.rejects(
        () => repository.listRows(reportId, bad),
        RangeError,
        JSON.stringify(bad),
      );
    }
  });

  it('paging past the end is empty with the true total', async () => {
    const reportId = await completed(makeRows(12, 'end'));
    const page = await repository.listRows(reportId, { offset: 500 });
    assert.deepEqual(page.rows, []);
    assert.equal(page.total, 12);
  });

  it('filters by currency, product, node and search, and totals follow the filters', async () => {
    const rows = makeRows(120, 'flt');
    const reportId = await completed(rows);

    const zwg = rows.filter((r) => r.currency === 'ZWG');
    const result = await repository.listRows(reportId, { currency: 'ZWG', limit: 200 });
    assert.equal(result.total, zwg.length);
    assert.ok(result.rows.every((r) => r.currency === 'ZWG'));
    assert.deepEqual(
      result.totals.map((t) => [t.currency, t.lineCount, t.quantity]),
      [['ZWG', zwg.length, String(zwg.reduce((n, r) => n + Number(r.quantity), 0))]],
    );

    const p2n1 = rows.filter((r) => r.productId === 'p2' && r.nodeId === 'n1');
    const combined = await repository.listRows(reportId, {
      productId: 'p2',
      nodeId: 'n1',
      limit: 200,
    });
    assert.equal(combined.total, p2n1.length);
    assert.ok(combined.rows.every((r) => r.productId === 'p2' && r.nodeId === 'n1'));

    const named = await repository.listRows(reportId, { search: 'bulawayo', limit: 200 });
    assert.equal(named.total, rows.filter((r) => r.nodeName === 'Bulawayo Store').length);
    assert.ok(named.rows.every((r) => r.nodeName === 'Bulawayo Store'));

    // No match: an empty page and no totals (not a zero total in any currency).
    const none = await repository.listRows(reportId, { search: 'no such product' });
    assert.deepEqual([none.rows, none.total, none.totals], [[], 0, []]);
  });

  it('with no filter the table totals equal the saved report totals, per currency', async () => {
    const rows = makeRows(211, 'tot');
    const reportId = await completed(rows);
    const result = await repository.listRows(reportId, { limit: 5 });
    assert.equal(result.total, 211);
    assert.equal(result.rowCount, 211);
    assert.deepEqual(result.totals, result.reportTotals);
    assert.deepEqual(
      result.totals.map((t) => t.currency),
      ['USD', 'ZWG', 'UNKNOWN'],
    );
    // Filtered totals add up to the whole, currency by currency (currencies are never merged).
    for (const total of result.reportTotals) {
      const one = await repository.listRows(reportId, { currency: total.currency, limit: 1 });
      assert.deepEqual(one.totals, [total]);
    }
  });

  it('treats search text literally: pattern characters match nothing and cannot run a query', async () => {
    const reportId = await completed(makeRows(20, 'lit'));
    for (const search of ['.*', '^Product', '(', '[a-z]+', '\\', 'a|b', '$ne', '{"$ne":1}']) {
      const result = await repository.listRows(reportId, { search });
      assert.equal(result.total, 0, search);
    }
    const dot = await repository.listRows(reportId, { search: 'Product 1' });
    assert.ok(dot.total > 0);
  });

  it('is case-insensitive in search and finds product and node ids and source line keys', async () => {
    const reportId = await completed(makeRows(20, 'Key'));
    assert.ok((await repository.listRows(reportId, { search: 'PRODUCT 2' })).total > 0);
    assert.ok((await repository.listRows(reportId, { search: 'key-s3/' })).total === 1);
    assert.ok((await repository.listRows(reportId, { search: 'p3' })).total > 0);
  });

  it('answers null for an unknown report and completed:false for pending and failed ones', async () => {
    assert.equal(await repository.listRows('bbbbbbbbbbbbbbbbbbbbbbbb'), null);
    assert.equal(await repository.listRows('not-an-id'), null);

    const pending = await repository.createPending({ request: REQUEST, startedAt: NOW });
    assert.deepEqual(await repository.listRows(pending.reportId), {
      completed: false,
      status: 'pending',
    });

    const failed = await repository.createPending({ request: REQUEST, startedAt: NOW });
    await repository.markFailed({
      reportId: failed.reportId,
      code: 'GAAP_UNAVAILABLE',
      message: 'The source system could not be reached.',
      failedAt: NOW,
    });
    assert.deepEqual(await repository.listRows(failed.reportId), {
      completed: false,
      status: 'failed',
    });
  });

  it('serves large reports page by page without reading them whole (12,000 rows)', async () => {
    const rows = makeRows(12_000, 'big');
    const reportId = await completed(rows);
    const started = Date.now();
    const middle = await repository.listRows(reportId, {
      sort: 'turnover',
      order: 'desc',
      limit: 200,
      offset: 6_000,
    });
    assert.equal(middle.rows.length, 200);
    assert.equal(middle.total, 12_000);
    assert.deepEqual(middle.totals, middle.reportTotals);
    // The last page holds the remainder and nothing beyond it.
    const last = await repository.listRows(reportId, { limit: 200, offset: 11_900 });
    assert.equal(last.rows.length, 100);
    assert.equal(last.rows.at(-1).lineIndex, 11_999);
    assert.ok(Date.now() - started < 30_000, 'large-report page requests stay fast');
    // A page response stays small however large the report is.
    assert.ok(JSON.stringify(middle.rows).length < 200 * 600);
  });
});
