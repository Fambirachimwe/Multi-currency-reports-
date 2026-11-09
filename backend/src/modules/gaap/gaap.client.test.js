/**
 * GAAP client tests. Two kinds of evidence, both OFFLINE:
 *  - FIXTURE tests use a scripted Axios adapter that returns canned responses.
 *    They are mocks: they prove the client's own behaviour, not that GAAP behaves this way.
 *  - LOOPBACK tests talk to a throwaway HTTP server on 127.0.0.1 so real Axios
 *    timeout, redirect and connection behaviour is exercised.
 * Neither is live GAAP integration evidence. No real credentials are used.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, describe, it } from 'node:test';
import axios from 'axios';
import { createGaapClient } from './gaap.client.js';
import { loadGaapConfig } from './gaap.config.js';
import { GAAP_ERROR_CODES as CODES, GaapError } from './gaap.errors.js';

const KEY = 'fixture-secret-key-0001';

function makeConfig(overrides = {}) {
  return loadGaapConfig({
    GAAP_API_KEY: KEY,
    GAAP_API_BASE_URL: 'https://gaap.test',
    GAAP_RETRY_BASE_DELAY_MS: '100',
    ...overrides,
  });
}

function memoryLogger() {
  const lines = [];
  const push = (level) => (message, fields) => lines.push({ level, message, ...fields });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

/**
 * Scripted adapter: each call consumes the next step (the last step repeats).
 * Step shapes: { status, data, headers } or { error: 'timeout' | 'network' }.
 */
function scriptedAdapter(steps, { delayMs = 0 } = {}) {
  const calls = [];
  let active = 0;
  const stats = { calls, maxActive: 0 };
  const adapter = async (config) => {
    calls.push({
      method: config.method,
      url: config.url,
      params: { ...config.params },
      hasSignal: config.signal !== undefined,
    });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    active += 1;
    stats.maxActive = Math.max(stats.maxActive, active);
    try {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (step.error === 'timeout') {
        throw new axios.AxiosError(
          'timeout of 100ms exceeded',
          'ECONNABORTED',
          config,
          // The real message can carry the URL (and key) in other failure modes; make it leak-prone.
          { url: `https://gaap.test${config.url}?apikey=${KEY}` },
        );
      }
      if (step.error === 'network') {
        throw new axios.AxiosError(
          `connect ECONNREFUSED https://gaap.test${config.url}?apikey=${KEY}`,
          'ECONNREFUSED',
          config,
        );
      }
      const response = {
        status: step.status,
        statusText: '',
        data: step.data,
        headers: step.headers ?? {},
        config,
        request: {},
      };
      if (step.status >= 400) {
        throw new axios.AxiosError(
          `Request failed with status code ${step.status} for ?apikey=${KEY}`,
          'ERR_BAD_RESPONSE',
          config,
          {},
          response,
        );
      }
      return response;
    } finally {
      active -= 1;
    }
  };
  return { adapter, stats };
}

function build(steps, { config = makeConfig(), adapterOptions, logger = memoryLogger() } = {}) {
  const { adapter, stats } = scriptedAdapter(steps, adapterOptions);
  const sleeps = [];
  const client = createGaapClient({
    config,
    logger,
    adapter,
    random: () => 1,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, stats, sleeps, logger };
}

const OK = { status: 200, data: { items: [] } };

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GaapError, `expected GaapError, got ${error?.name}`);
    return error;
  }
  return assert.fail('expected the request to reject');
}

function assertNoSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!text.includes(KEY), 'the API key leaked');
  assert.ok(!/apikey=/i.test(text), 'a query string with apikey leaked');
}

