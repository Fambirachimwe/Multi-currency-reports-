import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from './env.js';

describe('loadConfig', () => {
  it('applies development defaults when nothing is set', () => {
    const config = loadConfig({});

    assert.deepEqual(
      { ...config, corsOrigins: [...config.corsOrigins] },
      {
        nodeEnv: 'development',
        port: 4000,
        corsOrigins: ['http://localhost:5173'],
        jsonBodyLimit: '100kb',
      },
    );
  });

  it('parses a comma-separated CORS allowlist', () => {
    const config = loadConfig({ CORS_ORIGIN: 'https://a.example, https://b.example:8443' });

    assert.deepEqual([...config.corsOrigins], ['https://a.example', 'https://b.example:8443']);
  });

  it('returns a frozen object', () => {
    assert.ok(Object.isFrozen(loadConfig({})));
  });

  const invalidCases = [
    [{ PORT: 'abc' }, /PORT/],
    [{ PORT: '70000' }, /PORT/],
    [{ NODE_ENV: 'staging' }, /NODE_ENV/],
    [{ CORS_ORIGIN: 'https://a.example/path' }, /CORS_ORIGIN/],
    [{ CORS_ORIGIN: '*' }, /CORS_ORIGIN/],
    [{ JSON_BODY_LIMIT: 'lots' }, /JSON_BODY_LIMIT/],
    [{ NODE_ENV: 'production' }, /CORS_ORIGIN is required in production/],
  ];

  for (const [env, pattern] of invalidCases) {
    it(`fails fast for ${JSON.stringify(env)}`, () => {
      assert.throws(() => loadConfig(env), pattern);
    });
  }

  it('reports every problem at once', () => {
    assert.throws(
      () => loadConfig({ PORT: 'x', JSON_BODY_LIMIT: 'y' }),
      (error) => /PORT/.test(error.message) && /JSON_BODY_LIMIT/.test(error.message),
    );
  });
});
