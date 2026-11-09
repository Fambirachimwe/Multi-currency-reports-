import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes/routes';

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const main = () => screen.getByRole('main');

// FIXTURE: invented nodes in the backend's normalized shape (not live GAAP data).
const apiNode = (id, name, parentId, sourceNodeId) => ({
  id,
  name,
  parentId,
  sourceNodeId,
  sourceStatus: '1',
  warnings: [],
});
const NODES_FIXTURE = [
  apiNode('G1', 'Chicken Inn One', 'ADMIN', 'G1'),
  apiNode('G2', 'Chicken Inn Two', 'ADMIN', 'G2'),
  apiNode('S1', 'Harare CBD', 'G1', 'G1'),
  apiNode('S2', 'Borrowdale', 'G2', 'G2'),
];
const nodesResponse = (body = { data: NODES_FIXTURE, meta: { complete: true } }, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

// FIXTURE: invented saved report in the backend's detail shape (not real data).
const REPORT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const baseDetail = (overrides = {}) => ({
  reportId: REPORT_ID,
  status: 'completed',
  filters: {
    startDate: '20261101',
    endDate: '20261107',
    departmentIds: [],
    productIds: ['p1', 'p2'],
    brandIds: [],
    nodeIds: ['n1', 'n2'],
    currencies: [],
  },
  rowCount: 5,
  calculationVersion: 'v-test',
  provenance: {
    source: 'GAAP_UNITY',
    sourceStartedAt: '2026-11-08T09:58:00.000Z',
    fetchedAt: '2026-11-08T09:59:00.000Z',
    usedCache: false,
    cacheFreshness: 'not_applicable',
    complete: true,
  },
  error: null,
  startedAt: '2026-11-08T09:57:00.000Z',
  completedAt: '2026-11-08T10:00:00.000Z',
  failedAt: null,
  ...overrides,
});
const group = (currency, id, name, lineCount, quantity, turnover) => ({
  currency,
  id,
  name,
  lineCount,
  quantity,
  turnover,
});
const detailCompleted = () =>
  baseDetail({
    totals: [
      { currency: 'USD', lineCount: 3, quantity: '3', turnover: '5.1' },
      { currency: 'ZWG', lineCount: 1, quantity: '4', turnover: '100' },
      { currency: 'UNKNOWN', lineCount: 1, quantity: '1', turnover: '7' },
    ],
    summary: {
      rowCount: 5,
      products: [
        group('USD', 'p1', 'Product One', 3, '3', '5.1'),
        group('ZWG', 'p1', 'Product One', 1, '4', '100'),
        group('UNKNOWN', 'p1', 'Product One', 1, '1', '7'),
      ],
      nodes: [
        group('USD', 'n1', 'Store One', 3, '3', '5.1'),
        group('ZWG', 'n1', 'Store One', 1, '4', '100'),
        group('UNKNOWN', 'n1', 'Store One', 1, '1', '7'),
      ],
      warnings: [{ code: 'CURRENCY_UNKNOWN', rowCount: 1 }],
    },
  });
const detailPending = () =>
  baseDetail({
    status: 'pending',
    completedAt: null,
    rowCount: null,
    provenance: { complete: false },
  });
const detailFailed = () =>
  baseDetail({
    status: 'failed',
    completedAt: null,
    failedAt: '2026-11-08T10:05:00.000Z',
    rowCount: null,
    error: { code: 'GAAP_UNAVAILABLE', message: 'GAAP could not be reached.' },
  });

// FIXTURE: invented saved lines (not real data) that add up to `detailCompleted().totals`.
const line = (lineIndex, o) => ({
  lineIndex,
  sourceLineKey: `s${lineIndex}/l1`,
  transactionAt: '2026-11-05T08:00:00.000Z',
  nodeId: 'n1',
  nodeName: 'Store One',
  productId: 'p1',
  productName: 'Product One',
  warnings: [],
  ...o,
});
const ROWS_FIXTURE = [
  line(0, { currency: 'USD', quantity: '1', turnover: '2.5' }),
  line(1, { currency: 'USD', quantity: '1', turnover: '0.1' }),
  line(2, {
    currency: 'USD',
    quantity: '1',
    turnover: '2.5',
    nodeId: 'n2',
    nodeName: 'Store Two',
    productId: 'p2',
    productName: 'Product Two',
  }),
  line(3, { currency: 'ZWG', quantity: '4', turnover: '100' }),
  line(4, { currency: 'UNKNOWN', quantity: '1', turnover: '7', warnings: ['CURRENCY_UNKNOWN'] }),
];

/**
 * FIXTURE stand-in for `GET /reports/:id/rows`: filters, sorts and pages like the real endpoint's
 * contract (it is NOT the backend). Records the request URLs it answers.
 */
function fakeRowsEndpoint(all = ROWS_FIXTURE) {
  const requests = [];
  const respond = (url) => {
    requests.push(url);
    const query = new URL(url, 'http://localhost').searchParams;
    const search = (query.get('search') ?? '').toLowerCase();
    const matching = all.filter(
      (row) =>
        (query.get('currency') === null || row.currency === query.get('currency')) &&
        (search === '' ||
          [row.productName, row.nodeName, row.productId, row.nodeId].some((text) =>
            text.toLowerCase().includes(search),
          )),
    );
    const sort = query.get('sort');
    const direction = query.get('order') === 'desc' ? -1 : 1;
    const value = (row) =>
      ['quantity', 'turnover'].includes(sort) ? Number(row[sort]) : row[sort];
    const sorted = [...matching].sort(
      (a, b) =>
        direction * (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) ||
        direction * (a.lineIndex - b.lineIndex),
    );
    const limit = Number(query.get('limit'));
    const offset = Number(query.get('offset'));
    const rows = sorted.slice(offset, offset + limit);
    const sums = new Map();
    for (const row of matching) {
      const entry = sums.get(row.currency) ?? { lineCount: 0, quantity: 0, turnover: 0 };
      entry.lineCount += 1;
      entry.quantity += Number(row.quantity);
      entry.turnover += Number(row.turnover);
      sums.set(row.currency, entry);
    }
    return {
      data: rows,
      meta: {
        pagination: {
          total: matching.length,
          limit,
          offset,
          returned: rows.length,
          hasMore: offset + rows.length < matching.length,
        },
        totals: [...sums].map(([currency, e]) => ({
          currency,
          lineCount: e.lineCount,
          quantity: String(e.quantity),
          turnover: String(Math.round(e.turnover * 100) / 100),
        })),
      },
    };
  };
  return { respond, requests };
}

/** Stubs fetch for the report detail endpoint; returns the list of requested URLs. */
function stubReportDetail(report, status = 200, rowsEndpoint = fakeRowsEndpoint()) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      calls.push(url);
      if (url.includes('/rows')) {
        const answer = rowsEndpoint.respond(url);
        // A custom endpoint can answer `{ status, body }` to simulate a failure.
        return nodesResponse(answer.body ?? answer, answer.status ?? 200);
      }
      if (status === 404) {
        return nodesResponse({ error: { code: 'REPORT_NOT_FOUND', message: 'No report.' } }, 404);
      }
      if (status !== 200) {
        return nodesResponse({ error: { code: 'INTERNAL_ERROR', message: 'Boom.' } }, status);
      }
      return nodesResponse({ data: report, meta: {} });
    }),
  );
  return calls;
}

