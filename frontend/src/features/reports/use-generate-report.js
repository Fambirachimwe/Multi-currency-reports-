import { useCallback, useEffect, useRef, useState } from 'react';
import { serializeDateRange } from '@/features/reports/date-range';
import { apiClient } from '@/lib/api-client';

export const POLL_INTERVAL_MS = 3000;

const IDLE = Object.freeze({ phase: 'idle', reportId: null, report: null, error: null });

const errorInfo = (error, fallback) => ({
  code: error?.code ?? null,
  message:
    error?.name === 'ApiClientError' && typeof error.message === 'string'
      ? error.message
      : fallback,
  requestId: error?.requestId ?? null,
});

/** The body for `POST /reports`, built only from validated form state. */
export function buildReportRequest(filters) {
  const nodes =
    filters.nodeMode === 'all'
      ? { mode: 'all' }
      : filters.nodeMode === 'brands'
        ? { mode: 'brands', brandIds: filters.brandIds }
        : { mode: 'nodes', nodeIds: filters.nodeIds };
  return {
    ...serializeDateRange(filters),
    productIds: filters.productIds,
    nodes,
    cachePolicy: 'use_cache',
  };
}

/**
 * Starts a report (`POST /reports`, answered 202 with a pending report) and then follows
 * `GET /reports/:id/status` until it is completed or failed. Nothing is shown as done until the
 * server says so.
 *
 * `cancel()` stops a run that is still going: the server removes the pending report, so a cancelled
 * report is never saved. `phase` is 'idle' | 'submitting' | 'pending' | 'cancelling' | 'cancelled' |
 * 'completed' | 'failed' | 'error'.
 */
export function useGenerateReport() {
  const [state, setState] = useState(IDLE);
  const controllerRef = useRef(null);
  const cancelRequestedRef = useRef(false);
  const reportIdRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(IDLE);
  }, []);

  const removeReport = useCallback(async (reportId) => {
    try {
      await apiClient.delete(`/reports/${encodeURIComponent(reportId)}`);
      setState({ ...IDLE, phase: 'cancelled' });
    } catch (error) {
      if (error?.code === 'REPORT_NOT_FOUND') {
        setState({ ...IDLE, phase: 'cancelled' });
      } else if (error?.code === 'REPORT_NOT_CANCELLABLE') {
        // It finished before the cancel arrived; show what actually happened.
        const finished = error.details?.status;
        setState(
          finished === 'completed'
            ? { ...IDLE, phase: 'completed', reportId }
            : {
                ...IDLE,
                phase: 'failed',
                reportId,
                error: { code: null, message: 'The report failed.', requestId: null },
              },
        );
      } else {
        setState({
          ...IDLE,
          phase: 'error',
          reportId,
          error: errorInfo(error, 'The report could not be cancelled.'),
        });
      }
    }
  }, []);

  const cancel = useCallback(async () => {
    const reportId = reportIdRef.current;
    cancelRequestedRef.current = true;
    setState((s) => ({ ...s, phase: 'cancelling' }));
    if (reportId === null) return; // still submitting: start() removes the report once it exists
    controllerRef.current?.abort();
    await removeReport(reportId);
  }, [removeReport]);

  const start = useCallback(async (filters) => {
    controllerRef.current?.abort();
    cancelRequestedRef.current = false;
    reportIdRef.current = null;
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    setState({ ...IDLE, phase: 'submitting' });

    let reportId;
    try {
      const { data } = await apiClient.post('/reports', buildReportRequest(filters), { signal });
      if (typeof data?.reportId !== 'string') throw new Error('Unexpected response');
      reportId = data.reportId;
      reportIdRef.current = reportId;
    } catch (error) {
      if (signal.aborted) return;
      setState({
        ...IDLE,
        phase: 'error',
        error: errorInfo(error, 'The report could not be started.'),
      });
      return;
    }
    if (cancelRequestedRef.current) {
      // Cancelled while the request was in flight: remove the report the server just created.
      controller.abort();
      await removeReport(reportId);
      return;
    }
    setState({ ...IDLE, phase: 'pending', reportId });

    // Follow the saved report's status. A failed status read is retried; it does not end the run.
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (signal.aborted) return;
      try {
        const { data } = await apiClient.get(`/reports/${encodeURIComponent(reportId)}/status`, {
          signal,
        });
        if (data?.status === 'completed') {
          setState({ ...IDLE, phase: 'completed', reportId, report: data });
          return;
        }
        if (data?.status === 'failed') {
          setState({
            ...IDLE,
            phase: 'failed',
            reportId,
            report: data,
            error: {
              code: data.error?.code ?? null,
              message: data.error?.message ?? 'The report failed.',
              requestId: null,
            },
          });
          return;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error?.code === 'REPORT_NOT_FOUND') {
          setState({
            ...IDLE,
            phase: 'error',
            reportId,
            error: errorInfo(error, 'The report could not be found.'),
          });
          return;
        }
      }
    }
  }, [removeReport]);

  return { ...state, start, reset, cancel };
}
