import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

const PAGE_LIMIT = 1000;

function toError(error, fallback) {
  return {
    code: error?.code ?? null,
    message:
      error?.name === 'ApiClientError' && typeof error.message === 'string'
        ? error.message
        : fallback,
    requestId: error?.requestId ?? null,
    details: error?.details ?? null,
  };
}

/** Departments and products can lack a name; fall back to a code, then the id, never blank. */
const label = (item) => item.name ?? item.code ?? item.id;

/**
 * Departments (with their group, so the group > department hierarchy can be shown) from
 * `GET /api/v1/catalog/departments`. `status` is 'loading' | 'success' | 'error'.
 */
export function useDepartments() {
  const [state, setState] = useState({
    status: 'loading',
    departments: [],
    meta: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get(`/catalog/departments?limit=${PAGE_LIMIT}`, { signal: controller.signal })
      .then(({ data, meta }) => {
        if (!Array.isArray(data)) throw new Error('Unexpected departments response');
        setState({
          status: 'success',
          departments: data.map((d) => ({ ...d, name: label(d) })),
          meta,
          error: null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          departments: [],
          meta: null,
          error: toError(error, 'Departments could not be loaded.'),
        });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading', departments: [], meta: null, error: null });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}

/**
 * Products of the department being browsed (`GET /catalog/departments/:id/products`). Lists are
 * kept per department so switching back and forth is instant and `namesById` keeps names for
 * products selected in other departments. `partial` is true when the department holds more
 * products than were returned.
 */
export function useDepartmentProducts(departmentId) {
  const [cache, setCache] = useState({});
  const [attempt, setAttempt] = useState(0);
  const cached = departmentId === '' ? undefined : cache[departmentId];
  const needsFetch = departmentId !== '' && (cached === undefined || cached.status === 'error');

  useEffect(() => {
    if (!needsFetch) return undefined;
    const controller = new AbortController();
    apiClient
      .get(
        `/catalog/departments/${encodeURIComponent(departmentId)}/products?limit=${PAGE_LIMIT}`,
        {
          signal: controller.signal,
        },
      )
      .then(({ data, meta }) => {
        if (!Array.isArray(data)) throw new Error('Unexpected products response');
        setCache((c) => ({
          ...c,
          [departmentId]: {
            status: 'success',
            products: data.map((p) => ({ ...p, name: label(p) })),
            partial: typeof meta?.total === 'number' && meta.total > data.length,
            error: null,
          },
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCache((c) => ({
          ...c,
          [departmentId]: {
            status: 'error',
            products: [],
            partial: false,
            error: toError(error, 'Products could not be loaded.'),
          },
        }));
      });
    return () => controller.abort();
  }, [departmentId, needsFetch, attempt]);

  const namesById = useMemo(() => {
    const names = new Map();
    for (const entry of Object.values(cache)) {
      for (const product of entry.products) names.set(product.id, product.name);
    }
    return names;
  }, [cache]);

  const reload = useCallback(() => {
    setCache((c) => Object.fromEntries(Object.entries(c).filter(([id]) => id !== departmentId)));
    setAttempt((n) => n + 1);
  }, [departmentId]);

  const current =
    departmentId === ''
      ? { status: 'idle', products: [], partial: false, error: null }
      : (cached ?? { status: 'loading', products: [], partial: false, error: null });
  return { ...current, namesById, reload };
}

const IDLE = Object.freeze({ status: 'idle', unknownIds: [], error: null });

/**
 * Asks the backend whether every selected product ID is a current, selectable product
 * (`POST /catalog/products/validate`). `status`: 'idle' (empty selection), 'loading', 'success',
 * or 'error'. For stale/unknown ids `error.code` is UNKNOWN_PRODUCT and `unknownIds` lists them.
 *
 * @param {string[]} productIds
 * @param {boolean} enabled false until the catalog has loaded
 */
export function useValidatedProducts(productIds, enabled) {
  const key = JSON.stringify([...productIds].sort());
  const active = enabled && productIds.length > 0;
  const [result, setResult] = useState({ key: null, ...IDLE });

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    apiClient
      .post(
        '/catalog/products/validate',
        { productIds: JSON.parse(key) },
        { signal: controller.signal },
      )
      .then(() => setResult({ key, status: 'success', unknownIds: [], error: null }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        const err = toError(error, 'The product selection could not be checked.');
        const unknownIds =
          err.code === 'UNKNOWN_PRODUCT' && Array.isArray(err.details?.unknownIds)
            ? err.details.unknownIds
            : [];
        setResult({ key, status: 'error', unknownIds, error: err });
      });
    return () => controller.abort();
  }, [active, key]);

  if (!active) return IDLE;
  return result.key === key ? result : { ...IDLE, status: 'loading' };
}
