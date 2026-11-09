import { GAAP_ERROR_CODES, GaapError } from './gaap.errors.js';

/**
 * Catalog adapter: reads the product master from GAAP `GET /products`.
 *
 * SOURCE: endpoint and sample payload supplied by the project owner (2026-11-07). Fields used:
 *  - `_id` product ID, `name`, `primaryCode`, `status` (boolean), `isDeleted` (boolean).
 *  - `departments[]`: `{ departmentGroup, departmentInGroup, departmentGroupName,
 *    departmentInGroupName }`. The `...InGroup` naming states that a department belongs to a
 *    group. In the sample every product has one entry per group ("POS Department" and
 *    "Reporting"), so a product normally has one department per group.
 *  - `limit` is accepted. `skip` paging and `totalRecords` semantics are ASSUMED to match
 *    `/nodes` (see below); on `/sales` `totalRecords` equalled the page size, so it is never
 *    trusted here: paging stops on a short page.
 *
 * Everything else in the payload (pricing, recipes, tags, ...) is deliberately never read, so
 * it can never be stored or returned.
 */

export const PRODUCTS_PATH = '/products';
export const CATALOG_PAGE_SIZE = 1000;
/**
 * Only departments of this group are exposed (owner decision, 2026-11-07). Matched on the
 * group's name, case-insensitively. Other groups (e.g. "Reporting") are ignored.
 */
export const DEFAULT_DEPARTMENT_GROUP = 'POS Department';
export const CATALOG_MAX_PAGES = 50;

export const INCOMPLETE_REASONS = Object.freeze({
  /** The page cap was reached while GAAP still returned full pages. */
  PAGE_CAP_REACHED: 'PAGE_CAP_REACHED',
});

export const CATALOG_WARNINGS = Object.freeze({
  /** Product has no valid department entry: membership is unknown, not guessed. */
  UNMAPPED_DEPARTMENT: 'UNMAPPED_DEPARTMENT',
  /** An entry in `departments[]` was unusable (not an object or no department id). */
  INVALID_DEPARTMENT_ENTRY: 'INVALID_DEPARTMENT_ENTRY',
  MISSING_NAME: 'MISSING_NAME',
  /** One department ID was seen with more than one name (the alphabetically first is kept). */
  NAME_CONFLICT: 'NAME_CONFLICT',
  /** One department was seen under more than one group (the alphabetically first is kept). */
  GROUP_CONFLICT: 'GROUP_CONFLICT',
});

export const MALFORMED_REASONS = Object.freeze({
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  MISSING_ID: 'MISSING_ID',
  DUPLICATE_ID: 'DUPLICATE_ID',
});

/**
 * @typedef {object} CatalogDepartment
 * @property {string} id GAAP `departmentInGroup`.
 * @property {string|null} name
 * @property {string|null} groupId GAAP `departmentGroup`.
 * @property {string|null} groupName
 * @property {number} productCount Distinct products in this department.
 * @property {string[]} warnings
 *
 * @typedef {object} CatalogProduct
 * @property {string} id GAAP `_id`.
 * @property {string|null} name
 * @property {string|null} code GAAP `primaryCode`; not verified as unique.
 * @property {string[]} departmentIds Sorted. Empty when the mapping is unknown.
 * @property {boolean} mapped False when no valid department was given. Never guessed.
 * @property {string[]} warnings
 *
 * @typedef {object} MalformedProduct
 * @property {number} index Position in the combined GAAP result.
 * @property {string} reason One of {@link MALFORMED_REASONS}.
 * @property {string|null} id
 *
 * @typedef {object} CatalogResult
 * @property {CatalogDepartment[]} departments Sorted by name, then id.
 * @property {CatalogProduct[]} products Sorted by name, then id.
 * @property {MalformedProduct[]} malformed
 * @property {{ source: 'products', departmentGroup: string, pages: number,
 *   recordsScanned: number, excludedInactive: number, truncated: boolean }} scan
 * @property {boolean} complete False only when the page cap was hit.
 * @property {string[]} incompleteReasons
 * @property {string} fetchedAt ISO 8601 instant.
 */

/**
 * @param {object} options
 * @param {{ get: Function }} options.client GAAP client from `createGaapClient`.
 * @param {number} [options.pageSize]
 * @param {number} [options.maxPages]
 * @param {() => Date} [options.now]
 */
export function createCatalogAdapter({
  client,
  pageSize = CATALOG_PAGE_SIZE,
  maxPages = CATALOG_MAX_PAGES,
  departmentGroup = DEFAULT_DEPARTMENT_GROUP,
  now = () => new Date(),
}) {
  /**
   * @param {{ signal?: AbortSignal, requestId?: string }} [options]
   * @returns {Promise<CatalogResult>}
   * @throws {GaapError}
   */
  async function fetchCatalog({ signal, requestId } = {}) {
    const records = [];
    let pages = 0;
    let truncated = false;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await client.get(
        PRODUCTS_PATH,
        { limit: pageSize, skip: page * pageSize },
        { signal, requestId },
      );
      const batch = parsePage(response.data);
      pages += 1;
      records.push(...batch);
      if (batch.length < pageSize) {
        break;
      }
      truncated = page === maxPages - 1;
    }

    const { departments, products, malformed, excludedInactive } = normalizeCatalog(records, {
      departmentGroup,
    });
    return {
      departments,
      products,
      malformed,
      scan: {
        source: 'products',
        departmentGroup,
        pages,
        recordsScanned: records.length,
        excludedInactive,
        truncated,
      },
      complete: !truncated,
      incompleteReasons: truncated ? [INCOMPLETE_REASONS.PAGE_CAP_REACHED] : [],
      fetchedAt: now().toISOString(),
    };
  }

  return Object.freeze({ fetchCatalog });
}

