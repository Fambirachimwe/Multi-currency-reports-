import { Router } from 'express';
import { createReportsHandlers } from '../controllers/reports.controller.js';

/** @param {object} service from `createReportsService` */
export function createReportsRouter(service) {
  const handlers = createReportsHandlers(service);
  const router = Router();
  router.get('/', handlers.list);
  router.post('/', handlers.create);
  router.get('/:reportId/status', handlers.status);
  router.get('/:reportId/rows', handlers.rows);
  router.get('/:reportId/export', handlers.exportWorkbook);
  router.get('/:reportId', handlers.detail);
  router.delete('/:reportId', handlers.cancel);
  return router;
}
