import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase, loadDatabaseConfig } from './config/database.js';
import { loadConfig } from './config/env.js';
import { ensureModelIndexes } from './models/index.js';
import {
  createCatalogCacheRepository,
  createNodesCacheRepository,
  loadCatalogCacheConfig,
  loadNodesCacheConfig,
  loadSalesCachePolicy,
} from './modules/cache/index.js';
import {
  createCatalogService,
  createNodeFiltersService,
  createNodesService,
} from './modules/catalog/index.js';
import { createReportExporter } from './modules/exports/index.js';
import {
  createCatalogAdapter,
  createGaapClient,
  createNodesAdapter,
  createSalesAdapter,
  loadGaapConfig,
} from './modules/gaap/index.js';
import {
  createReportExecution,
  createReportRepository,
  createReportsService,
  loadReportExecutionConfig,
  loadReportLimits,
} from './modules/reports/index.js';
import { logger } from './utils/logger.js';

let config;
let databaseConfig;
let services;
let reportExecution;
try {
  config = loadConfig();
  databaseConfig = loadDatabaseConfig();
  const gaapClient = createGaapClient({ config: loadGaapConfig() });
  const nodesConfig = loadNodesCacheConfig();
  const catalogConfig = loadCatalogCacheConfig();
  // Sales are never cached in v1; this aborts startup if someone tries to enable it.
  const salesCachePolicy = loadSalesCachePolicy();
  const nodes = createNodesService({
    nodesAdapter: createNodesAdapter({ client: gaapClient }),
    repository: createNodesCacheRepository({ ttlMs: nodesConfig.ttlMs }),
    refreshPolicy: nodesConfig.refreshPolicy,
    retryCooldownMs: nodesConfig.retryCooldownMs,
  });
  const nodeFilters = createNodeFiltersService({ nodesService: nodes });
  const catalog = createCatalogService({
    catalogAdapter: createCatalogAdapter({
      client: gaapClient,
    }),
    repository: createCatalogCacheRepository({ ttlMs: catalogConfig.ttlMs }),
    refreshPolicy: catalogConfig.refreshPolicy,
    retryCooldownMs: catalogConfig.retryCooldownMs,
  });
  const reportRepository = createReportRepository();
  reportExecution = createReportExecution({
    repository: reportRepository,
    salesAdapter: createSalesAdapter({ client: gaapClient }),
    salesCachePolicy,
    config: loadReportExecutionConfig(),
  });
  services = {
    nodes,
    nodeFilters,
    catalog,
    reports: createReportsService({
      catalogService: catalog,
      nodeFiltersService: nodeFilters,
      limits: loadReportLimits(),
      startReport: reportExecution.startReport,
      getReportStatus: reportExecution.getStatus,
      cancelReport: reportExecution.cancelReport,
      listReports: reportRepository.list,
      getReport: reportRepository.getDetail,
      listReportRows: reportRepository.listRows,
      // Export reads saved MongoDB data only: no GAAP adapter or client is passed to it.
      prepareReportExport: createReportExporter({
        getReport: reportRepository.getDetail,
        streamRows: reportRepository.streamRows,
      }).prepare,
    }),
  };
} catch (error) {
  // Messages from both loaders are written to exclude secret values.
  logger.error('Startup aborted', { errorMessage: error.message });
  process.exit(1);
}

try {
  await connectDatabase(databaseConfig);
  await ensureModelIndexes();
} catch (error) {
  // Connection errors are already logged with the error class only. Index-creation errors
  // carry server messages (no credentials), so the reason goes in the visible log text too.
  logger.error(`Startup aborted: ${error.message}`, { errorName: error.name });
  process.exit(1);
}

const server = createApp(config, services).listen(config.port, () => {
  logger.info('Backend listening', { port: config.port, nodeEnv: config.nodeEnv });
});

function shutdown(signal) {
  logger.info('Shutting down', { signal });
  server.close(async () => {
    // Running reports are recorded as interrupted before the database goes away.
    await reportExecution.stop().catch(() => {});
    await disconnectDatabase().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
