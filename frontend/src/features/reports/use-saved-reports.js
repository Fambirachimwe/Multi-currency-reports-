import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

const INITIAL = Object.freeze({ status: 'loading', reports: [], pagination: null, error: null });

/**
 * One page of saved-report metadata from `GET /api/v1/reports`.
 * `status` is 'loading' | 'success' | 'error'. A result for older parameters is never shown as current.
 *
 * @param {{ status: string, sort: string, order: 'asc'|'desc', page: number, pageSize: number }} params
 *   `status` is 'all' or a report status; `page` is zero-based.
 */
export function useSavedReports({ status, sort, order, page, pageSize }) {
  const [result, setResult] = useState({ key: null, ...INITIAL });
  const [attempt, setAttempt] = useState(0);

  const query = new URLSearchParams({
    sort,
    order,
    limit: String(pageSize),
    offset: String(page * pageSize),
    ...(status === 'all' ? {} : { status }),
  }).toString();
  const key = `${query}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get(`/reports?${query}`, { signal: controller.signal })
      .then(({ data, meta }) => {
        if (!Array.isArray(data) || !Number.isInteger(meta?.pagination?.total)) {
          throw new Error('Unexpected saved reports response');
        }
        setResult({
          key,
          status: 'success',
          reports: data,
          pagination: meta.pagination,
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
                : 'Saved reports could not be loaded.',
            requestId: error?.requestId ?? null,
          },
        });
      });
    return () => controller.abort();
  }, [query, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result.key === key ? result : INITIAL;
  return { ...current, reload };
}
