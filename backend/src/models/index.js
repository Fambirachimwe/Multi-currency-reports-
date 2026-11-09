import { CatalogCache } from './catalog-cache.model.js';
import { ReportRow } from './report-row.model.js';
import { Report } from './report.model.js';

export { CatalogCache, Report, ReportRow };
export { CURRENCY_UNKNOWN } from './shared.js';

const MODELS = [Report, ReportRow, CatalogCache];

/**
 * Creates every declared index. Call once after connecting (the connection
 * runs with autoIndex off). Safe to repeat.
 */
export async function ensureModelIndexes() {
  await Promise.all(MODELS.map((model) => model.createIndexes()));
}