// FIXTURE: the backend's brand/node filter options for the same invented nodes.
const FILTERS_FIXTURE = {
  data: {
    brands: [
      { id: 'G1', name: 'Chicken Inn One', nodeIds: ['S1'] },
      { id: 'G2', name: 'Chicken Inn Two', nodeIds: ['S2'] },
    ],
    nodes: [
      { id: 'S2', name: 'Borrowdale', brandId: 'G2' },
      { id: 'S1', name: 'Harare CBD', brandId: 'G1' },
    ],
  },
  meta: { complete: true },
};

// FIXTURE stand-in for the backend's resolve endpoint (mirrors its documented expansion).
function resolveFixture(init) {
  const body = JSON.parse(init.body);
  const { brands, nodes } = FILTERS_FIXTURE.data;
  const ids =
    body.mode === 'all'
      ? nodes.map((n) => n.id)
      : body.mode === 'brands'
        ? brands.filter((br) => body.brandIds.includes(br.id)).flatMap((br) => br.nodeIds)
        : body.nodeIds;
  return nodesResponse({
    data: { mode: body.mode, brandIds: [], nodeIds: [...new Set(ids)].sort() },
    meta: {},
  });
}

// FIXTURE: the backend's catalog departments and products (invented; not live GAAP data).
const dept = (id, name, productCount) => ({
  id,
  name,
  groupId: 'G-POS',
  groupName: 'POS Department',
  productCount,
  warnings: [],
});
const prod = (id, name, departmentIds) => ({
  id,
  name,
  code: null,
  departmentIds,
  mapped: true,
  warnings: [],
});
const CATALOG_FIXTURE = {
  departments: [dept('D1', 'Chicken', 3), dept('D2', 'Drinks', 2)],
  products: [],
};
const ALL_PRODUCTS = [
  prod('P1', 'Chicken Burger', ['D1']),
  prod('P2', 'Spicy Wings', ['D1']),
  prod('P3', 'Chicken Meal', ['D1']),
  prod('P4', 'Cola', ['D2']),
  prod('P5', 'Water', ['D2']),
];

// FIXTURE stand-in for the backend's catalog endpoints, including product-id validation.
function catalogFixture(url, init) {
  if (url.startsWith('/api/v1/catalog/departments?')) {
    return nodesResponse({ data: CATALOG_FIXTURE.departments, meta: { total: 2 } });
  }
  const match = url.match(/^\/api\/v1\/catalog\/departments\/([^/]+)\/products\?/);
  if (match) {
    const items = CATALOG_FIXTURE.products.filter((x) => x.departmentIds.includes(match[1]));
    return nodesResponse({ data: items, meta: { total: items.length } });
  }
  if (url === '/api/v1/catalog/products/validate') {
    const { productIds } = JSON.parse(init.body);
    const known = new Set(CATALOG_FIXTURE.products.map((x) => x.id));
    const unknownIds = productIds.filter((id) => !known.has(id)).sort();
    return unknownIds.length > 0
      ? nodesResponse(
          {
            error: {
              code: 'UNKNOWN_PRODUCT',
              message: 'A selected product is not in the current product list.',
              details: { unknownIds },
            },
          },
          422,
        )
      : nodesResponse({ data: { productIds: [...new Set(productIds)].sort() }, meta: {} });
  }
  return null;
}

beforeEach(() => {
  CATALOG_FIXTURE.products = [...ALL_PRODUCTS];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url, init) =>
        catalogFixture(url, init) ??
        (url.endsWith('/filters/nodes/resolve')
          ? resolveFixture(init)
          : url.endsWith('/filters/nodes')
            ? nodesResponse(FILTERS_FIXTURE)
            : nodesResponse()),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every fixture-backed page is labelled as demo', () => {
  it.each(['/settings'])('%s', (path) => {
    renderAt(path);
    expect(within(main()).getByText('Demo / mock')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Demo data')).toBeInTheDocument();
  });
});

