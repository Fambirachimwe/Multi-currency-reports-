import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from './app.js';

test('createApp starts an HTTP server that accepts connections', async () => {
  const server = createApp().listen(0);
  await once(server, 'listening');
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    // No routes exist yet (Feature 02 adds them), so Express answers 404.
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-powered-by'), null);
  } finally {
    server.close();
  }
});
