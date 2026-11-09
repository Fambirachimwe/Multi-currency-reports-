import { Router } from 'express';
import { createCatalogRouter } from './catalog.routes.js';
import { healthRouter } from './health.routes.js';
import { createNodeFiltersRouter } from './node-filters.routes.js';
import { createNodesRouter } from './nodes.routes.js';
import { createReportsRouter } from './reports.routes.js';

/**
 * Builds the version 1 API routes, mounted at /api/v1.
 * @param {object} [services] Application services. A route whose service is absent is not mounted.
 * @param {{ listNodes: Function }} [services.nodes]
 * @param {{ listDepartments: Function }} [services.catalog]
 */
export function createApiV1Router({ nodes, catalog, nodeFilters, reports } = {}) {
  const router = Router();
  router.use('/health', healthRouter);
  if (reports !== undefined) {
    router.use('/reports', createReportsRouter(reports));
  }
  if (nodeFilters !== undefined) {
    router.use('/filters', createNodeFiltersRouter(nodeFilters));
  }
  if (nodes !== undefined) {
    router.use('/nodes', createNodesRouter(nodes));
  }
  if (catalog !== undefined) {
    router.use('/catalog', createCatalogRouter(catalog));
  }
  return router;
}
