import { useCallback, useEffect, useState } from 'react';
import { nodeSelectionBody } from '@/features/reports/filters';
import { focusChickenInn } from '@/features/reports/nodes-catalog';
import { apiClient } from '@/lib/api-client';

const INITIAL = Object.freeze({
  status: 'loading',
  brands: [],
  nodes: [],
  meta: null,
  error: null,
});

function toError(error, fallback) {
  return {
    code: error?.code ?? null,
    message:
      error?.name === 'ApiClientError' && typeof error.message === 'string'
        ? error.message
        : fallback,
    requestId: error?.requestId ?? null,
  };
}

/**
 * Brand and node options from the backend (`GET /api/v1/filters/nodes`). The backend owns the
 * brand definition, so the browser never groups nodes itself.
 * `status` is 'loading' | 'success' | 'error'.
 */
export function useNodeFilterOptions() {
  const [state, setState] = useState(INITIAL);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get('/filters/nodes', { signal: controller.signal })
      .then(({ data, meta }) => {
        if (!Array.isArray(data?.brands) || !Array.isArray(data?.nodes)) {
          throw new Error('Unexpected filter options response');
        }
        setState({
          status: 'success',
          ...focusChickenInn({ brands: data.brands, nodes: data.nodes }),
          meta,
          error: null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          ...INITIAL,
          status: 'error',
          error: toError(error, 'Brands and nodes could not be loaded.'),
        });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState(INITIAL);
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}

const IDLE = Object.freeze({ status: 'idle', nodeIds: [], error: null });

/**
 * Asks the backend which exact node IDs the current selection means
 * (`POST /api/v1/filters/nodes/resolve`). `status` is 'idle' (nothing to resolve yet),
 * 'loading', 'success' (`nodeIds`, unique and sorted) or 'error' (`error.code` such as
 * UNKNOWN_NODE for a stale selection, ids in `error.details.unknownIds`).
 *
 * @param {import('@/features/reports/filters').ReportFilters} filters
 * @param {boolean} enabled false until the options have loaded
 */
export function useResolvedNodes(filters, enabled) {
  const body = nodeSelectionBody(filters);
  const key = JSON.stringify(body);
  const hasIds =
    body.mode === 'all' ||
    (body.mode === 'brands' && body.brandIds.length > 0) ||
    (body.mode === 'nodes' && body.nodeIds.length > 0);
  const active = enabled && hasIds;
  const [result, setResult] = useState({ key: null, ...IDLE });

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    apiClient
      .post('/filters/nodes/resolve', JSON.parse(key), { signal: controller.signal })
      .then(({ data }) => setResult({ key, status: 'success', nodeIds: data.nodeIds, error: null }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          status: 'error',
          nodeIds: [],
          error: {
            ...toError(error, 'The selection could not be checked.'),
            details: error?.details ?? null,
          },
        });
      });
    return () => controller.abort();
  }, [active, key]);

  if (!active) return IDLE;
  // A result for an older selection is not shown as current.
  return result.key === key ? result : { ...IDLE, status: 'loading' };
}
