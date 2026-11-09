import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from '@/lib/api-client';

function jsonResponse(status, body, headers = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

function clientWith(fetchImpl, options = {}) {
  return createApiClient({ baseUrl: '/api/v1', fetchImpl, ...options });
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

function abortableFetch() {
  return vi.fn(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
}

describe('createApiClient', () => {
  it('returns data and meta from a success envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: 1 }, meta: {} }));
    const result = await clientWith(fetchImpl).get('/health');
    expect(result).toEqual({ data: { ok: 1 }, meta: {} });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('joins base URLs and paths without duplicate slashes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: null }));
    await createApiClient({ baseUrl: '/api/v1/', fetchImpl }).get('health');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/health');
  });

  it('defaults missing meta to an empty object', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    await expect(clientWith(fetchImpl).get('/x')).resolves.toEqual({ data: [], meta: {} });
  });

  it('sends JSON bodies on POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 'r1' } }));
    await clientWith(fetchImpl).post('/reports', { a: 1 });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('maps the server error envelope to ApiClientError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(404, {
        error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: 'req-1' },
      }),
    );
    const error = await captureError(clientWith(fetchImpl).get('/nope'));
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route not found.',
      status: 404,
      requestId: 'req-1',
    });
  });

  it('uses HTTP_ERROR and the X-Request-Id header for non-envelope errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(502, '<html>Bad gateway</html>', { 'X-Request-Id': 'h-1' }));
    const error = await captureError(clientWith(fetchImpl).get('/x'));
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 502, requestId: 'h-1' });
    expect(error.message).not.toContain('html');
  });

  it.each([
    ['empty body', undefined],
    ['non-JSON body', 'not json'],
    ['JSON without data', { result: 1 }],
  ])('rejects a 200 with %s as INVALID_RESPONSE', async (_label, body) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const error = await captureError(clientWith(fetchImpl).get('/x'));
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('maps fetch failures to NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await captureError(clientWith(fetchImpl).get('/x'));
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: null });
  });

  it('aborts and reports TIMEOUT when the server is too slow', async () => {
    const error = await captureError(clientWith(abortableFetch(), { timeoutMs: 10 }).get('/slow'));
    expect(error).toMatchObject({ code: 'TIMEOUT' });
  });

  it('propagates caller cancellation as the original abort error', async () => {
    const controller = new AbortController();
    const pending = clientWith(abortableFetch()).get('/x', { signal: controller.signal });
    controller.abort();
    const error = await captureError(pending);
    expect(error).not.toBeInstanceOf(ApiClientError);
    expect(error.name).toBe('AbortError');
  });
});