describe('no misleading controls', () => {
  it('Generate Report is enabled but sends nothing until the selection is valid', async () => {
    renderAt('/reports/new');
    const button = within(main()).getByRole('button', { name: 'Generate Report' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(screen.getAllByText(/Select at least one product/).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalledWith('/api/v1/reports', expect.anything());
  });

  it('Download Excel is enabled on a completed saved report and fetches its export', async () => {
    stubReportDetail(detailCompleted());
    renderAt(`/reports/${REPORT_ID}`);
    const button = await screen.findByRole('button', { name: 'Download Excel' });
    expect(button).toBeEnabled();
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    fetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response('xlsx', {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="report.xlsx"' },
        }),
      ),
    );
    await userEvent.click(button);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(`/api/v1/reports/${REPORT_ID}/export`);
  });

  it('a failed report offers no enabled export', async () => {
    stubReportDetail(detailFailed());
    renderAt(`/reports/${REPORT_ID}`);
    expect(await screen.findByText('This report failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeDisabled();
  });

  it('never shows a success message for report generation', async () => {
    renderAt('/reports/new');
    await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
    expect(
      screen.queryByText(/generated successfully|report created|success/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText('No report generated')).toBeInTheDocument();
  });

  it('settings is read-only: no inputs or enabled buttons in the page', () => {
    renderAt('/settings');
    expect(within(main()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(main()).queryAllByRole('button')).toHaveLength(0);
    expect(main()).not.toHaveTextContent(/api[_ -]?key|https?:\/\//i);
  });
});

describe('Generate Report filters', () => {
  it('departments and products come from the backend catalog, grouped with counts', async () => {
    renderAt('/reports/new');
    const group = await screen.findByRole('radiogroup', { name: 'POS Department' });
    expect(within(group).getByRole('radio', { name: /Chicken/ })).toBeInTheDocument();
    expect(within(group).getByLabelText('3 products')).toBeInTheDocument();
    expect(within(group).getByLabelText('2 products')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/v1/catalog/departments?limit=1000', expect.anything());
    expect(screen.queryByText(/DEMO-/)).not.toBeInTheDocument();
  });

  it('products are unavailable until a department is chosen, then follow the department', async () => {
    renderAt('/reports/new');
    expect(screen.getByRole('searchbox', { name: /search products/i })).toBeDisabled();

    await userEvent.click(await screen.findByRole('radio', { name: /Drinks/ }));
    const list = await screen.findByRole('list', { name: 'products' });
    expect(within(list).getByText('Cola')).toBeInTheDocument();
    expect(within(list).queryByText('Chicken Burger')).not.toBeInTheDocument();
  });

  it('supports search, Select all and Clear in the product multi-select', async () => {
    renderAt('/reports/new');
    await userEvent.click(await screen.findByRole('radio', { name: /Chicken/ }));
    const list = await screen.findByRole('list', { name: 'products' });

    await userEvent.type(screen.getByRole('searchbox', { name: /search products/i }), 'wings');
    expect(within(list).getAllByRole('checkbox')).toHaveLength(1);

    const group = screen.getByRole('group', { name: 'Products' });
    await userEvent.click(within(group).getByRole('button', { name: 'Select all' }));
    expect(within(list).getByRole('checkbox')).toBeChecked();
    expect(within(group).getByText('1 selected · 1 of 3 in this department')).toBeInTheDocument();

    await userEvent.click(within(group).getByRole('button', { name: 'Clear' }));
    expect(within(list).getByRole('checkbox')).not.toBeChecked();
    expect(
      within(group).queryByRole('list', { name: 'Selected products' }),
    ).not.toBeInTheDocument();
  });

  it('selects several products, keeps them when browsing another department, and deselects', async () => {
    renderAt('/reports/new');
    await userEvent.click(await screen.findByRole('radio', { name: /Chicken/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Chicken Burger' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Spicy Wings' }));

    await userEvent.click(screen.getByRole('radio', { name: /Drinks/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Cola' }));

    expect(
      within(screen.getByRole('list', { name: 'Selected products' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Chicken Burger', 'Spicy Wings', 'Cola']);
    expect(await screen.findByText('3 products will be included.')).toBeInTheDocument();

    // back to the first department: the earlier picks are still checked
    await userEvent.click(screen.getByRole('radio', { name: /Chicken/ }));
    expect(await screen.findByRole('checkbox', { name: 'Chicken Burger' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Spicy Wings' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chicken Meal' })).not.toBeChecked();

    // deselect from the list and via the chip remove button
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chicken Burger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cola' }));
    expect(
      within(screen.getByRole('list', { name: 'Selected products' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Spicy Wings']);
    expect(screen.getByRole('checkbox', { name: 'Chicken Burger' })).not.toBeChecked();

    expect(await screen.findByText('1 product will be included.')).toBeInTheDocument();
    const [, init] = fetch.mock.calls
      .filter(([url]) => url === '/api/v1/catalog/products/validate')
      .at(-1);
    expect(JSON.parse(init.body)).toEqual({ productIds: ['P2'] });
  });

  it('flags selected products the backend rejects and removes only those', async () => {
    renderAt('/reports/new');
    await userEvent.click(await screen.findByRole('radio', { name: /Chicken/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Chicken Burger' }));
    // The catalog changes under the user: P1 is no longer a product.
    CATALOG_FIXTURE.products = CATALOG_FIXTURE.products.filter((x) => x.id !== 'P1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Spicy Wings' }));

    expect(
      await screen.findByText(/1 selected product is no longer available/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(
      'Remove the products that are no longer available.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove unavailable products' }));
    expect(
      within(screen.getByRole('list', { name: 'Selected products' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Spicy Wings']);
    expect(await screen.findByText('1 product will be included.')).toBeInTheDocument();
  });

  it('shows an error with retry when departments fail, then recovers', async () => {
    const original = fetch.getMockImplementation();
    let failed = false;
    fetch.mockImplementation((url, init) => {
      if (!failed && url.startsWith('/api/v1/catalog/departments?')) {
        failed = true;
        return nodesResponse(
          { error: { code: 'GAAP_UNAVAILABLE', message: 'GAAP is unavailable.' } },
          503,
        );
      }
      return original(url, init);
    });
    renderAt('/reports/new');
    expect(await screen.findByText('Departments could not be loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: /Chicken/ })).toBeInTheDocument();
  });

  it('brands and nodes come from the backend filter options, not mock data', async () => {
    renderAt('/reports/new');
    expect(await screen.findByRole('checkbox', { name: 'Harare CBD' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/v1/filters/nodes', expect.anything());
    expect(screen.queryByText(/DEMO-|Demo Chicken Brand/)).not.toBeInTheDocument();
  });

  it('starts as a manual selection; All nodes is an explicit choice resolved by the backend', async () => {
    renderAt('/reports/new');
    await screen.findByRole('checkbox', { name: 'Harare CBD' });
    expect(screen.getByRole('radio', { name: 'Selected nodes' })).toBeChecked();
    expect(screen.queryByText(/will be included/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'All nodes' }));
    expect(await screen.findByText('2 nodes will be included.')).toBeInTheDocument();
    const [, init] = fetch.mock.calls.find(([url]) => url.endsWith('/filters/nodes/resolve'));
    expect(JSON.parse(init.body)).toEqual({ mode: 'all' });
  });

  it('brand mode lets several brands be picked and sends only brand ids', async () => {
    renderAt('/reports/new');
    await screen.findByRole('checkbox', { name: 'Harare CBD' });
    await userEvent.click(screen.getByRole('radio', { name: 'By brand' }));
    const list = screen.getByRole('list', { name: 'brands' });
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Chicken Inn One' }));
    expect(await screen.findByText('1 node will be included.')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Chicken Inn Two' }));
    expect(await screen.findByText('2 nodes will be included.')).toBeInTheDocument();
    const bodies = fetch.mock.calls
      .filter(([url]) => url.endsWith('/filters/nodes/resolve'))
      .map(([, init]) => JSON.parse(init.body));
    expect(bodies.at(-1)).toEqual({ mode: 'brands', brandIds: ['G1', 'G2'] });
  });

  it('node mode sends only node ids', async () => {
    renderAt('/reports/new');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Borrowdale' }));
    expect(await screen.findByText('1 node will be included.')).toBeInTheDocument();
    const [, init] = fetch.mock.calls.findLast(([url]) => url.endsWith('/filters/nodes/resolve'));
    expect(JSON.parse(init.body)).toEqual({ mode: 'nodes', nodeIds: ['S2'] });
  });

  it('tells the user when a selection is stale (backend rejects unknown ids)', async () => {
    const stale = {
      error: {
        code: 'UNKNOWN_NODE',
        message: 'A selected node is not in the current node list.',
        requestId: 'req-3',
        details: { unknownIds: ['S2'] },
      },
    };
    fetch.mockImplementation((url) =>
      url.endsWith('/filters/nodes/resolve')
        ? nodesResponse(stale, 422)
        : url.endsWith('/filters/nodes')
          ? nodesResponse(FILTERS_FIXTURE)
          : nodesResponse(),
    );
    renderAt('/reports/new');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Borrowdale' }));
    expect(await screen.findByText(/no longer in the node list/)).toBeInTheDocument();
    expect(screen.queryByText(/will be included/)).not.toBeInTheDocument();
  });

  it('shows a loading state, then an error with retry when the options fail', async () => {
    fetch.mockImplementationOnce(() =>
      nodesResponse(
        {
          error: {
            code: 'GAAP_UNAVAILABLE',
            message: 'The sales data service is unavailable.',
            requestId: 'req-9',
          },
        },
        503,
      ),
    );
    renderAt('/reports/new');
    expect(
      within(screen.getByRole('group', { name: 'Brand / nodes' })).getByRole('status'),
    ).toHaveTextContent('Loading nodes…');
    expect(await screen.findByText('Nodes could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The sales data service is unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-9')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All nodes' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: 'Harare CBD' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All nodes' })).toBeEnabled();
  });

  it('warns when the node list is incomplete', async () => {
    fetch.mockImplementationOnce(() =>
      nodesResponse({ ...FILTERS_FIXTURE, meta: { complete: false } }),
    );
    renderAt('/reports/new');
    expect(await screen.findByText(/may be incomplete/i)).toBeInTheDocument();
  });

  it('shows an empty message when there are no nodes, and All nodes cannot be resolved', async () => {
    fetch.mockImplementation((url) =>
      url.endsWith('/filters/nodes/resolve')
        ? nodesResponse(
            { error: { code: 'NO_NODES', message: 'The selection contains no nodes.' } },
            422,
          )
        : url.endsWith('/filters/nodes')
          ? nodesResponse({ data: { brands: [], nodes: [] }, meta: { complete: true } })
          : nodesResponse(),
    );
    renderAt('/reports/new');
    expect(await screen.findByText('No nodes returned.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'All nodes' }));
    expect(await screen.findByText('The selection contains no nodes.')).toBeInTheDocument();
  });

  it('shows validation messages for empty filters after Check selection', async () => {
    renderAt('/reports/new');
    await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(
      expect.arrayContaining([
        'Select at least one product.',
        'Select at least one node.',
        'Choose a start date.',
        'Choose an end date.',
      ]),
    );
  });

  describe('date range', () => {
    const dates = () => {
      const group = screen.getByRole('group', { name: /Date range/ });
      return {
        group,
        start: within(group).getByLabelText('Start date'),
        end: within(group).getByLabelText('End date'),
      };
    };

    it('accepts a valid inclusive range and shows the day count', async () => {
      renderAt('/reports/new');
      const { group, start, end } = dates();
      fireEvent.change(start, { target: { value: '2026-10-01' } });
      fireEvent.change(end, { target: { value: '2026-10-31' } });
      await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
      expect(within(group).getByText(/20261001 → 20261031 \(31 days\)/)).toBeInTheDocument();
      expect(within(group).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(group).getByText(/Both days are included/)).toBeInTheDocument();
      expect(within(group).getByText(/Harare time \(CAT, UTC\+2\)/)).toBeInTheDocument();
    });

    it('blocks an end date before the start date with a clear message', async () => {
      renderAt('/reports/new');
      const { group, start, end } = dates();
      fireEvent.change(start, { target: { value: '2026-11-01' } });
      fireEvent.change(end, { target: { value: '2026-10-01' } });
      await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
      expect(within(group).getByRole('alert')).toHaveTextContent(
        'End date must be on or after the start date.',
      );
      expect(end).toHaveAttribute('aria-invalid', 'true');
    });

    it('blocks a range longer than the maximum', async () => {
      renderAt('/reports/new');
      const { group, start, end } = dates();
      fireEvent.change(start, { target: { value: '2026-01-01' } });
      fireEvent.change(end, { target: { value: '2026-11-01' } });
      await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
      expect(within(group).getByRole('alert')).toHaveTextContent(
        'The range is 305 days; the maximum is 92 days.',
      );
    });

    it('blocks future dates', async () => {
      renderAt('/reports/new');
      const { group, start, end } = dates();
      fireEvent.change(start, { target: { value: '2099-01-01' } });
      fireEvent.change(end, { target: { value: '2099-01-02' } });
      await userEvent.click(screen.getByRole('button', { name: 'Check selection' }));
      expect(
        within(group)
          .getAllByRole('alert')
          .map((a) => a.textContent),
      ).toEqual(['Start date cannot be in the future.', 'End date cannot be in the future.']);
    });
  });
});

describe('Nodes & Brands page', () => {
  it('lists brands and nodes from the fetched data, not mock data', async () => {
    renderAt('/nodes');
    const group = await screen.findByRole('list', { name: 'Chicken Inn One nodes' });
    expect(within(group).getByText('Harare CBD')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Chicken Inn Two nodes' })).getByText('Borrowdale'),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/v1/nodes?limit=1000', expect.anything());
    expect(within(main()).queryByText('Demo / mock')).not.toBeInTheDocument();
    expect(main()).not.toHaveTextContent(/DEMO-|Demo Chicken Brand/);
  });

  it('shows an error with retry when nodes fail, then recovers', async () => {
    fetch.mockImplementationOnce(() =>
      nodesResponse(
        {
          error: {
            code: 'GAAP_TIMEOUT',
            message: 'The sales data service did not respond in time.',
            requestId: 'req-3',
          },
        },
        504,
      ),
    );
    renderAt('/nodes');
    expect(await screen.findByText('Nodes could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Chicken Inn One nodes' })).toBeInTheDocument();
  });

  it('shows an empty state, an incomplete warning and skipped-record count', async () => {
    fetch.mockImplementationOnce(() => nodesResponse({ data: [], meta: { complete: true } }));
    const first = renderAt('/nodes');
    expect(await screen.findByText('No nodes returned')).toBeInTheDocument();
    first.dispose();
    cleanup();

    fetch.mockImplementationOnce(() =>
      nodesResponse({ data: NODES_FIXTURE, meta: { complete: false, malformedCount: 2 } }),
    );
    renderAt('/nodes');
    expect(await screen.findByText('This node list may be incomplete.')).toBeInTheDocument();
    expect(screen.getByText('2 malformed records were skipped.')).toBeInTheDocument();
  });

  it('shows that nodes are a saved copy, with when they were fetched and how fresh', async () => {
    const meta = {
      complete: true,
      origin: 'database',
      persisted: true,
      fetchedAt: '2026-11-07T10:00:00.000Z',
      cacheFreshness: 'stale',
    };
    fetch.mockImplementationOnce(() => nodesResponse({ data: NODES_FIXTURE, meta }));
    renderAt('/nodes');
    expect(await screen.findByText(/Saved copy · last fetched from GAAP/)).toHaveTextContent(
      /Stale/,
    );
  });

  it('Refresh from GAAP posts to the refresh endpoint and shows the new data', async () => {
    renderAt('/nodes');
    await screen.findByRole('list', { name: 'Chicken Inn One nodes' });
    fetch.mockImplementationOnce(() =>
      nodesResponse({
        data: [...NODES_FIXTURE, apiNode('S3', 'New Store', 'G1', 'G1')],
        meta: {
          complete: true,
          origin: 'gaap',
          persisted: true,
          fetchedAt: '2026-11-07T11:00:00.000Z',
          cacheFreshness: 'fresh',
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Refresh from GAAP' }));
    expect(await screen.findByText('New Store')).toBeInTheDocument();
    const [url, init] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/v1/nodes/refresh?limit=1000');
    expect(init.method).toBe('POST');
    expect(screen.getByText(/Fetched from GAAP just now/)).toBeInTheDocument();
  });

  it('a failed refresh keeps the saved nodes on screen and says so', async () => {
    renderAt('/nodes');
    await screen.findByRole('list', { name: 'Chicken Inn One nodes' });
    fetch.mockImplementationOnce(() =>
      nodesResponse(
        {
          error: {
            code: 'GAAP_UNAVAILABLE',
            message: 'The sales data service is unavailable.',
            requestId: 'req-7',
          },
        },
        503,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Refresh from GAAP' }));
    expect(await screen.findByText('Refresh failed')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-7')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Chicken Inn One nodes' })).toBeInTheDocument();
  });

  it('reloading only reads (GET) and never posts a refresh', async () => {
    renderAt('/nodes');
    await screen.findByRole('list', { name: 'Chicken Inn One nodes' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/nodes?limit=1000');
    expect(fetch.mock.calls[0][1].method).toBe('GET');
  });

  it('puts nodes without a known brand under Ungrouped nodes', async () => {
    fetch.mockImplementationOnce(() =>
      nodesResponse({
        data: [apiNode('X1', 'Loose Chicken Inn Store', 'NOPE', 'NOPE')],
        meta: { complete: true },
      }),
    );
    renderAt('/nodes');
    const list = await screen.findByRole('list', { name: 'Ungrouped nodes nodes' });
    expect(within(list).getByText('Loose Chicken Inn Store')).toBeInTheDocument();
  });
});

describe('report details (FIXTURE API responses, not live data)', () => {
  const path = `/reports/${REPORT_ID}`;

  it('shows a loading state, then the date range, filters, timestamps and freshness', async () => {
    const calls = stubReportDetail(detailCompleted());
    renderAt(path);
    expect(screen.getByText('Loading the saved report…')).toBeInTheDocument();

    expect(await screen.findByText('2026-11-01 → 2026-11-07')).toBeInTheDocument();
    expect(screen.getByText('2026-11-08 10:00 UTC')).toBeInTheDocument(); // generated at
    expect(screen.getByText('2026-11-08 09:59 UTC')).toBeInTheDocument(); // source fetched at
    expect(screen.getByText('Live from GAAP · fetched 2026-11-08 09:59 UTC')).toBeInTheDocument();
    expect(screen.getAllByText('2 selected')).toHaveLength(2); // products, nodes
    expect(screen.getByText(/snapshot, not a fresh run/)).toBeInTheDocument();
    // Only this report's saved-data endpoints are called: no GAAP, node or catalog request.
    expect(calls[0]).toBe(`/api/v1/reports/${REPORT_ID}`);
    await screen.findByRole('table', { name: 'Saved report lines' });
    expect(calls.every((url) => url.startsWith(`/api/v1/reports/${REPORT_ID}`))).toBe(true);
  });

  it('shows saved totals per currency, never combined, and flags UNKNOWN', async () => {
    stubReportDetail(detailCompleted());
    renderAt(path);
    const totals = await screen.findByRole('list', { name: 'Totals by currency' });
    const cards = within(totals).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('USD');
    expect(cards[0]).toHaveTextContent('5.10');
    expect(cards[0]).toHaveTextContent('Quantity: 3');
    expect(cards[1]).toHaveTextContent('ZWG');
    expect(cards[1]).toHaveTextContent('100.00');
    expect(cards[2]).toHaveTextContent('UNKNOWN');
    expect(cards[2]).toHaveTextContent('7.00');
    // No cross-currency total anywhere.
    expect(screen.queryByText(/grand total|all currencies/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CURRENCY_UNKNOWN: 1 line carry/)).not.toBeInTheDocument();
  });

  it('breaks down by currency: one section each for USD, ZWG and UNKNOWN, UNKNOWN last', async () => {
    stubReportDetail(detailCompleted());
    renderAt(path);
    const usd = await screen.findByRole('table', { name: 'USD totals by product' });
    expect(within(usd).getAllByRole('row')).toHaveLength(2);
    expect(within(usd).getByText('Product One')).toBeInTheDocument();
    expect(within(usd).getByText('5.10 USD')).toBeInTheDocument();
    const zwg = screen.getByRole('table', { name: 'ZWG totals by product' });
    expect(within(zwg).getByText('100.00 ZWG')).toBeInTheDocument();
    const unknown = screen.getByRole('table', { name: 'UNKNOWN totals by product' });
    expect(within(unknown).getByText('7.00 UNKNOWN')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'USD totals by node' })).toBeInTheDocument();
    // Section order: USD, ZWG, then UNKNOWN last.
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent.replace(/\s+/g, ' ').trim());
    expect(headings).toEqual(['USDUSD sales', 'ZWGZWG sales', 'UNKNOWNUnclassified currency']);
    // UNKNOWN is explained and never labelled USD.
    expect(screen.getByText(/could not be determined from the source data/)).toBeInTheDocument();
    expect(within(unknown).queryByText(/USD/)).not.toBeInTheDocument();
  });

  it('renders additional currencies dynamically and states when USD or ZWG has no lines', async () => {
    const report = detailCompleted();
    report.totals = [
      { currency: 'ZAR', lineCount: 2, quantity: '2', turnover: '40' },
      { currency: 'ZWG', lineCount: 1, quantity: '4', turnover: '100' },
    ];
    report.summary.products = [
      group('ZAR', 'p1', 'Product One', 2, '2', '40'),
      group('ZWG', 'p1', 'Product One', 1, '4', '100'),
    ];
    report.summary.nodes = [];
    stubReportDetail(report);
    renderAt(path);
    expect(await screen.findByRole('table', { name: 'ZAR totals by product' })).toBeInTheDocument();
    expect(screen.getByText('No USD lines in this report.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'USD totals by product' })).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be determined from the source data/)).toBeNull();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.map((h) => h.replace(/\s+/g, ' ').trim())).toEqual([
      'USDUSD sales',
      'ZWGZWG sales',
      'ZARZAR sales',
    ]);
  });

  it('filters the sections without changing any saved total', async () => {
    stubReportDetail(detailCompleted());
    renderAt(path);
    await screen.findByRole('table', { name: 'USD totals by product' });
    const cardsBefore = within(screen.getByRole('list', { name: 'Totals by currency' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    const filter = screen.getByRole('group', { name: 'Show currency sections' });
    await userEvent.click(within(filter).getByRole('button', { name: 'ZWG' }));
    expect(within(filter).getByRole('button', { name: 'ZWG' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('table', { name: 'ZWG totals by product' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'USD totals by product' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'UNKNOWN totals by product' })).toBeNull();
    // Saved totals are identical, and the filter never asks the server for anything.
    const cardsAfter = within(screen.getByRole('list', { name: 'Totals by currency' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(cardsAfter).toEqual(cardsBefore);
    await userEvent.click(within(filter).getByRole('button', { name: 'All sections' }));
    expect(screen.getByRole('table', { name: 'USD totals by product' })).toBeInTheDocument();
  });

  it('filtering to a currency with no data shows an explicit empty message', async () => {
    const report = detailCompleted();
    report.totals = report.totals.filter((t) => t.currency === 'USD');
    report.summary.products = report.summary.products.filter((g) => g.currency === 'USD');
    report.summary.nodes = report.summary.nodes.filter((g) => g.currency === 'USD');
    stubReportDetail(report);
    renderAt(path);
    await screen.findByRole('table', { name: 'USD totals by product' });
    const filter = screen.getByRole('group', { name: 'Show currency sections' });
    await userEvent.click(within(filter).getByRole('button', { name: 'ZWG' }));
    expect(screen.getByText('No ZWG lines in this report.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /totals by/ })).toBeNull();
    expect(screen.queryByText(/could not be determined/)).toBeNull(); // no UNKNOWN section
    expect(within(filter).queryByRole('button', { name: 'UNKNOWN' })).toBeNull();
  });

  it('shows an unnamed product by its id', async () => {
    const report = detailCompleted();
    report.summary.products[0].name = null;
    stubReportDetail(report);
    renderAt(path);
    const products = await screen.findByRole('table', { name: 'USD totals by product' });
    expect(within(products).getAllByText('p1').length).toBeGreaterThan(0);
  });

  it('shows an empty completed report without tables', async () => {
    const report = detailCompleted();
    report.totals = [];
    report.rowCount = 0;
    report.summary = { rowCount: 0, products: [], nodes: [], warnings: [] };
    stubReportDetail(report);
    renderAt(path);
    expect(await screen.findByText('2026-11-01 → 2026-11-07')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Totals by currency' })).not.toBeInTheDocument();
  });

  it('shows a pending report without data and refetches on Check again', async () => {
    const calls = stubReportDetail(detailPending());
    renderAt(path);
    expect(
      await screen.findByText(/still being generated, so there is nothing/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });

  it('shows a failed report with its reason and no partial data', async () => {
    stubReportDetail(detailFailed());
    renderAt(path);
    expect(await screen.findByText('This report failed')).toBeInTheDocument();
    expect(screen.getByText('GAAP could not be reached.')).toBeInTheDocument();
    expect(screen.getByText('Error code: GAAP_UNAVAILABLE')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Totals by currency' })).not.toBeInTheDocument();
  });

  it('shows an empty completed report without tables or a rows request', async () => {
    const report = detailCompleted();
    report.totals = [];
    report.rowCount = 0;
    report.summary = { rowCount: 0, products: [], nodes: [], warnings: [] };
    const calls = stubReportDetail(report);
    renderAt(path);
    expect(await screen.findByText('This report has no saved lines')).toBeInTheDocument();
    expect(calls).toEqual([`/api/v1/reports/${REPORT_ID}`]);
  });

  it('shows a not-found view for a missing report', async () => {
    stubReportDetail(null, 404);
    renderAt(path);
    expect(await screen.findByText('No saved report with this ID')).toBeInTheDocument();
  });

  it('shows an error with retry when the report cannot be loaded', async () => {
    stubReportDetail(null, 500);
    renderAt(path);
    expect(await screen.findByText('The saved report could not be loaded')).toBeInTheDocument();
    stubReportDetail(detailCompleted());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('2026-11-01 → 2026-11-07')).toBeInTheDocument();
  });
});

describe('report detail table (FIXTURE API responses, not live data)', () => {
  const path = `/reports/${REPORT_ID}`;
  const lastUrl = (endpoint) => endpoint.requests.at(-1);
  const bodyRows = async () => {
    const table = await screen.findByRole('table', { name: 'Saved report lines' });
    return within(table).getAllByRole('row').slice(1);
  };

  it('shows each saved line with product, node, date, currency, quantity and turnover', async () => {
    const endpoint = fakeRowsEndpoint();
    stubReportDetail(detailCompleted(), 200, endpoint);
    renderAt(path);
    const rows = await bodyRows();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Product One');
    expect(rows[0]).toHaveTextContent('Store One');
    expect(rows[0]).toHaveTextContent('2026-11-05 08:00 UTC');
    expect(rows[0]).toHaveTextContent('USD');
    expect(rows[0]).toHaveTextContent('2.50 USD');
    expect(rows[3]).toHaveTextContent('100.00 ZWG');
    expect(rows[4]).toHaveTextContent('7.00 UNKNOWN');
    expect(rows[4]).not.toHaveTextContent('Warning');
    expect(endpoint.requests[0]).toBe(
      `/api/v1/reports/${REPORT_ID}/rows?sort=lineIndex&order=asc&limit=50&offset=0`,
    );
    expect(screen.getByText('Showing 1–5 of 5 lines')).toBeInTheDocument();
    // Unfiltered totals are labelled as the report totals and kept per currency.
    const totals = screen.getByRole('list', { name: 'Totals for the lines shown' });
    expect(within(totals).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/the same as the report totals/)).toBeInTheDocument();
  });

  it('searches on the server, narrows the totals with it, and clears back to everything', async () => {
    const endpoint = fakeRowsEndpoint();
    stubReportDetail(detailCompleted(), 200, endpoint);
    renderAt(path);
    await bodyRows();

    await userEvent.type(screen.getByLabelText('Search lines'), 'two');
    await vi.waitFor(() => expect(lastUrl(endpoint)).toContain('search=two'));
    await vi.waitFor(async () => expect(await bodyRows()).toHaveLength(1));
    expect((await bodyRows())[0]).toHaveTextContent('Product Two');
    // One request for the finished search, not one per keystroke.
    expect(endpoint.requests.filter((url) => url.includes('search='))).toHaveLength(1);
    expect(screen.getByText(/matching lines only \(not the whole report\)/)).toBeInTheDocument();
    const totals = screen.getByRole('list', { name: 'Totals for the lines shown' });
    expect(within(totals).getAllByRole('listitem')).toHaveLength(1);
    expect(totals).toHaveTextContent('2.50 USD');

    await userEvent.clear(screen.getByLabelText('Search lines'));
    await userEvent.type(screen.getByLabelText('Search lines'), 'nothing like this');
    expect(await screen.findByText('No lines match')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Saved report lines' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(await bodyRows()).toHaveLength(5);
    expect(screen.getByLabelText('Search lines')).toHaveValue('');
  });

  it('filters by one currency and never mixes currencies in the totals', async () => {
    const endpoint = fakeRowsEndpoint();
    stubReportDetail(detailCompleted(), 200, endpoint);
    renderAt(path);
    await bodyRows();
    const filter = screen.getByRole('group', { name: 'Currency filter' });
    await userEvent.click(within(filter).getByRole('button', { name: 'ZWG' }));
    await vi.waitFor(() => expect(lastUrl(endpoint)).toContain('currency=ZWG'));
    await vi.waitFor(async () => expect(await bodyRows()).toHaveLength(1));
    const totals = screen.getByRole('list', { name: 'Totals for the lines shown' });
    expect(totals).toHaveTextContent('100.00 ZWG');
    expect(totals).not.toHaveTextContent('USD');
    expect(within(filter).getByRole('button', { name: 'ZWG' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sorts by a column through the server and toggles the direction', async () => {
    const endpoint = fakeRowsEndpoint();
    stubReportDetail(detailCompleted(), 200, endpoint);
    renderAt(path);
    await bodyRows();
    const header = () =>
      within(screen.getByRole('table', { name: 'Saved report lines' })).getByRole('columnheader', {
        name: /Turnover/,
      });
    expect(header()).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(within(header()).getByRole('button'));
    await vi.waitFor(() => expect(lastUrl(endpoint)).toContain('sort=turnover&order=asc'));
    await vi.waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'ascending'));
    await vi.waitFor(async () => expect((await bodyRows())[0]).toHaveTextContent('0.10 USD'));

    await userEvent.click(within(header()).getByRole('button'));
    await vi.waitFor(() => expect(lastUrl(endpoint)).toContain('sort=turnover&order=desc'));
    await vi.waitFor(async () => expect((await bodyRows())[0]).toHaveTextContent('100.00 ZWG'));
    expect(header()).toHaveAttribute('aria-sort', 'descending');
  });

  it('pages through a large report 50 lines at a time and disables Previous/Next at the ends', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      line(i, { currency: 'USD', quantity: '1', turnover: '1', productName: `Item ${i}` }),
    );
    const endpoint = fakeRowsEndpoint(many);
    stubReportDetail(detailCompleted(), 200, endpoint);
    renderAt(path);
    expect(await screen.findByText('Showing 1–50 of 120 lines')).toBeInTheDocument();
    expect(await bodyRows()).toHaveLength(50);
    const previous = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();

    await userEvent.click(next);
    expect(await screen.findByText('Showing 51–100 of 120 lines')).toBeInTheDocument();
    expect(lastUrl(endpoint)).toContain('offset=50');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 101–120 of 120 lines')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    // Never more than one page is requested at a time.
    expect(endpoint.requests.every((url) => url.includes('limit=50'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Showing 51–100 of 120 lines')).toBeInTheDocument();
  });

  it('shows an error with retry when the lines cannot be loaded, keeping the summary', async () => {
    const working = fakeRowsEndpoint();
    let failed = false;
    const endpoint = {
      requests: working.requests,
      respond: (url) => {
        if (!failed) {
          failed = true;
          return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Boom.' } } };
        }
        return working.respond(url);
      },
    };
    stubReportDetail(detailCompleted(), 200, endpoint);
    renderAt(path);
    expect(await screen.findByText('The report lines could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('2026-11-01 → 2026-11-07')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await bodyRows()).toHaveLength(5);
  });

  it('does not request lines for a pending or failed report', async () => {
    const calls = stubReportDetail(detailPending());
    renderAt(path);
    await screen.findByText(/still being generated, so there is nothing/);
    expect(calls.some((url) => url.includes('/rows'))).toBe(false);
  });
});

// FIXTURE: invented saved-report metadata in the backend's list shape (not real reports).
const listItem = (n, overrides = {}) => ({
  reportId: `aaaaaaaaaaaaaaaaaaaa${String(n).padStart(4, '0')}`,
  status: 'completed',
  filters: {
    startDate: '20261101',
    endDate: '20261107',
    productCount: 3,
    nodeCount: 1,
    brandCount: 0,
  },
  rowCount: 10,
  calculationVersion: 'v1',
  provenance: {
    source: 'GAAP_UNITY',
    sourceStartedAt: '2026-11-08T09:58:00.000Z',
    fetchedAt: '2026-11-08T09:59:00.000Z',
    usedCache: false,
    cacheFreshness: 'not_applicable',
    complete: true,
  },
  error: null,
  startedAt: '2026-11-08T09:57:00.000Z',
  completedAt: '2026-11-08T10:00:00.000Z',
  failedAt: null,
  createdAt: '2026-11-08T09:57:00.000Z',
  ...overrides,
});

/** Stubs fetch for `/reports?...`; `all` is the full list, paged and filtered like the backend. */
function stubReportsApi(all, { fail = false } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (!url.startsWith('/api/v1/reports?')) return nodesResponse();
      const params = new URL(url, 'http://x').searchParams;
      calls.push(Object.fromEntries(params));
      if (fail) {
        return nodesResponse({ error: { code: 'INTERNAL_ERROR', message: 'Boom.' } }, 500);
      }
      const limit = Number(params.get('limit'));
      const offset = Number(params.get('offset'));
      const rows = all.filter((r) => !params.get('status') || r.status === params.get('status'));
      const items = rows.slice(offset, offset + limit);
      return nodesResponse({
        data: items,
        meta: {
          pagination: {
            total: rows.length,
            limit,
            offset,
            returned: items.length,
            hasMore: offset + items.length < rows.length,
          },
        },
      });
    }),
  );
  return calls;
}

describe('saved reports (FIXTURE API responses, not live data)', () => {
  it('shows a loading state, then lists reports with date, status, selection and freshness', async () => {
    stubReportsApi([
      listItem(1),
      listItem(2, {
        status: 'failed',
        completedAt: null,
        failedAt: '2026-11-08T10:05:00.000Z',
        error: { code: 'GAAP_UNAVAILABLE', message: 'GAAP could not be reached.' },
        provenance: null,
      }),
      listItem(3, {
        provenance: {
          source: 'GAAP_UNITY',
          fetchedAt: '2026-11-08T09:59:00.000Z',
          usedCache: true,
          cacheFreshness: 'stale',
          complete: true,
        },
      }),
    ]);
    renderAt('/reports');
    expect(screen.getByText('Loading saved reports…')).toBeInTheDocument();

    const table = await screen.findByRole('table', { name: 'Saved reports' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getAllByText('2026-11-01 → 2026-11-07')).toHaveLength(3);
    expect(within(table).getAllByText('3 products · 1 node')).toHaveLength(3);
    expect(within(table).getByText('Live from GAAP · fetched 2026-11-08 09:59 UTC')).toBeVisible();
    expect(within(table).getByText('Cached (stale) · fetched 2026-11-08 09:59 UTC')).toBeVisible();
    expect(within(table).getByText('GAAP could not be reached.')).toBeVisible();
    expect(within(table).getByText('Not recorded')).toBeVisible();
    // Only completed reports can be opened; the link goes to that report's id.
    expect(within(table).getAllByRole('link')).toHaveLength(2);
    expect(
      within(table).getByRole('link', { name: 'View saved report Report aaaaaaaaaaaaaaaaaaaa0001' }),
    ).toHaveAttribute('href', '/reports/aaaaaaaaaaaaaaaaaaaa0001');
    // No per-user ownership is claimed.
    expect(screen.getByText(/not private to a user/)).toBeInTheDocument();
  });

  it('asks the API for the chosen status and sort, and returns to the first page', async () => {
    const calls = stubReportsApi([listItem(1), listItem(2, { status: 'failed' })]);
    renderAt('/reports');
    await screen.findByRole('table');
    expect(calls[0]).toEqual({ sort: 'createdAt', order: 'desc', limit: '20', offset: '0' });

    await userEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'startDate');
    await userEvent.click(screen.getByRole('button', { name: 'Descending' }));
    await screen.findByRole('table');
    expect(calls.at(-1)).toEqual({
      sort: 'startDate',
      order: 'asc',
      limit: '20',
      offset: '0',
      status: 'failed',
    });
  });

  it('pages forward and back using the server pagination', async () => {
    const all = Array.from({ length: 25 }, (_, i) => listItem(i + 1));
    const calls = stubReportsApi(all);
    renderAt('/reports');
    await screen.findByText('Showing 1–20 of 25');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Showing 21–25 of 25');
    expect(calls.at(-1).offset).toBe('20');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Showing 1–20 of 25');
  });

  it('shows an empty state when there are no reports', async () => {
    stubReportsApi([]);
    renderAt('/reports');
    expect(await screen.findByText('No saved reports yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a status-specific empty state when the filter matches nothing', async () => {
    stubReportsApi([listItem(1)]);
    renderAt('/reports');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(await screen.findByText('No reports with this status')).toBeInTheDocument();
  });

  it('shows an error with a retry that works', async () => {
    stubReportsApi([], { fail: true });
    renderAt('/reports');
    expect(await screen.findByText('Saved reports could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    stubReportsApi([listItem(1)]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Saved reports' })).toBeInTheDocument();
  });

  it('copes with reports missing parts (no dates, selection or source data)', async () => {
    stubReportsApi([
      listItem(1, {
        status: 'pending',
        filters: { startDate: null, endDate: null, productCount: null, nodeCount: null },
        provenance: { fetchedAt: null },
        completedAt: null,
      }),
    ]);
    renderAt('/reports');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('— → —')).toBeVisible();
    expect(within(table).getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(within(table).getByText('Not fetched yet')).toBeVisible();
  });
});

/**
 * FIXTURE stand-in for the list and detail endpoints the dashboard reads. `all` is the saved list
 * (newest first); `detail` is returned for the latest completed report.
 */
function stubDashboardApi(
  all,
  { detail = detailCompleted(), failList = false, failDetail = false } = {},
) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      calls.push(url);
      if (url.startsWith('/api/v1/reports?')) {
        if (failList)
          return nodesResponse({ error: { code: 'INTERNAL_ERROR', message: 'Boom.' } }, 500);
        const params = new URL(url, 'http://x').searchParams;
        const limit = Number(params.get('limit'));
        const rows = all.filter((r) => !params.get('status') || r.status === params.get('status'));
        const items = rows.slice(0, limit);
        return nodesResponse({
          data: items,
          meta: {
            pagination: {
              total: rows.length,
              limit,
              offset: 0,
              returned: items.length,
              hasMore: items.length < rows.length,
            },
          },
        });
      }
      if (url.startsWith('/api/v1/reports/')) {
        return failDetail
          ? nodesResponse({ error: { code: 'INTERNAL_ERROR', message: 'Detail boom.' } }, 500)
          : nodesResponse({ data: detail });
      }
      return nodesResponse();
    }),
  );
  return calls;
}

describe('dashboard (FIXTURE API responses, not live data)', () => {
  it('shows saved-report counts, recent reports and the latest completed report per currency', async () => {
    const calls = stubDashboardApi([
      listItem(3, { status: 'failed', completedAt: null, failedAt: '2026-11-08T10:05:00.000Z' }),
      listItem(2, { status: 'pending', completedAt: null }),
      listItem(1),
    ]);
    renderAt('/');
    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();

    const counts = await screen.findByRole('list', { name: 'Saved report counts' });
    expect(within(counts).getByText('Saved reports').nextSibling).toHaveTextContent('3');
    expect(within(counts).getByText('Completed').nextSibling).toHaveTextContent('1');
    expect(within(counts).getByText('In progress').nextSibling).toHaveTextContent('1');
    expect(within(counts).getByText('Failed').nextSibling).toHaveTextContent('1');

    // Totals stay per currency and are labelled as a saved snapshot, not live sales.
    const totals = await screen.findByRole('list', { name: 'Totals by currency' });
    expect(within(totals).getAllByRole('listitem')).toHaveLength(3);
    expect(main()).toHaveTextContent(/not live or all-time sales/);
    expect(main()).toHaveTextContent('Live from GAAP · fetched 2026-11-08 09:59 UTC');

    const recent = screen.getByRole('list', { name: 'Recent reports' });
    expect(within(recent).getAllByRole('listitem')).toHaveLength(3);
    // Only completed reports link to details; the id and the detail request match the list.
    expect(within(recent).getAllByRole('link')).toHaveLength(1);
    expect(within(recent).getByRole('link')).toHaveAttribute(
      'href',
      '/reports/aaaaaaaaaaaaaaaaaaaa0001',
    );
    expect(calls).toContain('/api/v1/reports/aaaaaaaaaaaaaaaaaaaa0001');
    expect(main()).not.toHaveTextContent(/DEMO-|Demo \/ mock|demo-rpt/);
  });

  it('shows an empty state and no totals when nothing is saved', async () => {
    const calls = stubDashboardApi([]);
    renderAt('/');
    expect(await screen.findByText('No saved reports yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Totals by currency' })).not.toBeInTheDocument();
    expect(calls.some((url) => /\/reports\/[^?]/.test(url))).toBe(false);
  });

  it('shows an error with retry when the list cannot be loaded, then recovers', async () => {
    stubDashboardApi([], { failList: true });
    renderAt('/');
    expect(await screen.findByText('The dashboard could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved report counts' })).not.toBeInTheDocument();

    stubDashboardApi([listItem(1)]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Saved report counts' })).toBeInTheDocument();
  });

  it('keeps the counts and recent list when the latest report totals fail', async () => {
    stubDashboardApi([listItem(1)], { failDetail: true });
    renderAt('/');
    expect(await screen.findByText('Totals for this report could not be loaded')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Saved report counts' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Recent reports' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Totals by currency' })).not.toBeInTheDocument();
  });

  it('labels cached source data as cached and navigates to the saved reports list', async () => {
    stubDashboardApi([
      listItem(1, {
        provenance: {
          source: 'GAAP_UNITY',
          fetchedAt: '2026-11-08T09:59:00.000Z',
          usedCache: true,
          cacheFreshness: 'stale',
          complete: true,
        },
      }),
    ]);
    const router = renderAt('/');
    await screen.findByRole('list', { name: 'Totals by currency' });
    expect(main()).toHaveTextContent('Cached (stale) · fetched 2026-11-08 09:59 UTC');
    await userEvent.click(screen.getByRole('link', { name: 'All saved reports' }));
    expect(router.state.location.pathname).toBe('/reports');
  });
});

describe('responsive shell', () => {
  it('collapses the sidebar to icons while keeping accessible link names', async () => {
    renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Saved Reports' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens the mobile drawer, navigates and closes it', async () => {
    const router = renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    await userEvent.click(within(dialog).getByRole('link', { name: 'Settings' }));
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('keyboard navigation', () => {
  it('reaches the skip link first, then the menu control', async () => {
    renderAt('/');
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveFocus();
  });

  it('activates a sidebar link with the keyboard', async () => {
    const router = renderAt('/');
    screen.getByRole('link', { name: 'Nodes & Brands' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/nodes');
  });
});
