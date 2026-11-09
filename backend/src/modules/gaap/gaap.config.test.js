import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadGaapConfig } from './gaap.config.js';

const KEY = 'fixture-secret-key-0001';
const valid = { GAAP_API_KEY: KEY, GAAP_API_BASE_URL: 'https://gaap.test/' };

describe('loadGaapConfig', () => {
  it('applies defaults and trims the trailing slash', () => {
    const config = loadGaapConfig(valid);
    assert.equal(config.baseUrl, 'https://gaap.test');
    assert.equal(config.timeoutMs, 30_000);
    assert.equal(config.maxConcurrency, 3);
    assert.equal(config.maxRetries, 2);
    assert.equal(config.apiKey, KEY);
    assert.ok(Object.isFrozen(config));
  });

  it('keeps the key out of serialization and enumeration', () => {
    const config = loadGaapConfig(valid);
    assert.ok(!JSON.stringify(config).includes(KEY));
    assert.ok(!Object.keys(config).includes('apiKey'));
    assert.ok(!JSON.stringify({ ...config }).includes(KEY));
  });

  it('reads numeric overrides', () => {
    const config = loadGaapConfig({
      ...valid,
      GAAP_TIMEOUT_MS: '5000',
      GAAP_MAX_CONCURRENCY: '5',
      GAAP_MAX_RETRIES: '0',
      GAAP_RETRY_BASE_DELAY_MS: '10',
    });
    assert.equal(config.timeoutMs, 5000);
    assert.equal(config.maxConcurrency, 5);
    assert.equal(config.maxRetries, 0);
    assert.equal(config.retryBaseDelayMs, 10);
  });

  it('allows http only for loopback hosts', () => {
    assert.doesNotThrow(() =>
      loadGaapConfig({ ...valid, GAAP_API_BASE_URL: 'http://127.0.0.1:9000' }),
    );
    assert.throws(
      () => loadGaapConfig({ ...valid, GAAP_API_BASE_URL: 'http://gaap.test' }),
      /must use https/,
    );
  });

  const invalidCases = [
    ['missing key', { GAAP_API_KEY: '  ' }, /GAAP_API_KEY is required/],
    ['missing base URL', { GAAP_API_BASE_URL: undefined }, /GAAP_API_BASE_URL is required/],
    ['relative base URL', { GAAP_API_BASE_URL: '/nodes' }, /absolute URL/],
    [
      'credentials in base URL',
      { GAAP_API_BASE_URL: 'https://user:pw@gaap.test' },
      /must not contain credentials/,
    ],
    [
      'query string in base URL',
      { GAAP_API_BASE_URL: 'https://gaap.test/?apikey=x' },
      /must not contain credentials/,
    ],
    ['non-numeric timeout', { GAAP_TIMEOUT_MS: 'abc' }, /GAAP_TIMEOUT_MS/],
    ['timeout too small', { GAAP_TIMEOUT_MS: '5' }, /GAAP_TIMEOUT_MS/],
    ['zero concurrency', { GAAP_MAX_CONCURRENCY: '0' }, /GAAP_MAX_CONCURRENCY/],
    ['too many retries', { GAAP_MAX_RETRIES: '50' }, /GAAP_MAX_RETRIES/],
    ['fractional retries', { GAAP_MAX_RETRIES: '1.5' }, /GAAP_MAX_RETRIES/],
  ];
  for (const [name, override, pattern] of invalidCases) {
    it(`rejects ${name}`, () => {
      assert.throws(() => loadGaapConfig({ ...valid, ...override }), pattern);
    });
  }

  it('never puts the key or a credentialed URL in error messages', () => {
    try {
      loadGaapConfig({
        GAAP_API_KEY: KEY,
        GAAP_API_BASE_URL: 'https://user:Sup3rSecret@gaap.test',
        GAAP_TIMEOUT_MS: 'abc',
      });
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(!error.message.includes(KEY));
      assert.ok(!error.message.includes('Sup3rSecret'));
    }
  });
});
