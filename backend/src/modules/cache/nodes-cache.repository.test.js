/** Repository tests against a real, isolated local MongoDB database (skipped if unreachable). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { CatalogCache, ensureModelIndexes } from '../../models/index.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { MIXED_NODES, fixtureStore } from '../gaap/fixtures/nodes.fixture.js';
import { normalizeNodes } from '../gaap/nodes.adapter.js';
import { loadNodesCacheConfig } from './nodes-cache.config.js';
import { createNodesCacheRepository } from './nodes-cache.repository.js';

const HOUR = 3_600_000;
const FETCHED = '2026-11-07T10:00:00.000Z';

function result(records = MIXED_NODES, overrides = {}) {
  const { nodes, malformed } = normalizeNodes(records);
  return {
    nodes,
    malformed,
    rawCount: records.length,
    upstreamTotal: records.length,
    complete: true,
    fetchedAt: FETCHED,
    ...overrides,
  };
}

describe('loadNodesCacheConfig', () => {
  it('defaults to 24 hours and validates the range', () => {
    assert.equal(loadNodesCacheConfig({}).ttlMs, 24 * HOUR);
    assert.equal(loadNodesCacheConfig({ NODES_CACHE_TTL_HOURS: '2' }).ttlMs, 2 * HOUR);
    for (const bad of ['0', '721', 'abc', '1.5']) {
      assert.throws(
        () => loadNodesCacheConfig({ NODES_CACHE_TTL_HOURS: bad }),
        /NODES_CACHE_TTL_HOURS/,
      );
    }
  });
});

const skip = await skipUnlessMongo();

describe('nodes cache repository (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  let clock = new Date('2026-11-07T10:30:00.000Z');
  const repo = createNodesCacheRepository({ ttlMs: HOUR, now: () => clock, logger: { warn() {} } });

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });
  beforeEach(async () => {
    await CatalogCache.deleteMany({});
    clock = new Date('2026-11-07T10:30:00.000Z');
  });
  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  it('returns null when nothing is stored', async () => {
    assert.equal(await repo.find(), null);
  });

  it('round-trips the normalized nodes with timestamps and freshness', async () => {
    const input = result();
    await repo.save(input);
    const found = await repo.find();

    assert.deepEqual(found.nodes, input.nodes);
    assert.deepEqual(found.malformed, input.malformed);
    assert.equal(found.rawCount, 4);
    assert.equal(found.complete, true);
    assert.equal(found.fetchedAt, FETCHED);
    assert.equal(found.expiresAt, '2026-11-07T11:00:00.000Z');
    assert.equal(found.freshness, 'fresh');
  });

  it('labels data stale after expiry but still returns it', async () => {
    await repo.save(result());
    clock = new Date('2026-11-07T11:00:01.000Z');
    const found = await repo.find();
    assert.equal(found.freshness, 'stale');
    assert.equal(found.nodes.length, 4);
  });

  it('labels a partial fetch incomplete, never fresh', async () => {
    await repo.save(result(MIXED_NODES, { complete: false }));
    assert.equal((await repo.find()).freshness, 'incomplete');
  });

  it('keeps exactly one document per source and key, replaced on each save', async () => {
    await repo.save(result([fixtureStore(10)]));
    await repo.save(
      result([fixtureStore(10), fixtureStore(11)], { fetchedAt: '2026-11-07T10:10:00.000Z' }),
    );
    assert.equal(await CatalogCache.countDocuments({}), 1);
    const found = await repo.find();
    assert.equal(found.nodes.length, 2);
    assert.equal(found.fetchedAt, '2026-11-07T10:10:00.000Z');
  });

  it('survives a new repository instance (data lives in the database, not in memory)', async () => {
    await repo.save(result());
    const other = createNodesCacheRepository({ ttlMs: HOUR, now: () => clock });
    assert.equal((await other.find()).nodes.length, 4);
  });

  it('stores only normalized fields, never raw GAAP record content', async () => {
    const record = fixtureStore(10, {
      integrationConfig: [
        {
          type: 'x',
          config: { client_secret: 'FIXTURE-SECRET-VALUE', password: 'FIXTURE-PASSWORD' },
        },
      ],
    });
    await repo.save(result([record]));
    const raw = JSON.stringify(await CatalogCache.findOne({}).lean());
    assert.ok(!raw.includes('FIXTURE-SECRET-VALUE'));
    assert.ok(!raw.includes('FIXTURE-PASSWORD'));
    assert.ok(!raw.includes('integrationConfig'));
  });

  it('ignores a corrupted stored payload so the caller refetches', async () => {
    await repo.save(result());
    await CatalogCache.updateOne({}, { $set: { payload: { nodes: 'nope' } } });
    assert.equal(await repo.find(), null);

    const badNode = {
      nodes: [{ id: 5 }],
      malformed: [],
      rawCount: 1,
      upstreamTotal: 1,
      complete: true,
    };
    await CatalogCache.updateOne({}, { $set: { payload: badNode } });
    assert.equal(await repo.find(), null);
  });
});
