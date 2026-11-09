import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

const INITIAL = Object.freeze({
  status: 'loading',
  rows: [],
  pagination: null,
  totals: [],
  error: null,
});

/**
 * One page of a saved report's detail rows from `GET /api/v1/reports/:reportId/rows`, with the exact
 * per-currency totals of everything matching the current search/filter (computed by the server).
 * `status` is 'loading' | 'success' | 'error'. A result for older parameters is never shown as current.
 *
 * @param {{ reportId: string, search: string, currency: string, sort: string, order: 'asc'|'desc',
 *   page: number, pageSize: number }} params `currency` is 'all' or a currency code; `page` is zero-based.
 */
export function useReportRows({ reportId, search, currency, sort, order, page, pageSize }) {
  const [result, setResult] = useState({ key: null, ...INITIAL });
  const [attempt, setAttempt] = useState(0);

  const query = new URLSearchParams({
    sort,
    order,
    limit: String(pageSize),
    offset: String(page * pageSize),
    ...(search === '' ? {} : { search }),
    ...(currency === 'all' ? {} : { currency }),
  }).toString();
  const key = `${reportId}?${query}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get(`/reports/${encodeURIComponent(reportId)}/rows?${query}`, { signal: controller.signal })
      .then(({ data, meta }) => {
        if (
          !Array.isArray(data) ||
          !Number.isInteger(meta?.pagination?.total) ||
          !Array.isArray(meta?.totals)
        ) {
          throw new Error('Unexpected report rows response');
        }
        setResult({
          key,
          status: 'success',
          rows: data,
          pagination: meta.pagination,
          totals: meta.totals,
          error: null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          ...INITIAL,
          status: 'error',
          error: {
            code: error?.code ?? null,
            message:
              error?.name === 'ApiClientError' && typeof error.message === 'string'
                ? error.message
                : 'The report lines could not be loaded.',
            requestId: error?.requestId ?? null,
          },
        });
      });
    return () => controller.abort();
  }, [reportId, query, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...(result.key === key ? result : INITIAL), reload };
}
