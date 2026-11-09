/** Catalog repository tests against a real, isolated local MongoDB database (skipped if unreachable). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { connectDatabase, disconnectDatabase } from '../../config/database.js';
import { CatalogCache, ensureModelIndexes } from '../../models/index.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../../models/support/mongo-fixture.js';
import { normalizeCatalog } from '../gaap/catalog.adapter.js';
import { MIXED_PRODUCTS } from '../gaap/fixtures/catalog.fixture.js';
import { loadCatalogCacheConfig } from './catalog-cache.config.js';
import { createCatalogCacheRepository } from './catalog-cache.repository.js';

const HOUR = 3_600_000;
const FETCHED = '2026-11-07T10:00:00.000Z';

function result() {
  const { departments, products, malformed } = normalizeCatalog(MIXED_PRODUCTS);
  return {
    departments,
    products,
    malformed,
    scan: {
      source: 'products',
      departmentGroup: 'POS Department',
      pages: 1,
      recordsScanned: 4,
      excludedInactive: 0,
      truncated: false,
    },
    complete: true,
    incompleteReasons: [],
    fetchedAt: FETCHED,
  };
}

describe('loadCatalogCacheConfig', () => {
  it('has defaults and validates ranges', () => {
    assert.equal(loadCatalogCacheConfig({}).ttlMs, 24 * HOUR);
    assert.equal(loadCatalogCacheConfig({ CATALOG_CACHE_TTL_HOURS: '2' }).ttlMs, 2 * HOUR);
    for (const env of [
      { CATALOG_CACHE_TTL_HOURS: '0' },
      { CATALOG_CACHE_TTL_HOURS: '721' },
      { CATALOG_CACHE_TTL_HOURS: 'abc' },
      { CATALOG_CACHE_TTL_HOURS: '1.5' },
    ]) {
      assert.throws(() => loadCatalogCacheConfig(env), /CATALOG_/);
    }
  });
});

const skip = await skipUnlessMongo();

describe('catalog cache repository (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  let clock = new Date('2026-11-07T10:30:00.000Z');
  const repo = createCatalogCacheRepository({
    ttlMs: HOUR,
    now: () => clock,
    logger: { warn() {} },
  });

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

  it('round-trips the catalog with one document', async () => {
    const input = result();
    await repo.save(input);
    await repo.save(input);
    const found = await repo.find();

    assert.deepEqual(found.departments, input.departments);
    assert.deepEqual(found.products, input.products);
    assert.equal(found.complete, true);
    assert.equal(found.freshness, 'fresh');
    assert.equal(found.expired, false);
    assert.equal(found.fetchedAt, FETCHED);
    assert.equal(found.expiresAt, '2026-11-07T11:00:00.000Z');
    assert.equal(await CatalogCache.countDocuments({ key: 'catalog' }), 1);
  });

  it('reports expiry without hiding the data', async () => {
    await repo.save(result());
    clock = new Date('2026-11-07T12:00:00.000Z');
    const found = await repo.find();
    assert.equal(found.expired, true);
    assert.equal(found.freshness, 'stale');
    assert.equal(found.products.length, 4);
  });

  it('ignores a corrupt stored payload', async () => {
    await CatalogCache.create({
      source: 'GAAP_UNITY',
      key: 'catalog',
      payload: { departments: 'bad' },
      fetchedAt: new Date(FETCHED),
      expiresAt: new Date('2026-11-07T11:00:00.000Z'),
      freshness: 'incomplete',
    });
    assert.equal(await repo.find(), null);
  });

  it('ignores a stored payload from before the POS-department rule', async () => {
    const legacy = {
      ...result(),
      scan: { source: 'products', pages: 1, recordsScanned: 4, truncated: false },
    };
    await CatalogCache.create({
      source: 'GAAP_UNITY',
      key: 'catalog',
      payload: legacy,
      fetchedAt: new Date(FETCHED),
      expiresAt: new Date('2026-11-07T11:00:00.000Z'),
      freshness: 'incomplete',
    });
    assert.equal(await repo.find(), null);
  });

  it('does not touch the nodes document', async () => {
    await CatalogCache.create({
      source: 'GAAP_UNITY',
      key: 'nodes',
      payload: { nodes: [] },
      fetchedAt: new Date(FETCHED),
      expiresAt: new Date('2026-11-07T11:00:00.000Z'),
      freshness: 'fresh',
    });
    await repo.save(result());
    assert.equal(await CatalogCache.countDocuments({}), 2);
  });
});
