import { Router } from 'express';
import { createNodeFiltersHandlers } from '../controllers/node-filters.controller.js';

/** @param {object} service from `createNodeFiltersService` */
export function createNodeFiltersRouter(service) {
  const handlers = createNodeFiltersHandlers(service);
  const router = Router();
  router.get('/nodes', handlers.getOptions);
  router.post('/nodes/resolve', handlers.resolve);
  return router;
}
