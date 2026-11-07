import express from 'express';

/**
 * Creates the Express application.
 * Bootstrap only: routes, CORS, error handling and the health endpoint are
 * added in Feature 02 (Backend Foundation).
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  return app;
}