function parsePage(body) {
  const isEnvelope = body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!isEnvelope || !Array.isArray(body.data)) {
    throw new GaapError({
      code: GAAP_ERROR_CODES.INVALID_RESPONSE,
      message: 'GAAP products response did not contain a data array',
      method: 'GET',
      path: PRODUCTS_PATH,
    });
  }
  return body.data;
}

/**
 * Pure normalization of product records into departments and products. Only whitelisted fields
 * are read. Never throws: bad records are reported in `malformed`, never dropped silently. A
 * repeated product `_id` keeps the first record and reports the rest as DUPLICATE_ID.
 * Inactive products (`status` not true) and deleted ones (`isDeleted` true) are excluded and only
 * counted in `excludedInactive`. Only department entries whose group name equals `departmentGroup`
 * are used; entries of other groups are ignored.
 * @param {unknown[]} records
 * @param {{ departmentGroup?: string }} [options]
 * @returns {{ departments: CatalogDepartment[], products: CatalogProduct[],
 *   malformed: MalformedProduct[], excludedInactive: number }}
 */
export function normalizeCatalog(records, { departmentGroup = DEFAULT_DEPARTMENT_GROUP } = {}) {
  const wantedGroup = departmentGroup.trim().toLowerCase();
  let excludedInactive = 0;
  const products = [];
  const malformed = [];
  const departmentAcc = new Map();
  const seen = new Set();

  records.forEach((record, index) => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      malformed.push({ index, reason: MALFORMED_REASONS.NOT_AN_OBJECT, id: null });
      return;
    }
    const id = cleanString(record._id);
    if (id === null) {
      malformed.push({ index, reason: MALFORMED_REASONS.MISSING_ID, id: null });
      return;
    }
    if (seen.has(id)) {
      malformed.push({ index, reason: MALFORMED_REASONS.DUPLICATE_ID, id });
      return;
    }
    seen.add(id);
    if (record.status !== true || record.isDeleted === true) {
      excludedInactive += 1;
      return;
    }
    products.push(toProduct(record, id, departmentAcc, wantedGroup));
  });

  const departments = [...departmentAcc.entries()].map(([id, acc]) => toDepartment(id, acc));
  departments.sort(compareByNameThenId);
  products.sort(compareByNameThenId);
  return { departments, products, malformed, excludedInactive };
}

function toProduct(record, id, departmentAcc, wantedGroup) {
  const warnings = [];
  const name = cleanString(record.name);
  if (name === null) warnings.push(CATALOG_WARNINGS.MISSING_NAME);

  const departmentIds = new Set();
  let invalidEntry = false;
  const entries = Array.isArray(record.departments) ? record.departments : [];
  for (const entry of entries) {
    const departmentId =
      entry !== null && typeof entry === 'object' ? cleanString(entry.departmentInGroup) : null;
    const groupName = departmentId === null ? null : cleanString(entry.departmentGroupName);
    if (departmentId === null || groupName === null) {
      invalidEntry = true;
      continue;
    }
    if (groupName.toLowerCase() !== wantedGroup) {
      continue;
    }
    departmentIds.add(departmentId);
    let dept = departmentAcc.get(departmentId);
    if (dept === undefined) {
      dept = {
        names: new Set(),
        groupIds: new Set(),
        groupNames: new Set(),
        productIds: new Set(),
      };
      departmentAcc.set(departmentId, dept);
    }
    addIfPresent(dept.names, entry.departmentInGroupName);
    addIfPresent(dept.groupIds, entry.departmentGroup);
    addIfPresent(dept.groupNames, entry.departmentGroupName);
    dept.productIds.add(id);
  }
  if (departmentIds.size === 0) warnings.push(CATALOG_WARNINGS.UNMAPPED_DEPARTMENT);
  if (invalidEntry) warnings.push(CATALOG_WARNINGS.INVALID_DEPARTMENT_ENTRY);

  return {
    id,
    name,
    code: cleanString(record.primaryCode),
    departmentIds: [...departmentIds].sort(),
    mapped: departmentIds.size > 0,
    warnings,
  };
}

function toDepartment(id, acc) {
  const warnings = [];
  const name = pick(acc.names);
  if (name === null) warnings.push(CATALOG_WARNINGS.MISSING_NAME);
  else if (acc.names.size > 1) warnings.push(CATALOG_WARNINGS.NAME_CONFLICT);
  if (acc.groupIds.size > 1) warnings.push(CATALOG_WARNINGS.GROUP_CONFLICT);
  return {
    id,
    name,
    groupId: pick(acc.groupIds),
    groupName: pick(acc.groupNames),
    productCount: acc.productIds.size,
    warnings,
  };
}

/** Deterministic choice among conflicting values: the alphabetically first. */
function pick(set) {
  if (set.size === 0) return null;
  return [...set].sort()[0];
}

function addIfPresent(set, value) {
  const cleaned = cleanString(value);
  if (cleaned !== null) set.add(cleaned);
}

function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function compareByNameThenId(a, b) {
  if (a.name === null && b.name !== null) return 1;
  if (a.name !== null && b.name === null) return -1;
  const byName = a.name === null ? 0 : collator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
