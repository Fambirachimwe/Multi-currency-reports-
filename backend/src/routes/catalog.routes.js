import { Router } from 'express';
import { createCatalogHandlers } from '../controllers/catalog.controller.js';

/** @param {object} catalogService from `createCatalogService` */
export function createCatalogRouter(catalogService) {
  const handlers = createCatalogHandlers(catalogService);
  const router = Router();
  router.get('/departments', handlers.listDepartments);
  router.get('/departments/:departmentId/products', handlers.listDepartmentProducts);
  router.get('/products/unmapped', handlers.listUnmappedProducts);
  router.post('/products/validate', handlers.validateProducts);
  // Explicit, user-triggered GAAP read; the only way the stored catalog is replaced.
  router.post('/refresh', handlers.refresh);
  return router;
}
