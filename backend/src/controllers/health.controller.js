import { getHealthStatus } from '../modules/system/health.service.js';
import { sendSuccess } from '../utils/http-response.js';

export function getHealth(req, res) {
  sendSuccess(res, getHealthStatus());
}
