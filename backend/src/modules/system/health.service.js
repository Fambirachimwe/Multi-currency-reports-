/**
 * Process liveness information. Deliberately contains no configuration,
 * secrets or database details.
 * @param {() => Date} [now]
 * @returns {{ status: 'ok', uptimeSeconds: number, timestamp: string }}
 */
export function getHealthStatus(now = () => new Date()) {
  return {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: now().toISOString(),
  };
}
