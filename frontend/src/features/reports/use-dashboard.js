import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export const RECENT_LIMIT = 5;

const LOADING = Object.freeze({
  status: 'loading',
  counts: null,
  recent: [],
  latest: null,
  error: null,
});

const errorInfo = (error) => ({
  code: error?.code ?? null,
  message:
    error?.name === 'ApiClientError' && typeof error.message === 'string'
      ? error.message
      : 'Saved reports could not be loaded.',
  requestId: error?.requestId ?? null,
});

const listPath = (params) => `/reports?${new URLSearchParams(params).toString()}`;

function totalOf({ meta }) {
  if (!Number.isInteger(meta?.pagination?.total)) throw new Error('Unexpected saved reports response');
  return meta.pagination.total;
}

/**
 * Dashboard data, all from the application's own saved reports (never a live GAAP fetch):
 * - `counts`: saved-report totals per status, from the list endpoint's pagination totals;
 * - `recent`: the newest reports (metadata only);
 * - `latest`: the newest completed report with its saved per-currency totals.
 * `latest.status` is 'success' | 'error' and is independent, so a failed detail request keeps the rest.
 *
 * `status` is 'loading' | 'success' | 'error'.
 */
export function useDashboard() {
  const [result, setResult] = useState({ key: null, ...LOADING });
  const [attempt, setAttempt] = useState(0);
  const key = String(attempt);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const list = (params) => apiClient.get(listPath(params), { signal });
    const newest = { sort: 'createdAt', order: 'desc' };

    (async () => {
      const [recent, completed, pending, failed] = await Promise.all([
        list({ ...newest, limit: String(RECENT_LIMIT), offset: '0' }),
        list({ ...newest, status: 'completed', limit: '1', offset: '0' }),
        list({ status: 'pending', limit: '1', offset: '0' }),
        list({ status: 'failed', limit: '1', offset: '0' }),
      ]);
      if (!Array.isArray(recent.data) || !Array.isArray(completed.data)) {
        throw new Error('Unexpected saved reports response');
      }
      const counts = {
        all: totalOf(recent),
        completed: totalOf(completed),
        pending: totalOf(pending),
        failed: totalOf(failed),
      };

      let latest = null;
      const latestId = completed.data[0]?.reportId;
      if (typeof latestId === 'string') {
        try {
          const { data } = await apiClient.get(`/reports/${encodeURIComponent(latestId)}`, {
            signal,
          });
          if (data === null || typeof data !== 'object' || !Array.isArray(data.totals)) {
            throw new Error('Unexpected report response');
          }
          latest = { status: 'success', item: completed.data[0], totals: data.totals, error: null };
        } catch (error) {
          if (signal.aborted) return;
          latest = { status: 'error', item: completed.data[0], totals: [], error: errorInfo(error) };
        }
      }
      if (signal.aborted) return;
      setResult({ key, status: 'success', counts, recent: recent.data, latest, error: null });
    })().catch((error) => {
      if (signal.aborted) return;
      setResult({ key, ...LOADING, status: 'error', error: errorInfo(error) });
    });

    return () => controller.abort();
  }, [key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...(result.key === key ? result : LOADING), reload };
}
