import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

const LOADING = Object.freeze({ status: 'loading', report: null, error: null });

/**
 * One saved report from `GET /api/v1/reports/:reportId` (metadata, and for a completed report its
 * saved totals and product/node groupings). The server reads only its own saved snapshot; the browser
 * never triggers a GAAP fetch from here.
 *
 * `status` is 'loading' | 'success' | 'notfound' | 'error'.
 */
export function useSavedReport(reportId) {
  const [result, setResult] = useState({ key: null, ...LOADING });
  const [attempt, setAttempt] = useState(0);
  const key = `${reportId}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get(`/reports/${encodeURIComponent(reportId)}`, { signal: controller.signal })
      .then(({ data }) => {
        if (data === null || typeof data !== 'object' || typeof data.status !== 'string') {
          throw new Error('Unexpected report response');
        }
        setResult({ key, status: 'success', report: data, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const missing =
          error?.name === 'ApiClientError' &&
          (error.code === 'REPORT_NOT_FOUND' || error.code === 'INVALID_REPORT_ID');
        setResult({
          key,
          status: missing ? 'notfound' : 'error',
          report: null,
          error: {
            code: error?.code ?? null,
            message:
              error?.name === 'ApiClientError' && typeof error.message === 'string'
                ? error.message
                : 'The saved report could not be loaded.',
            requestId: error?.requestId ?? null,
          },
        });
      });
    return () => controller.abort();
  }, [reportId, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...(result.key === key ? result : LOADING), reload };
}
