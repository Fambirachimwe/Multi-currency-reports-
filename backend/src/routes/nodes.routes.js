import { Router } from 'express';
import { createListNodesHandler } from '../controllers/nodes.controller.js';

/** @param {{ listNodes: Function, refreshNodes: Function }} nodesService */
export function createNodesRouter(nodesService) {
  const router = Router();
  router.get('/', createListNodesHandler(nodesService));
  // Explicit, user-triggered GAAP call; the only way stored nodes are replaced.
  router.post('/refresh', createListNodesHandler(nodesService, { refresh: true }));
  return router;
}
