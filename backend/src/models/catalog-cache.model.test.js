import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { CatalogCache } from './catalog-cache.model.js';
import { ensureModelIndexes } from './index.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from './support/mongo-fixture.js';

const FETCHED = new Date('2026-11-07T10:00:00Z');
const LATER = new Date('2026-11-07T11:00:00Z');

function entry(overrides = {}) {
  return {
    source: 'GAAP_UNITY',
    key: 'nodes',
    payload: [{ id: 'DEMO-NODE-1', name: 'Demo node' }],
    fetchedAt: FETCHED,
    expiresAt: LATER,
    ...overrides,
  };
}

async function errorsFor(data) {
  const error = await new CatalogCache(data).validate().then(
    () => null,
    (e) => e,
  );
  return error ? Object.keys(error.errors) : [];
}

describe('CatalogCache validation', () => {
  it('accepts an entry and defaults freshness to fresh', async () => {
    const doc = new CatalogCache(entry());
    await doc.validate();
    assert.equal(doc.freshness, 'fresh');
  });

  it('requires source, key, payload, fetchedAt and expiresAt', async () => {
    for (const field of ['source', 'key', 'payload', 'fetchedAt', 'expiresAt']) {
      const data = entry();
      delete data[field];
      assert.ok((await errorsFor(data)).includes(field), `${field} should be required`);
    }
  });

  it('rejects unknown sources, empty keys and unknown freshness values', async () => {
    assert.ok((await errorsFor(entry({ source: 'MADE_UP' }))).includes('source'));
    assert.ok((await errorsFor(entry({ key: '' }))).includes('key'));
    assert.ok((await errorsFor(entry({ freshness: 'current' }))).includes('freshness'));
  });

  it('requires expiry to be after the fetch time', async () => {
    assert.ok((await errorsFor(entry({ expiresAt: FETCHED }))).includes('expiresAt'));
    assert.ok(
      (await errorsFor(entry({ expiresAt: new Date('2026-11-07T09:00:00Z') }))).includes(
        'expiresAt',
      ),
    );
  });

  it('treats only unexpired fresh entries as current', () => {
    const during = new Date('2026-11-07T10:30:00Z');
    const after = new Date('2026-11-07T12:00:00Z');
    assert.equal(new CatalogCache(entry()).isCurrent(during), true);
    assert.equal(new CatalogCache(entry()).isCurrent(after), false, 'expired');
    assert.equal(new CatalogCache(entry({ freshness: 'stale' })).isCurrent(during), false);
    assert.equal(new CatalogCache(entry({ freshness: 'incomplete' })).isCurrent(during), false);
  });
});

const skip = await skipUnlessMongo();

describe('CatalogCache persistence (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });

  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  it('creates the unique source+key index and the expiry index', async () => {
    const indexes = await CatalogCache.collection.indexes();
    const byKey = new Map(indexes.map((index) => [JSON.stringify(index.key), index]));
    assert.equal(byKey.get(JSON.stringify({ source: 1, key: 1 }))?.unique, true);
    const expiry = byKey.get(JSON.stringify({ expiresAt: 1 }));
    assert.ok(expiry, 'expiresAt index missing');
    assert.equal(expiry.expireAfterSeconds, undefined, 'must not be a TTL index');
  });

  it('round-trips payload and timestamps', async () => {
    await CatalogCache.create(entry({ key: 'roundtrip' }));
    const loaded = await CatalogCache.findOne({ source: 'GAAP_UNITY', key: 'roundtrip' }).lean();
    assert.deepEqual(loaded.payload, [{ id: 'DEMO-NODE-1', name: 'Demo node' }]);
    assert.equal(loaded.fetchedAt.toISOString(), FETCHED.toISOString());
    assert.equal(loaded.freshness, 'fresh');
  });

  it('rejects a duplicate source+key but allows the same key from another source', async () => {
    await CatalogCache.create(entry({ key: 'products' }));
    await assert.rejects(CatalogCache.create(entry({ key: 'products' })), (e) => e.code === 11000);
    await assert.doesNotReject(
      CatalogCache.create(entry({ key: 'products', source: 'CONFIGURED_MAPPING' })),
    );
  });
});
