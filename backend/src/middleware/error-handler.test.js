import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { ApiError } from '../utils/api-error.js';
import { errorHandler } from './error-handler.js';
import { requestId } from './request-id.js';

function appThatThrows(error) {
  const app = express();
  app.use(requestId);
  app.get('/boom', async () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('returns ApiError status, code and message', async () => {
    const res = await request(appThatThrows(new ApiError(422, 'INVALID_INPUT', 'Bad input.'))).get(
      '/boom',
    );

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.equal(res.body.error.message, 'Bad input.');
  });

  it('hides internal details of unexpected errors behind a generic 500', async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    const res = await request(
      appThatThrows(new Error('connection string mongodb://user:secret@host')),
    ).get('/boom');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.equal(res.body.error.message, 'An unexpected error occurred.');
    assert.doesNotMatch(JSON.stringify(res.body), /secret|mongodb|stack/i);

    assert.equal(logged.mock.callCount(), 1);
    const entry = JSON.parse(logged.mock.calls[0].arguments[0]);
    assert.equal(entry.level, 'error');
    assert.equal(entry.requestId, res.headers['x-request-id']);
  });
});
