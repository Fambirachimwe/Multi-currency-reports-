import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_INTERVAL_MS,
  buildReportRequest,
  useGenerateReport,
} from '@/features/reports/use-generate-report';

// FIXTURE: invented valid form state (not real selections).
const FILTERS = {
  departmentId: 'd1',
  productIds: ['p1', 'p2'],
  nodeMode: 'nodes',
  brandIds: ['b-ignored'],
  nodeIds: ['n1'],
  startDate: '20260101',
  endDate: '20260102',
};

const json = (body, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

describe('buildReportRequest', () => {
  it('sends only the active node mode ids and no browse-only state', () => {
    expect(buildReportRequest(FILTERS)).toEqual({
      startDate: '20260101',
      endDate: '20260102',
      productIds: ['p1', 'p2'],
      nodes: { mode: 'nodes', nodeIds: ['n1'] },
      cachePolicy: 'use_cache',
    });
    expect(buildReportRequest({ ...FILTERS, nodeMode: 'all' }).nodes).toEqual({ mode: 'all' });
    expect(buildReportRequest({ ...FILTERS, nodeMode: 'brands' }).nodes).toEqual({
      mode: 'brands',
      brandIds: ['b-ignored'],
    });
  });
});

describe('useGenerateReport (FIXTURE API responses, not live data)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts the request, stays pending until the server says completed, then completes', async () => {
    const statuses = ['pending', 'completed'];
    const fetchMock = vi.fn((url, init) => {
      if (init.method === 'POST') return json({ data: { reportId: 'r1', status: 'pending' } }, 202);
      return json({ data: { reportId: 'r1', status: statuses.shift() } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGenerateReport());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      result.current.start(FILTERS);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe('pending');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).productIds).toEqual(['p1', 'p2']);

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(result.current.phase).toBe('pending');
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    expect(result.current.phase).toBe('completed');
    expect(result.current.reportId).toBe('r1');
  });

  it('shows a failed report with the server reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url, init) =>
        init.method === 'POST'
          ? json({ data: { reportId: 'r2', status: 'pending' } }, 202)
          : json({
              data: {
                reportId: 'r2',
                status: 'failed',
                error: { code: 'X', message: 'Source down.' },
              },
            }),
      ),
    );
    const { result } = renderHook(() => useGenerateReport());
    await act(async () => {
      result.current.start(FILTERS);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(result.current.phase).toBe('failed');
    expect(result.current.error.message).toBe('Source down.');
  });

  it('reports a rejected start (no report id) as an error, with no polling', async () => {
    const fetchMock = vi.fn(() =>
      json({ error: { code: 'ELIGIBILITY_RULES_UNVERIFIED', message: 'Rules unverified.' } }, 422),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGenerateReport());
    await act(async () => {
      result.current.start(FILTERS);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error.message).toBe('Rules unverified.');
    expect(result.current.reportId).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancelling a pending report deletes it, stops polling and ends as cancelled', async () => {
    const fetchMock = vi.fn((url, init) => {
      if (init.method === 'POST') return json({ data: { reportId: 'r1', status: 'pending' } }, 202);
      if (init.method === 'DELETE') return json({ data: { reportId: 'r1', cancelled: true } });
      return json({ data: { reportId: 'r1', status: 'pending' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGenerateReport());
    await act(async () => {
      result.current.start(FILTERS);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe('pending');
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.phase).toBe('cancelled');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/reports/r1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('cancelling while the request is still in flight removes the report once it exists', async () => {
    let answer;
    const fetchMock = vi.fn((url, init) => {
      if (init.method === 'POST') {
        return new Promise((resolve) => {
          answer = () =>
            resolve(
              new Response(JSON.stringify({ data: { reportId: 'r9', status: 'pending' } }), {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
        });
      }
      return json({ data: { reportId: 'r9', cancelled: true } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGenerateReport());
    await act(async () => {
      result.current.start(FILTERS);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.phase).toBe('cancelling');
    await act(async () => {
      answer();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe('cancelled');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/reports/r9',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
