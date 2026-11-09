import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';

function buildApp(env = {}) {
  return createApp(loadConfig({ NODE_ENV: 'test', CORS_ORIGIN: ALLOWED_ORIGIN, ...env }));
}

function assertErrorEnvelope(body, code) {
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(typeof body.error.requestId, 'string');
  assert.equal(body.data, undefined);
  assert.equal(body.error.stack, undefined);
}

describe('GET /api/v1/health', () => {
  it('returns 200 with the success envelope and no secrets', async () => {
    const res = await request(buildApp()).get('/api/v1/health');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.data.status, 'ok');
    assert.equal(typeof res.body.data.uptimeSeconds, 'number');
    assert.ok(!Number.isNaN(Date.parse(res.body.data.timestamp)));
    assert.deepEqual(res.body.meta, {});
    assert.deepEqual(Object.keys(res.body.data).sort(), ['status', 'timestamp', 'uptimeSeconds']);
  });

  it('sets a request ID and hides x-powered-by', async () => {
    const res = await request(buildApp()).get('/api/v1/health');

    assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('reuses a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const app = buildApp();
    const kept = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-123');
    const replaced = await request(app)
      .get('/api/v1/health')
      .set('X-Request-Id', 'bad id <script>');

    assert.equal(kept.headers['x-request-id'], 'trace-123');
    assert.notEqual(replaced.headers['x-request-id'], 'bad id <script>');
  });
});

describe('unknown routes', () => {
  for (const path of ['/', '/api/v1/does-not-exist', '/api/v2/health']) {
    it(`returns a normalized 404 for ${path}`, async () => {
      const res = await request(buildApp()).get(path);

      assert.equal(res.status, 404);
      assertErrorEnvelope(res.body, 'NOT_FOUND');
      assert.equal(res.body.error.requestId, res.headers['x-request-id']);
    });
  }

  it('returns a normalized 404 for an unsupported method on a known path', async () => {
    const res = await request(buildApp()).delete('/api/v1/health');

    assert.equal(res.status, 404);
    assertErrorEnvelope(res.body, 'NOT_FOUND');
  });
});

describe('request body handling', () => {
  it('returns a controlled 400 for invalid JSON', async () => {
    const res = await request(buildApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');

    assert.equal(res.status, 400);
    assertErrorEnvelope(res.body, 'INVALID_JSON');
    assert.doesNotMatch(JSON.stringify(res.body), /SyntaxError|Unexpected/);
  });

  it('returns a controlled 413 when the JSON body exceeds the limit', async () => {
    const res = await request(buildApp({ JSON_BODY_LIMIT: '1kb' }))
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(2048) }));

    assert.equal(res.status, 413);
    assertErrorEnvelope(res.body, 'PAYLOAD_TOO_LARGE');
  });

  it('accepts an empty body without error', async () => {
    const res = await request(buildApp())
      .post('/api/v1/does-not-exist')
      .set('Content-Type', 'application/json');

    assert.equal(res.status, 404);
    assertErrorEnvelope(res.body, 'NOT_FOUND');
  });
});

describe('CORS allowlist', () => {
  it('allows a configured origin', async () => {
    const res = await request(buildApp()).get('/api/v1/health').set('Origin', ALLOWED_ORIGIN);

    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
  });

  it('answers a preflight from a configured origin', async () => {
    const res = await request(buildApp())
      .options('/api/v1/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
  });

  it('rejects an origin that is not on the allowlist', async () => {
    const res = await request(buildApp())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');

    assert.equal(res.status, 403);
    assertErrorEnvelope(res.body, 'CORS_ORIGIN_NOT_ALLOWED');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('allows requests without an Origin header', async () => {
    const res = await request(buildApp()).get('/api/v1/health');

    assert.equal(res.status, 200);
  });
});
