import express from 'express';
import { corsAllowlist } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { createApiV1Router } from './routes/index.js';

/**
 * Creates the Express application.
 * @param {import('./config/env.js').AppConfig} config
 * @param {Parameters<typeof createApiV1Router>[0]} [services] Application services (injected so tests can fake GAAP).
 * @returns {import('express').Express}
 */
export function createApp(config, services = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(corsAllowlist(config.corsOrigins));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use('/api/v1', createApiV1Router(services));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
