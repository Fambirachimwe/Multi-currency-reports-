/** Catalog adapter tests with a FIXTURE client. No network; not live GAAP evidence. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATALOG_WARNINGS,
  INCOMPLETE_REASONS,
  MALFORMED_REASONS,
  createCatalogAdapter,
  normalizeCatalog,
} from './catalog.adapter.js';
import { MIXED_PRODUCTS, dept, fixturePage, fixtureProduct } from './fixtures/catalog.fixture.js';

const byId = (list, id) => list.find((item) => item.id === id);

describe('normalizeCatalog', () => {
  it('returns empty lists for an empty catalog', () => {
    assert.deepEqual(normalizeCatalog([]), {
      departments: [],
      products: [],
      malformed: [],
      excludedInactive: 0,
    });
  });

  it('maps POS departments (id = departmentInGroup) with their group and counts distinct products', () => {
    const { departments } = normalizeCatalog(MIXED_PRODUCTS);
    assert.deepEqual(
      departments.map((d) => [d.id, d.name, d.groupId, d.groupName, d.productCount]),
      [
        ['FX-DEPT-1', 'Department A', 'FX-GROUP-1', 'POS Department', 1],
        ['FX-DEPT-2', 'Department B', 'FX-GROUP-1', 'POS Department', 2],
      ],
    );
  });

  it('maps products to every department they list, sorted, with stable ids', () => {
    const { products } = normalizeCatalog(MIXED_PRODUCTS);
    assert.deepEqual(
      products.map((p) => p.id),
      ['FX-PROD-1', 'FX-PROD-2', 'FX-PROD-3', 'FX-PROD-9'],
    );
    assert.deepEqual(byId(products, 'FX-PROD-3').departmentIds, ['FX-DEPT-2']);
    assert.equal(byId(products, 'FX-PROD-1').code, 'CODE-1');
    assert.equal(byId(products, 'FX-PROD-1').mapped, true);
  });

  it('flags a product with no valid department instead of guessing one', () => {
    const { products } = normalizeCatalog(MIXED_PRODUCTS);
    const unmapped = byId(products, 'FX-PROD-9');
    assert.equal(unmapped.mapped, false);
    assert.deepEqual(unmapped.departmentIds, []);
    assert.deepEqual(unmapped.warnings, [CATALOG_WARNINGS.UNMAPPED_DEPARTMENT]);
  });

  it('treats missing, non-array and unusable department entries as unmapped', () => {
    const { products } = normalizeCatalog([
      fixtureProduct(1, undefined),
      fixtureProduct(2, 'not-an-array'),
      fixtureProduct(3, [null, 'x', { departmentInGroup: '  ' }, { departmentInGroup: 7 }]),
    ]);
    for (const p of products) {
      assert.equal(p.mapped, false);
      assert.ok(p.warnings.includes(CATALOG_WARNINGS.UNMAPPED_DEPARTMENT));
    }
    assert.ok(
      byId(products, 'FX-PROD-3').warnings.includes(CATALOG_WARNINGS.INVALID_DEPARTMENT_ENTRY),
    );
  });

  it('keeps a product mapped when only some entries are unusable, and dedupes repeats', () => {
    const { products, departments } = normalizeCatalog([
      fixtureProduct(1, [dept(1), dept(1), null]),
    ]);
    assert.deepEqual(products[0].departmentIds, ['FX-DEPT-1']);
    assert.equal(products[0].mapped, true);
    assert.deepEqual(products[0].warnings, [CATALOG_WARNINGS.INVALID_DEPARTMENT_ENTRY]);
    assert.equal(departments[0].productCount, 1);
  });

  it('reports a duplicate product _id once, keeping the first record', () => {
    const { products, malformed, departments } = normalizeCatalog([
      fixtureProduct(1, [dept(1)], { name: 'First' }),
      fixtureProduct(1, [dept(2)], { name: 'Second' }),
    ]);
    assert.equal(products.length, 1);
    assert.equal(products[0].name, 'First');
    assert.deepEqual(malformed, [
      { index: 1, reason: MALFORMED_REASONS.DUPLICATE_ID, id: 'FX-PROD-1' },
    ]);
    assert.deepEqual(
      departments.map((d) => d.id),
      ['FX-DEPT-1'],
      'the duplicate record contributes nothing',
    );
  });

  it('warns when a department is seen with two names or two groups', () => {
    const renamed = { ...dept(1), departmentInGroupName: 'Renamed', departmentGroup: 'FX-GROUP-7' };
    const { departments } = normalizeCatalog([
      fixtureProduct(1, [dept(1)]),
      fixtureProduct(2, [renamed]),
    ]);
    assert.equal(departments.length, 1);
    assert.deepEqual(departments[0].warnings.sort(), [
      CATALOG_WARNINGS.GROUP_CONFLICT,
      CATALOG_WARNINGS.NAME_CONFLICT,
    ]);
    assert.equal(departments[0].name, 'Department A', 'alphabetically first is kept');
    assert.equal(departments[0].groupId, 'FX-GROUP-1');
  });

  it('excludes inactive and deleted products and counts them', () => {
    const { products, departments, excludedInactive } = normalizeCatalog([
      fixtureProduct(1, [dept(1)]),
      fixtureProduct(2, [dept(2)], { status: false }),
      fixtureProduct(3, [dept(3)], { isDeleted: true }),
      fixtureProduct(4, [dept(4)], { status: 'true' }),
      fixtureProduct(5, [dept(5)], { status: undefined }),
    ]);
    assert.deepEqual(
      products.map((p) => p.id),
      ['FX-PROD-1'],
    );
    assert.equal(excludedInactive, 4);
    assert.deepEqual(
      departments.map((d) => d.id),
      ['FX-DEPT-1'],
      'departments seen only on excluded products do not appear',
    );
  });

  it('does not count an excluded product as a duplicate or let it hide a later one', () => {
    const { products, malformed } = normalizeCatalog([
      fixtureProduct(1, [dept(1)], { status: false }),
      fixtureProduct(1, [dept(1)]),
    ]);
    assert.equal(products.length, 0);
    assert.deepEqual(
      malformed.map((m) => m.reason),
      [MALFORMED_REASONS.DUPLICATE_ID],
    );
  });

  it('uses only POS Department entries and ignores other groups', () => {
    const { products, departments } = normalizeCatalog([
      fixtureProduct(1, [dept(1, 2), dept(5, 2)]),
      fixtureProduct(2, [dept(2), dept(5, 2)]),
    ]);
    assert.deepEqual(
      departments.map((d) => d.id),
      ['FX-DEPT-2'],
    );
    const reportingOnly = byId(products, 'FX-PROD-1');
    assert.equal(reportingOnly.mapped, false);
    assert.deepEqual(reportingOnly.warnings, [CATALOG_WARNINGS.UNMAPPED_DEPARTMENT]);
    assert.deepEqual(byId(products, 'FX-PROD-2').departmentIds, ['FX-DEPT-2']);
  });

  it('matches the group name case-insensitively and supports another group name', () => {
    const lower = { ...dept(1), departmentGroupName: '  pos department ' };
    assert.equal(normalizeCatalog([fixtureProduct(1, [lower])]).departments.length, 1);
    const reporting = normalizeCatalog([fixtureProduct(1, [dept(1), dept(5, 2)])], {
      departmentGroup: 'Reporting',
    });
    assert.deepEqual(
      reporting.departments.map((d) => d.id),
      ['FX-DEPT-5'],
    );
  });

  it('flags an entry with no group name as invalid rather than guessing its group', () => {
    const noGroup = { ...dept(1), departmentGroupName: undefined };
    const { products } = normalizeCatalog([fixtureProduct(1, [noGroup])]);
    assert.equal(products[0].mapped, false);
    assert.ok(products[0].warnings.includes(CATALOG_WARNINGS.INVALID_DEPARTMENT_ENTRY));
  });

  it('sorts by name (natural, case-insensitive), unnamed last, then id', () => {
    const named = (n, name) => fixtureProduct(n, [dept(1)], { name });
    const { products } = normalizeCatalog([
      named(1, 'item 10'),
      named(2, 'Item 2'),
      named(4, 'banana'),
      named(3, 'Same'),
      named(5, 'Same'),
      named(6, undefined),
      named(7, '   '),
    ]);
    assert.deepEqual(
      products.map((p) => p.id),
      ['FX-PROD-4', 'FX-PROD-2', 'FX-PROD-1', 'FX-PROD-3', 'FX-PROD-5', 'FX-PROD-6', 'FX-PROD-7'],
    );
    assert.ok(byId(products, 'FX-PROD-6').warnings.includes(CATALOG_WARNINGS.MISSING_NAME));
  });

  it('gives identical output for reordered input', () => {
    assert.deepEqual(
      normalizeCatalog(MIXED_PRODUCTS),
      normalizeCatalog([...MIXED_PRODUCTS].reverse()),
    );
  });

  it('reports malformed records without echoing payloads', () => {
    const { products, malformed } = normalizeCatalog([
      null,
      'text',
      [],
      { name: 'secret-looking name' },
      { _id: '   ', name: 'blank id' },
      fixtureProduct(1, [dept(1)]),
    ]);
    assert.equal(products.length, 1);
    assert.deepEqual(
      malformed.map((m) => m.reason),
      [
        MALFORMED_REASONS.NOT_AN_OBJECT,
        MALFORMED_REASONS.NOT_AN_OBJECT,
        MALFORMED_REASONS.NOT_AN_OBJECT,
        MALFORMED_REASONS.MISSING_ID,
        MALFORMED_REASONS.MISSING_ID,
      ],
    );
    assert.ok(!JSON.stringify(malformed).includes('secret-looking'));
  });

  it('keeps only whitelisted fields (no pricing, recipes or tags)', () => {
    const { products, departments } = normalizeCatalog(MIXED_PRODUCTS);
    assert.deepEqual(Object.keys(products[0]).sort(), [
      'code',
      'departmentIds',
      'id',
      'mapped',
      'name',
      'warnings',
    ]);
    assert.deepEqual(Object.keys(departments[0]).sort(), [
      'groupId',
      'groupName',
      'id',
      'name',
      'productCount',
      'warnings',
    ]);
    const text = JSON.stringify({ products, departments });
    assert.ok(!text.includes('FX-INGREDIENT') && !text.includes('hqCost'));
  });
});

describe('createCatalogAdapter.fetchCatalog (FIXTURE client)', () => {
  const now = () => new Date('2026-11-07T15:30:00.000Z');

  function clientReturning(pages) {
    const calls = [];
    return {
      calls,
      async get(path, params, options) {
        calls.push({ path, params: { ...params }, options });
        return { data: pages[Math.min(calls.length - 1, pages.length - 1)] };
      },
    };
  }

  it('requests /products with paging only and reports a complete catalog', async () => {
    const client = clientReturning([fixturePage(MIXED_PRODUCTS)]);
    const adapter = createCatalogAdapter({ client, pageSize: 10, now });
    const result = await adapter.fetchCatalog({ requestId: 'req-1' });

    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].path, '/products');
    assert.deepEqual(client.calls[0].params, { limit: 10, skip: 0 });
    assert.equal(client.calls[0].options.requestId, 'req-1');
    assert.equal(result.complete, true);
    assert.deepEqual(result.incompleteReasons, []);
    assert.deepEqual(result.scan, {
      source: 'products',
      departmentGroup: 'POS Department',
      pages: 1,
      recordsScanned: 4,
      excludedInactive: 0,
      truncated: false,
    });
    assert.equal(result.fetchedAt, '2026-11-07T15:30:00.000Z');
    assert.equal(result.products.length, 4);
  });

  it('pages until a short page, ignoring totalRecords', async () => {
    const p = (n) => fixtureProduct(n, [dept(1)]);
    const client = clientReturning([
      { totalRecords: 2, data: [p(1), p(2)] },
      { totalRecords: 2, data: [p(3), p(1)] },
      { totalRecords: 1, data: [p(4)] },
    ]);
    const result = await createCatalogAdapter({ client, pageSize: 2, now }).fetchCatalog();

    assert.deepEqual(
      client.calls.map((c) => c.params.skip),
      [0, 2, 4],
    );
    assert.equal(result.scan.recordsScanned, 5);
    assert.equal(result.products.length, 4, 'a product repeated across pages appears once');
    assert.equal(result.malformed.length, 1);
    assert.equal(result.complete, true);
  });

  it('stops at the page cap and labels the catalog incomplete', async () => {
    const full = { data: [fixtureProduct(1, [dept(1)]), fixtureProduct(2, [dept(1)])] };
    const client = clientReturning([full]);
    const result = await createCatalogAdapter({
      client,
      pageSize: 2,
      maxPages: 3,
      now,
    }).fetchCatalog();

    assert.equal(client.calls.length, 3);
    assert.equal(result.scan.truncated, true);
    assert.equal(result.complete, false);
    assert.deepEqual(result.incompleteReasons, [INCOMPLETE_REASONS.PAGE_CAP_REACHED]);
  });

  it('returns an empty but complete catalog when GAAP has no products', async () => {
    const adapter = createCatalogAdapter({ client: clientReturning([fixturePage([])]), now });
    const result = await adapter.fetchCatalog();
    assert.deepEqual(result.departments, []);
    assert.deepEqual(result.products, []);
    assert.equal(result.complete, true);
  });

  it('rejects a response without a data array', async () => {
    for (const body of [{}, { data: {} }, null, [], 'x']) {
      const adapter = createCatalogAdapter({ client: clientReturning([body]), now });
      await assert.rejects(adapter.fetchCatalog(), { code: 'GAAP_INVALID_RESPONSE' });
    }
  });
});
