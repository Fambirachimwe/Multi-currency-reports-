/** Catalog service tests with a fake adapter and in-memory repository (no GAAP, no MongoDB). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAAP_ERROR_CODES, GaapError } from '../gaap/gaap.errors.js';
import { normalizeCatalog } from '../gaap/catalog.adapter.js';
import { MIXED_PRODUCTS } from '../gaap/fixtures/catalog.fixture.js';
import { createCatalogService } from './catalog.service.js';
import { catalogMemoryRepository } from './support/catalog-memory-repository.js';

const quiet = { warn() {}, error() {} };

function fakeAdapter(records = MIXED_PRODUCTS, { fail = null, delayMs = 0 } = {}) {
  const adapter = {
    calls: 0,
    async fetchCatalog() {
      adapter.calls += 1;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) throw fail;
      const { departments, products, malformed } = normalizeCatalog(records);
      return {
        departments,
        products,
        malformed,
        scan: {
          source: 'products',
          departmentGroup: 'POS Department',
          pages: 1,
          recordsScanned: records.length,
          excludedInactive: 0,
          truncated: false,
        },
        complete: true,
        incompleteReasons: [],
        fetchedAt: new Date().toISOString(),
      };
    },
  };
  return adapter;
}

const build = (adapter, repository) =>
  createCatalogService({ catalogAdapter: adapter, repository, logger: quiet });
const q = { limit: 100, offset: 0 };

describe('catalog service (FIXTURE adapter, in-memory repository)', () => {
  it('first read fetches and stores; later reads come from the database only', async () => {
    const adapter = fakeAdapter();
    const repo = catalogMemoryRepository();
    const service = build(adapter, repo);

    const first = await service.listDepartments(q);
    assert.equal(first.meta.origin, 'gaap');
    assert.equal(first.meta.persisted, true);
    for (let i = 0; i < 3; i += 1) {
      const again = await service.listDepartments(q);
      assert.equal(again.meta.origin, 'database');
      assert.deepEqual(again.items, first.items);
    }
    assert.equal(adapter.calls, 1);
    assert.equal(repo.state.saves, 1);
  });

  it('reports a complete, fresh catalog from the products endpoint', async () => {
    const { meta } = await build(fakeAdapter(), catalogMemoryRepository()).listDepartments(q);
    assert.equal(meta.complete, true);
    assert.equal(meta.derivation, 'PRODUCTS_ENDPOINT');
    assert.equal(meta.cacheFreshness, 'fresh');
    assert.deepEqual(meta.incompleteReasons, []);
    assert.equal(meta.departmentCount, 2);
    assert.equal(meta.productCount, 4);
    assert.equal(meta.unmappedProductCount, 1);
  });

  it('pages departments with a stable order and no overlap', async () => {
    const service = build(fakeAdapter(), catalogMemoryRepository());
    const all = (await service.listDepartments(q)).items.map((d) => d.id);
    assert.deepEqual(all, ['FX-DEPT-1', 'FX-DEPT-2']);
    const p1 = await service.listDepartments({ limit: 1, offset: 0 });
    const p2 = await service.listDepartments({ limit: 1, offset: 1 });
    const p3 = await service.listDepartments({ limit: 1, offset: 2 });
    assert.deepEqual(
      [...p1.items, ...p2.items].map((d) => d.id),
      all,
    );
    assert.equal(p1.meta.total, 2);
    assert.equal(p3.items.length, 0);
  });

  it('lists the products of a department, including products shared with another department', async () => {
    const service = build(fakeAdapter(), catalogMemoryRepository());
    const d1 = await service.listDepartmentProducts({ departmentId: 'FX-DEPT-1', ...q });
    assert.deepEqual(
      d1.items.map((p) => p.id),
      ['FX-PROD-1'],
    );
    assert.equal(d1.meta.department.id, 'FX-DEPT-1');
    const d2 = await service.listDepartmentProducts({ departmentId: 'FX-DEPT-2', ...q });
    assert.deepEqual(
      d2.items.map((p) => p.id),
      ['FX-PROD-2', 'FX-PROD-3'],
    );
    // Unmapped products are in no department's list.
    assert.ok(![...d1.items, ...d2.items].some((p) => p.id === 'FX-PROD-9'));
  });

  it('returns null for an unknown department, even when the catalog is empty', async () => {
    const full = build(fakeAdapter(), catalogMemoryRepository());
    assert.equal(await full.listDepartmentProducts({ departmentId: 'nope', ...q }), null);
    const empty = build(fakeAdapter([]), catalogMemoryRepository());
    assert.equal(await empty.listDepartmentProducts({ departmentId: 'FX-DEPT-1', ...q }), null);
  });

  it('serves an empty catalog as an empty (but complete) list', async () => {
    const service = build(fakeAdapter([]), catalogMemoryRepository());
    const { items, meta } = await service.listDepartments(q);
    assert.deepEqual(items, []);
    assert.equal(meta.total, 0);
    assert.equal(meta.complete, true);
    assert.deepEqual((await service.listUnmappedProducts(q)).items, []);
  });

  it('makes unmapped products visible', async () => {
    const { items, meta } = await build(
      fakeAdapter(),
      catalogMemoryRepository(),
    ).listUnmappedProducts(q);
    assert.deepEqual(
      items.map((p) => p.id),
      ['FX-PROD-9'],
    );
    assert.equal(items[0].mapped, false);
    assert.equal(meta.unmappedProductCount, 1);
  });

  it('serves expired stored data without calling GAAP, labelled expired', async () => {
    const adapter = fakeAdapter();
    const service = build(adapter, catalogMemoryRepository({ ttlMs: -1000 }));
    await service.listDepartments(q);
    const again = await service.listDepartments(q);
    assert.equal(again.meta.origin, 'database');
    assert.equal(again.meta.expired, true);
    assert.equal(adapter.calls, 1);
  });

  it('merges concurrent first reads into one GAAP fetch', async () => {
    const adapter = fakeAdapter(MIXED_PRODUCTS, { delayMs: 20 });
    const service = build(adapter, catalogMemoryRepository());
    await Promise.all([service.listDepartments(q), service.listUnmappedProducts(q)]);
    assert.equal(adapter.calls, 1);
  });

  it('refresh calls GAAP and replaces the stored catalog', async () => {
    const adapter = fakeAdapter();
    const repo = catalogMemoryRepository();
    const service = build(adapter, repo);
    await service.listDepartments(q);
    const refreshed = await service.refreshCatalog(q);
    assert.equal(refreshed.meta.origin, 'gaap');
    assert.equal(adapter.calls, 2);
    assert.equal(repo.state.saves, 2);
  });

  it('keeps the old data when a refresh fails', async () => {
    const repo = catalogMemoryRepository();
    await build(fakeAdapter(), repo).listDepartments(q);
    const before = repo.state.stored;
    const failing = build(
      fakeAdapter([], { fail: new GaapError({ code: GAAP_ERROR_CODES.TIMEOUT, message: 'x' }) }),
      repo,
    );
    await assert.rejects(failing.refreshCatalog(q), { code: GAAP_ERROR_CODES.TIMEOUT });
    assert.equal(repo.state.stored, before);
    assert.equal((await failing.listDepartments(q)).items.length, 2);
  });

  it('returns fetched data flagged persisted:false when saving fails', async () => {
    const service = build(fakeAdapter(), catalogMemoryRepository({ failSave: true }));
    const { items, meta } = await service.listDepartments(q);
    assert.equal(items.length, 2);
    assert.equal(meta.persisted, false);
  });

  it('falls back to GAAP when the stored copy cannot be read', async () => {
    const adapter = fakeAdapter();
    const service = build(adapter, catalogMemoryRepository({ failFind: true }));
    assert.equal((await service.listDepartments(q)).meta.origin, 'gaap');
  });
});