describe('GAAP client (FIXTURE adapter, not live GAAP)', () => {
  describe('requests', () => {
    it('returns parsed data and sends the key as a server-side query param', async () => {
      const { client, stats } = build([{ status: 200, data: { nodes: [1, 2] } }]);
      const result = await client.get('/nodes', { limit: 10, flag: true, skipped: undefined });
      assert.deepEqual(result.data, { nodes: [1, 2] });
      assert.equal(result.status, 200);
      assert.equal(result.attempts, 1);
      assert.equal(stats.calls.length, 1);
      assert.equal(stats.calls[0].url, '/nodes');
      assert.deepEqual(stats.calls[0].params, { limit: 10, flag: true, apikey: KEY });
    });

    it('accepts array bodies as valid JSON', async () => {
      const { client } = build([{ status: 200, data: [] }]);
      assert.deepEqual((await client.get('/nodes')).data, []);
    });

    const invalidRequests = [
      ['absolute URL path', { path: 'https://evil.test/x' }],
      ['protocol-relative path', { path: '//evil.test/x' }],
      ['path without leading slash', { path: 'nodes' }],
      ['path with query string', { path: '/nodes?apikey=x' }],
      ['path with parent segment', { path: '/a/../b' }],
      ['non-string path', { path: 42 }],
      ['reserved apikey param', { path: '/nodes', params: { apikey: 'x' } }],
      ['reserved apikey param, any case', { path: '/nodes', params: { ApiKey: 'x' } }],
      ['array param', { path: '/nodes', params: { ids: [1, 2] } }],
      ['null param', { path: '/nodes', params: { a: null } }],
      ['non-object params', { path: '/nodes', params: 'a=b' }],
      ['unsupported method', { path: '/nodes', method: 'TRACE' }],
    ];
    for (const [name, req] of invalidRequests) {
      it(`rejects ${name} without calling GAAP`, async () => {
        const { client, stats } = build([OK]);
        const error = await rejection(client.request(req));
        assert.equal(error.code, CODES.INVALID_REQUEST);
        assert.equal(error.retryable, false);
        assert.equal(stats.calls.length, 0);
      });
    }
  });

  describe('error normalization', () => {
    const cases = [
      [400, CODES.BAD_REQUEST],
      [401, CODES.AUTH],
      [403, CODES.AUTH],
      [404, CODES.NOT_FOUND],
      [422, CODES.BAD_REQUEST],
      [500, CODES.UPSTREAM],
      [501, CODES.UPSTREAM],
    ];
    for (const [status, code] of cases) {
      it(`maps HTTP ${status} to ${code} without retrying`, async () => {
        const { client, stats, sleeps } = build([{ status, data: { message: `secret ${KEY}` } }]);
        const error = await rejection(client.get('/sales'));
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        assert.equal(error.retryable, false);
        assert.equal(error.attempts, 1);
        assert.equal(error.path, '/sales');
        assert.equal(stats.calls.length, 1);
        assert.equal(sleeps.length, 0);
      });
    }

    it('flags invalid bodies as GAAP_INVALID_RESPONSE and does not retry', async () => {
      for (const data of ['<html>oops</html>', '', undefined, null, 42]) {
        const { client, stats } = build([{ status: 200, data }]);
        const error = await rejection(client.get('/nodes'));
        assert.equal(error.code, CODES.INVALID_RESPONSE);
        assert.equal(stats.calls.length, 1);
      }
    });

    it('treats a 3xx as an invalid response (redirects are never followed)', async () => {
      const { client } = build([
        { status: 302, data: {}, headers: { location: 'https://x.test' } },
      ]);
      const error = await rejection(client.get('/nodes'));
      assert.equal(error.code, CODES.INVALID_RESPONSE);
      assert.equal(error.status, 302);
    });

    it('never exposes the key, URL, response body or Axios error', async () => {
      const { client, logger } = build([{ status: 500, data: { echo: KEY } }]);
      const error = await rejection(client.get('/sales', { from: '20261105' }));
      assertNoSecret(error.message);
      assertNoSecret(error.stack);
      assertNoSecret(JSON.stringify(error));
      assert.equal(error.cause, undefined);
      assert.equal(error.config, undefined);
      assert.equal(error.response, undefined);
      assertNoSecret(logger.lines);
    });

    it('also hides the key when the underlying error text contains it', async () => {
      const { client, logger } = build([{ error: 'network' }], {
        config: makeConfig({ GAAP_MAX_RETRIES: '0' }),
      });
      const error = await rejection(client.get('/nodes'));
      assert.equal(error.code, CODES.NETWORK);
      assertNoSecret(error.message);
      assertNoSecret(JSON.stringify(error));
      assertNoSecret(logger.lines);
    });

    it('wraps unexpected non-Axios errors as GaapError', async () => {
      const client = createGaapClient({
        config: makeConfig({ GAAP_MAX_RETRIES: '0' }),
        logger: memoryLogger(),
        adapter: async () => {
          throw new TypeError(`boom ${KEY}`);
        },
      });
      const error = await rejection(client.get('/nodes'));
      assert.equal(error.code, CODES.NETWORK);
      assert.equal(error.retryable, false);
      assertNoSecret(error.message);
    });
  });

  describe('retries', () => {
    it('retries transient 503 and then succeeds', async () => {
      const { client, stats, sleeps } = build([{ status: 503, data: {} }, OK]);
      const result = await client.get('/nodes');
      assert.equal(result.attempts, 2);
      assert.equal(stats.calls.length, 2);
      assert.equal(sleeps.length, 1);
    });

    for (const status of [429, 502, 503, 504, 408]) {
      it(`treats HTTP ${status} as transient`, async () => {
        const { client, stats } = build([{ status, data: {} }, OK]);
        await client.get('/nodes');
        assert.equal(stats.calls.length, 2);
      });
    }

    it('stops after maxRetries and reports the attempts used', async () => {
      const { client, stats, sleeps } = build([{ status: 503, data: {} }]);
      const error = await rejection(client.get('/nodes'));
      assert.equal(stats.calls.length, 3, '1 attempt + 2 retries');
      assert.equal(error.attempts, 3);
      assert.equal(error.code, CODES.UNAVAILABLE);
      assert.equal(error.retryable, true);
      assert.equal(sleeps.length, 2);
    });

    it('honours a lower and a higher maxRetries', async () => {
      const none = build([{ status: 503, data: {} }], {
        config: makeConfig({ GAAP_MAX_RETRIES: '0' }),
      });
      await rejection(none.client.get('/nodes'));
      assert.equal(none.stats.calls.length, 1);

      const five = build([{ status: 503, data: {} }], {
        config: makeConfig({ GAAP_MAX_RETRIES: '5' }),
      });
      await rejection(five.client.get('/nodes'));
      assert.equal(five.stats.calls.length, 6);
    });

    it('uses exponential backoff, capped', async () => {
      const { client, sleeps } = build([{ status: 503, data: {} }], {
        config: makeConfig({ GAAP_MAX_RETRIES: '5', GAAP_RETRY_BASE_DELAY_MS: '1000' }),
      });
      await rejection(client.get('/nodes'));
      assert.deepEqual(sleeps, [1000, 2000, 4000, 5000, 5000]);
    });

    it('applies jitter within 50-100% of the delay', async () => {
      const { adapter } = scriptedAdapter([{ status: 503, data: {} }]);
      const sleeps = [];
      const client = createGaapClient({
        config: makeConfig({ GAAP_MAX_RETRIES: '1' }),
        logger: memoryLogger(),
        adapter,
        random: () => 0,
        sleep: async (ms) => sleeps.push(ms),
      });
      await rejection(client.get('/nodes'));
      assert.deepEqual(sleeps, [50]);
    });

    it('waits for Retry-After on 429 but never longer than the cap', async () => {
      const short = build([{ status: 429, data: {}, headers: { 'retry-after': '2' } }, OK]);
      await short.client.get('/nodes');
      assert.deepEqual(short.sleeps, [2000]);

      const long = build([{ status: 429, data: {}, headers: { 'retry-after': '3600' } }, OK]);
      await long.client.get('/nodes');
      assert.deepEqual(long.sleeps, [5000]);
    });

    it('retries timeouts and reports GAAP_TIMEOUT when exhausted', async () => {
      const { client, stats } = build([{ error: 'timeout' }]);
      const error = await rejection(client.get('/sales'));
      assert.equal(error.code, CODES.TIMEOUT);
      assert.equal(error.retryable, true);
      assert.equal(error.attempts, 3);
      assert.equal(stats.calls.length, 3);
    });

    it('recovers from one network error', async () => {
      const { client } = build([{ error: 'network' }, OK]);
      assert.equal((await client.get('/nodes')).attempts, 2);
    });

    it('does not retry non-idempotent requests by default', async () => {
      const { client, stats } = build([{ status: 503, data: {} }, OK]);
      const error = await rejection(client.request({ method: 'POST', path: '/x', data: {} }));
      assert.equal(error.attempts, 1);
      assert.equal(stats.calls.length, 1);
    });

    it('retries a POST only when declared idempotent', async () => {
      const { client, stats } = build([{ status: 503, data: {} }, OK]);
      await client.request({ method: 'POST', path: '/x', data: {}, idempotent: true });
      assert.equal(stats.calls.length, 2);
    });

    it('logs retries and the final failure with the path only', async () => {
      const { client, logger } = build([{ status: 503, data: {} }]);
      await rejection(client.get('/sales', { from: '20261105' }, { requestId: 'req-1' }));
      const levels = logger.lines.map((line) => line.level);
      assert.deepEqual(levels, ['warn', 'warn', 'error']);
      assert.ok(logger.lines.every((line) => line.path === '/sales' && line.requestId === 'req-1'));
      assertNoSecret(logger.lines);
      assert.ok(
        !JSON.stringify(logger.lines).includes('20261105'),
        'query values must not be logged',
      );
    });
  });

  describe('concurrency and cancellation', () => {
    it('never has more than maxConcurrency requests in flight', async () => {
      const { client, stats } = build([OK], {
        config: makeConfig({ GAAP_MAX_CONCURRENCY: '2' }),
        adapterOptions: { delayMs: 15 },
      });
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => client.get('/sales', { page: i })),
      );
      assert.equal(results.length, 8);
      assert.equal(stats.calls.length, 8);
      assert.equal(stats.maxActive, 2);
    });

    it('frees the concurrency slot after a failure', async () => {
      const { client, stats } = build([{ status: 404, data: {} }, OK], {
        config: makeConfig({ GAAP_MAX_CONCURRENCY: '1' }),
      });
      await rejection(client.get('/a'));
      await client.get('/b');
      assert.equal(stats.calls.length, 2);
    });

    it('rejects immediately when the signal is already aborted', async () => {
      const { client, stats } = build([OK]);
      const controller = new AbortController();
      controller.abort();
      const error = await rejection(client.get('/nodes', {}, { signal: controller.signal }));
      assert.equal(error.code, CODES.ABORTED);
      assert.equal(stats.calls.length, 0);
    });

    it('stops retrying when aborted during backoff', async () => {
      const { adapter, stats } = scriptedAdapter([{ status: 503, data: {} }]);
      const client = createGaapClient({
        config: makeConfig({ GAAP_RETRY_BASE_DELAY_MS: '5000' }),
        logger: memoryLogger(),
        adapter,
      });
      const controller = new AbortController();
      const pending = client.get('/nodes', {}, { signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      const started = Date.now();
      const error = await rejection(pending);
      assert.equal(error.code, CODES.ABORTED);
      assert.equal(stats.calls.length, 1);
      assert.ok(Date.now() - started < 1000, 'must not wait out the backoff');
    });
  });
});

