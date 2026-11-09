import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  groupDepartments,
  isValidDate,
  nodeSelectionBody,
  validateFilters,
  withDepartment,
  withoutProducts,
} from '@/features/reports/filters';

const valid = {
  departmentId: 'FX-DEPT',
  productIds: ['FX-PROD-1'],
  nodeMode: 'nodes',
  brandIds: [],
  nodeIds: ['DEMO-NODE-01'],
  startDate: '20261001',
  endDate: '20261031',
};

describe('report filters', () => {
  it('browsing a department keeps the whole product selection', () => {
    const selected = { ...valid, productIds: ['P1', 'P2'] };
    const next = withDepartment(selected, 'OTHER-DEPT');
    expect(next.departmentId).toBe('OTHER-DEPT');
    expect(next.productIds).toEqual(['P1', 'P2']);
  });

  it('groups departments under their group, keeping order', () => {
    const d = (id, groupId, groupName) => ({ id, groupId, groupName });
    const groups = groupDepartments([
      d('a', 'g1', 'POS'),
      d('b', 'g2', 'Other'),
      d('c', 'g1', 'POS'),
    ]);
    expect(groups.map((g) => [g.name, g.departments.map((x) => x.id)])).toEqual([
      ['POS', ['a', 'c']],
      ['Other', ['b']],
    ]);
    expect(groupDepartments([])).toEqual([]);
  });

  it('removes only the named products from the selection', () => {
    const next = withoutProducts({ ...valid, productIds: ['P1', 'P2', 'P3'] }, ['P2', 'NOT-THERE']);
    expect(next.productIds).toEqual(['P1', 'P3']);
    expect(withoutProducts(valid, [])).toEqual(valid);
  });

  it('sends only the active mode ids to the backend', () => {
    const f = { ...valid, brandIds: ['B1'], nodeIds: ['N1'] };
    expect(nodeSelectionBody({ ...f, nodeMode: 'all' })).toEqual({ mode: 'all' });
    expect(nodeSelectionBody({ ...f, nodeMode: 'brands' })).toEqual({
      mode: 'brands',
      brandIds: ['B1'],
    });
    expect(nodeSelectionBody({ ...f, nodeMode: 'nodes' })).toEqual({
      mode: 'nodes',
      nodeIds: ['N1'],
    });
  });

  it('validates the node filter per mode; All nodes needs no ids', () => {
    expect(validateFilters({ ...valid, nodeMode: 'all', nodeIds: [] })).toEqual({});
    expect(validateFilters({ ...valid, nodeMode: 'brands', brandIds: [] })).toEqual({
      nodeIds: 'Select at least one brand.',
    });
    expect(
      validateFilters({ ...valid, nodeMode: 'brands', brandIds: ['B1'], nodeIds: [] }),
    ).toEqual({});
    expect(validateFilters({ ...valid, nodeMode: 'nodes', nodeIds: [] })).toEqual({
      nodeIds: 'Select at least one node.',
    });
  });

  it('needs products, not a browsed department, and rejects an empty product selection', () => {
    expect(validateFilters({ ...valid, departmentId: '' })).toEqual({});
    expect(validateFilters({ ...valid, productIds: [] })).toEqual({
      productIds: 'Select at least one product.',
    });
  });

  it('accepts a complete valid filter set', () => {
    expect(validateFilters(valid)).toEqual({});
  });

  it('flags every missing field on empty filters', () => {
    expect(Object.keys(validateFilters(EMPTY_FILTERS)).sort()).toEqual([
      'endDate',
      'nodeIds',
      'productIds',
      'startDate',
    ]);
  });

  it('rejects an end date before the start date', () => {
    expect(validateFilters({ ...valid, startDate: '20261101', endDate: '20261001' })).toEqual({
      endDate: 'End date must be on or after the start date.',
    });
  });

  it('allows a single-day range', () => {
    expect(validateFilters({ ...valid, startDate: '20261005', endDate: '20261005' })).toEqual({});
  });

  it.each(['', '20260230', '20261301', '10/01/2026', 'abc'])('rejects date %j', (value) => {
    expect(isValidDate(value)).toBe(false);
  });
});
