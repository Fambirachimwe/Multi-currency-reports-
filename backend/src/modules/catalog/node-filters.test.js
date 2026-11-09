/** Pure tests for brand/node filter options and selection expansion. Nodes are FIXTURES. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SelectionError, buildNodeFilterOptions, resolveNodeSelection } from './node-filters.js';

const node = (id, name, parentId, top = false) => ({
  id,
  name,
  parentId,
  sourceNodeId: top ? id : parentId,
  warnings: [],
});

// FIXTURE: two brands (B1 has 2 stores, B2 has 1), one childless top-level node, one unnamed store.
const NODES = [
  node('s3', 'Store C', 'B2'),
  node('B2', 'Brand Two', 'root', true),
  node('s1', 'Store A', 'B1'),
  node('B1', 'Brand One', 'root', true),
  node('s2', 'Store B', 'B1'),
  node('solo', 'Solo Top', 'root', true),
  node('s4', null, 'B2'),
];
const OPTIONS = buildNodeFilterOptions(NODES);

function failure(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  assert.fail('expected a SelectionError');
}

describe('buildNodeFilterOptions', () => {
  it('lists brands and nodes sorted by name, brands excluded from nodes', () => {
    assert.deepEqual(
      OPTIONS.brands.map((b) => b.id),
      ['B1', 'B2'],
    );
    assert.deepEqual(
      OPTIONS.nodes.map((n) => n.id),
      ['solo', 's1', 's2', 's3', 's4'], // Solo Top, Store A, Store B, Store C, Unnamed node
    );
    assert.ok(!OPTIONS.nodes.some((n) => ['B1', 'B2'].includes(n.id)));
  });

  it('gives each brand its exact node ids and leaves the childless top node ungrouped', () => {
    assert.deepEqual(OPTIONS.brands[0].nodeIds, ['s1', 's2']);
    assert.deepEqual(OPTIONS.brands[1].nodeIds, ['s3', 's4']);
    assert.equal(OPTIONS.nodes.find((n) => n.id === 'solo').brandId, null);
  });

  it('is independent of input order and names unnamed nodes', () => {
    assert.deepEqual(buildNodeFilterOptions([...NODES].reverse()), OPTIONS);
    assert.match(OPTIONS.nodes.find((n) => n.id === 's4').name, /^Unnamed node/);
  });

  it('handles zero nodes', () => {
    assert.deepEqual(buildNodeFilterOptions([]), { brands: [], nodes: [] });
  });
});

describe('resolveNodeSelection', () => {
  it('all mode returns every selectable node once, sorted by id', () => {
    const result = resolveNodeSelection(OPTIONS, { mode: 'all' });
    assert.deepEqual(result.nodeIds, ['s1', 's2', 's3', 's4', 'solo']);
    assert.deepEqual(result.brandIds, []);
  });

  it('brand mode expands to the exact nodes of the brand', () => {
    assert.deepEqual(resolveNodeSelection(OPTIONS, { mode: 'brands', brandIds: ['B1'] }).nodeIds, [
      's1',
      's2',
    ]);
  });

  it('multiple brands: no duplicates, deterministic regardless of order or repeats', () => {
    const a = resolveNodeSelection(OPTIONS, { mode: 'brands', brandIds: ['B2', 'B1', 'B2'] });
    const b = resolveNodeSelection(OPTIONS, { mode: 'brands', brandIds: ['B1', 'B2'] });
    assert.deepEqual(a, b);
    assert.deepEqual(a.nodeIds, ['s1', 's2', 's3', 's4']);
    assert.deepEqual(a.brandIds, ['B1', 'B2']);
  });

  it('a node listed under two brands (e.g. a future configured mapping) is returned once', () => {
    const shared = {
      nodes: [
        { id: 'n1', name: 'N1', brandId: 'X' },
        { id: 'n2', name: 'N2', brandId: 'Y' },
      ],
      brands: [
        { id: 'X', name: 'X', nodeIds: ['n1', 'n2'] },
        { id: 'Y', name: 'Y', nodeIds: ['n2'] },
      ],
    };
    const result = resolveNodeSelection(shared, { mode: 'brands', brandIds: ['X', 'Y'] });
    assert.deepEqual(result.nodeIds, ['n1', 'n2']);
  });

  it('node mode removes duplicates and sorts', () => {
    const result = resolveNodeSelection(OPTIONS, { mode: 'nodes', nodeIds: ['s2', 's1', 's2'] });
    assert.deepEqual(result.nodeIds, ['s1', 's2']);
  });

  it('a brand selection of a childless top node or unknown brand is rejected as stale', () => {
    const error = failure(() =>
      resolveNodeSelection(OPTIONS, { mode: 'brands', brandIds: ['solo', 'B1'] }),
    );
    assert.ok(error instanceof SelectionError);
    assert.equal(error.code, 'UNKNOWN_BRAND');
    assert.deepEqual(error.unknownIds, ['solo']);
  });

  it('stale node mapping: unknown node ids are reported, never dropped', () => {
    const error = failure(() =>
      resolveNodeSelection(OPTIONS, { mode: 'nodes', nodeIds: ['s1', 'gone-2', 'gone-1'] }),
    );
    assert.equal(error.code, 'UNKNOWN_NODE');
    assert.deepEqual(error.unknownIds, ['gone-1', 'gone-2']);
  });

  it('a brand id is not accepted as a node id', () => {
    assert.equal(
      failure(() => resolveNodeSelection(OPTIONS, { mode: 'nodes', nodeIds: ['B1'] })).code,
      'UNKNOWN_NODE',
    );
  });

  it('zero nodes: all mode and empty selections fail with NO_NODES', () => {
    const empty = buildNodeFilterOptions([]);
    assert.equal(failure(() => resolveNodeSelection(empty, { mode: 'all' })).code, 'NO_NODES');
    assert.equal(
      failure(() => resolveNodeSelection(OPTIONS, { mode: 'nodes', nodeIds: [] })).code,
      'NO_NODES',
    );
  });

  it('unknown mode is rejected', () => {
    assert.equal(
      failure(() => resolveNodeSelection(OPTIONS, { mode: 'some' })).code,
      'INVALID_MODE',
    );
  });
});