describe('GAAP client (LOOPBACK server, real Axios, not live GAAP)', () => {
  const servers = [];

  function listen(handler) {
    return new Promise((resolve) => {
      const hits = { count: 0, urls: [] };
      const server = http.createServer((req, res) => {
        hits.count += 1;
        hits.urls.push(req.url);
        handler(req, res, hits);
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () =>
        resolve({ hits, baseUrl: `http://127.0.0.1:${server.address().port}` }),
      );
    });
  }

  function realClient(baseUrl, env = {}) {
    return createGaapClient({
      config: loadGaapConfig({
        GAAP_API_KEY: KEY,
        GAAP_API_BASE_URL: baseUrl,
        GAAP_RETRY_BASE_DELAY_MS: '0',
        ...env,
      }),
      logger: memoryLogger(),
    });
  }

  after(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          }),
      ),
    );
  });

  it('sends the key as a query param and parses JSON', async () => {
    const { baseUrl, hits } = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
    const result = await realClient(baseUrl).get('/nodes', { limit: 5 });
    assert.deepEqual(result.data, { ok: true });
    const url = new URL(hits.urls[0], 'http://x');
    assert.equal(url.searchParams.get('apikey'), KEY);
    assert.equal(url.searchParams.get('limit'), '5');
  });

  it('times out on a server that never answers, retrying within the bound', async () => {
    const { baseUrl, hits } = await listen(() => {
      /* never respond */
    });
    const client = realClient(baseUrl, { GAAP_TIMEOUT_MS: '100', GAAP_MAX_RETRIES: '1' });
    const started = Date.now();
    const error = await rejection(client.get('/sales'));
    assert.equal(error.code, CODES.TIMEOUT);
    assert.equal(error.attempts, 2);
    assert.equal(hits.count, 2);
    assert.ok(Date.now() - started < 3000);
    assertNoSecret(error.message);
  });

  it('recovers when a 503 is followed by success', async () => {
    const { baseUrl, hits } = await listen((req, res, h) => {
      res.setHeader('content-type', 'application/json');
      if (h.count === 1) {
        res.statusCode = 503;
        res.end('{}');
      } else {
        res.end('{"ok":true}');
      }
    });
    const result = await realClient(baseUrl).get('/nodes');
    assert.equal(result.attempts, 2);
    assert.equal(hits.count, 2);
  });

  it('does not follow redirects, so the key is never forwarded', async () => {
    const target = await listen((req, res) => res.end('{"leaked":true}'));
    const origin = await listen((req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${target.baseUrl}/steal?apikey=${KEY}`);
      res.end();
    });
    const error = await rejection(realClient(origin.baseUrl).get('/nodes'));
    assert.equal(error.code, CODES.INVALID_RESPONSE);
    assert.equal(target.hits.count, 0);
  });

  it('reports a refused connection as GAAP_NETWORK_ERROR after bounded retries', async () => {
    const { baseUrl } = await listen(() => {});
    const closed = new URL(baseUrl);
    // Port 1 on loopback is reliably closed.
    const client = realClient(`http://${closed.hostname}:1`, { GAAP_MAX_RETRIES: '2' });
    const error = await rejection(client.get('/nodes'));
    assert.equal(error.code, CODES.NETWORK);
    assert.equal(error.attempts, 3);
    assertNoSecret(error.message);
  });

  it('rejects an HTML 200 body as invalid', async () => {
    const { baseUrl } = await listen((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<html>maintenance</html>');
    });
    const error = await rejection(realClient(baseUrl).get('/nodes'));
    assert.equal(error.code, CODES.INVALID_RESPONSE);
  });
});
