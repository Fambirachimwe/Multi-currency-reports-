import { useCallback, useEffect, useState } from 'react';
import { buildNodeCatalog, focusChickenInn } from '@/features/reports/nodes-catalog';
import { apiClient } from '@/lib/api-client';

const INITIAL = Object.freeze({
  status: 'loading',
  brands: [],
  nodes: [],
  meta: null,
  error: null,
});
const NODES_PATH = '/nodes?limit=1000';

function toError(error) {
  return {
    message:
      error?.name === 'ApiClientError' && typeof error.message === 'string'
        ? error.message
        : 'Nodes could not be loaded.',
    requestId: error?.requestId ?? null,
  };
}

function toSuccess({ data, meta }) {
  if (!Array.isArray(data)) throw new Error('Unexpected nodes response');
  return { status: 'success', ...focusChickenInn(buildNodeCatalog(data)), meta, error: null };
}

/**
 * Loads nodes from the application's own API, which serves them from its database.
 * Reloading the page never makes the backend call GAAP; only `refresh()` does.
 *
 * `status` is 'loading' | 'success' | 'error'. `meta.origin` is 'database' or 'gaap',
 * `meta.cacheFreshness` is 'fresh' | 'stale' | 'incomplete', `meta.complete === false`
 * means the list may be partial. A failed refresh keeps the nodes already shown and sets
 * `refreshError`.
 */
export function useNodes() {
  const [state, setState] = useState(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get(NODES_PATH, { signal: controller.signal })
      .then((response) => setState(toSuccess(response)))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ ...INITIAL, status: 'error', error: toError(error) });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState(INITIAL);
    setAttempt((n) => n + 1);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await apiClient.post('/nodes/refresh?limit=1000');
      setState(toSuccess(response));
    } catch (error) {
      setRefreshError(toError(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { ...state, reload, refresh, refreshing, refreshError };
}
