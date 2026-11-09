import { describe, expect, it } from 'vitest';
import { buildNodeCatalog, displayName, focusChickenInn } from '@/features/reports/nodes-catalog';

const node = (id, over = {}) => ({
  id,
  name: `N-${id}`,
  parentId: null,
  sourceNodeId: null,
  warnings: [],
  ...over,
});
const root = (id) => node(id, { sourceNodeId: id, parentId: 'ADMIN' });
const child = (id, parent) => node(id, { sourceNodeId: parent, parentId: parent });

describe('buildNodeCatalog', () => {
  it('treats top-level nodes with children as brands and their children as nodes', () => {
    const { brands, nodes } = buildNodeCatalog([
      root('R1'),
      root('R2'),
      child('a', 'R1'),
      child('b', 'R2'),
      child('c', 'R1'),
    ]);
    expect(brands.map((b) => b.id)).toEqual(['R1', 'R2']);
    expect(nodes.map((n) => [n.id, n.brandId])).toEqual([
      ['a', 'R1'],
      ['b', 'R2'],
      ['c', 'R1'],
    ]);
  });

  it('keeps a top-level node without children as a selectable node, not a brand', () => {
    const { brands, nodes } = buildNodeCatalog([root('R1'), root('LONE'), child('a', 'R1')]);
    expect(brands.map((b) => b.id)).toEqual(['R1']);
    expect(nodes.find((n) => n.id === 'LONE')).toEqual({ id: 'LONE', name: 'N-LONE', brandId: '' });
  });

  it('does not invent a brand for nodes whose parent is not a known top-level node', () => {
    const { brands, nodes } = buildNodeCatalog([child('a', 'MISSING'), node('b')]);
    expect(brands).toEqual([]);
    expect(nodes.map((n) => n.brandId)).toEqual(['', '']);
  });

  it('returns empty lists for no nodes', () => {
    expect(buildNodeCatalog([])).toEqual({ brands: [], nodes: [] });
  });

  it('labels unnamed nodes without inventing a name', () => {
    expect(displayName(node('abcdef123456', { name: null }))).toBe('Unnamed node (123456)');
  });
});

describe('focusChickenInn', () => {
  it('keeps only Chicken Inn brands and their nodes, plus nodes named Chicken Inn', () => {
    const result = focusChickenInn({
      brands: [
        { id: 'B1', name: 'Simbisa Zimbabwe Chicken Inn' },
        { id: 'B2', name: 'Simbisa Zimbabwe Nandos' },
      ],
      nodes: [
        { id: 'a', name: 'Borrowdale', brandId: 'B1' },
        { id: 'b', name: 'Harare CBD', brandId: 'B2' },
        { id: 'c', name: 'SIMBISA AMC - CHICKEN INN', brandId: '' },
      ],
    });
    expect(result.brands.map((b) => b.id)).toEqual(['B1']);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c']);
  });
});
