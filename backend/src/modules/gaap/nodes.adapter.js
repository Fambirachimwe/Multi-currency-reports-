import { GAAP_ERROR_CODES, GaapError } from './gaap.errors.js';

/**
 * GAAP `GET /nodes` adapter.
 *
 * VERIFIED against the live API on 2026-11-07 (one read-only call; structure only):
 *  - Response is an object `{ totalRecords: number, data: Record[] }`.
 *  - `limit` and `skip` query parameters are honoured (limit 1000 accepted; skip beyond
 *    the end returns an empty `data`). No `sort` parameter was tried, so none is sent.
 *  - `_id` is a unique string on every record (249 of 249).
 *  - `nodeId` is NOT unique: it takes few distinct values and equals `parent` for child
 *    records. Keying on `nodeId` (as sample.js does) would collapse stores into groups,
 *    so the normalized `id` comes from `_id`.
 *  - `tradingDetails.name` is present on every record. Top-level `name` is rare and, where
 *    present, differed from it (a generic label), so `tradingDetails.name` is preferred.
 *  - `status` is a string code ("1", "3"); its meaning is NOT verified.
 *
 * NOT verified, deliberately not mapped: any brand relationship, the meaning of `status`,
 * the meaning of `nodeId`, and the currency semantics of `baseCurrency`.
 */

export const NODES_PATH = '/nodes';
export const NODES_PAGE_SIZE = 1000;
export const NODES_MAX_PAGES = 10;

/** Warning codes attached to a kept node. */
export const NODE_WARNINGS = Object.freeze({
  MISSING_NAME: 'MISSING_NAME',
  NAME_CONFLICT: 'NAME_CONFLICT',
  INVALID_PARENT: 'INVALID_PARENT',
  INVALID_SOURCE_NODE_ID: 'INVALID_SOURCE_NODE_ID',
  INVALID_STATUS: 'INVALID_STATUS',
});

/** Reasons a record is rejected as malformed. */
export const MALFORMED_REASONS = Object.freeze({
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  MISSING_ID: 'MISSING_ID',
  DUPLICATE_ID: 'DUPLICATE_ID',
});

/**
 * @typedef {object} GaapNode Normalized node. Raw GAAP field names stay in this module.
 * @property {string} id Unique node identifier (GAAP `_id`).
 * @property {string|null} name Display name, or null when GAAP gave none.
 * @property {string|null} parentId GAAP `parent`, as given. Hierarchy only; not a brand claim.
 * @property {string|null} sourceNodeId GAAP `nodeId`, as given. Not unique; meaning unverified.
 * @property {string|null} sourceStatus GAAP `status`, as given. Meaning unverified.
 * @property {string[]} warnings {@link NODE_WARNINGS} codes. Empty for a clean record.
 *
 * @typedef {object} MalformedNode
 * @property {number} index Position in the combined GAAP result.
 * @property {string} reason One of {@link MALFORMED_REASONS}.
 * @property {string|null} id The record's id when it had one. No other payload is kept.
 *
 * @typedef {object} NodesResult
 * @property {GaapNode[]} nodes Valid, de-duplicated nodes sorted by name then id.
 * @property {MalformedNode[]} malformed Rejected records.
 * @property {number} rawCount Records received from GAAP.
 * @property {number|null} upstreamTotal GAAP `totalRecords`, when valid.
 * @property {boolean} complete False when the page cap was hit or the count disagrees with GAAP.
 * @property {string} fetchedAt ISO 8601 instant.
 */

/**
 * @param {object} options
 * @param {{ get: Function }} options.client GAAP client from `createGaapClient`.
 * @param {number} [options.pageSize]
 * @param {number} [options.maxPages]
 * @param {() => Date} [options.now]
 */
export function createNodesAdapter({
  client,
  pageSize = NODES_PAGE_SIZE,
  maxPages = NODES_MAX_PAGES,
  now = () => new Date(),
}) {
  /**
   * Fetches every node page (bounded), then normalizes.
   * @param {{ signal?: AbortSignal, requestId?: string }} [options]
   * @returns {Promise<NodesResult>}
   * @throws {GaapError}
   */
  async function fetchNodes({ signal, requestId } = {}) {
    const records = [];
    let upstreamTotal = null;
    let complete = false;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await client.get(
        NODES_PATH,
        { limit: pageSize, skip: page * pageSize },
        { signal, requestId },
      );
      const body = parsePage(response.data);
      records.push(...body.records);
      upstreamTotal = body.totalRecords ?? upstreamTotal;

      if (upstreamTotal !== null && records.length >= upstreamTotal) {
        complete = true;
        break;
      }
      if (body.records.length < pageSize) {
        // A short page ends the data; it only counts as complete if GAAP did not promise more.
        complete = upstreamTotal === null;
        break;
      }
    }

    const { nodes, malformed } = normalizeNodes(records);
    return {
      nodes,
      malformed,
      rawCount: records.length,
      upstreamTotal,
      complete,
      fetchedAt: now().toISOString(),
    };
  }

  return Object.freeze({ fetchNodes });
}

function parsePage(body) {
  const isEnvelope = body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!isEnvelope || !Array.isArray(body.data)) {
    throw new GaapError({
      code: GAAP_ERROR_CODES.INVALID_RESPONSE,
      message: 'GAAP nodes response did not contain a data array',
      method: 'GET',
      path: NODES_PATH,
    });
  }
  const total = body.totalRecords;
  return {
    records: body.data,
    totalRecords: Number.isInteger(total) && total >= 0 ? total : null,
  };
}

/**
 * Pure normalization. Never throws on bad records: they are reported, not dropped silently.
 * @param {unknown[]} records
 * @returns {{ nodes: GaapNode[], malformed: MalformedNode[] }}
 */
export function normalizeNodes(records) {
  const nodes = [];
  const malformed = [];
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
    nodes.push(toNode(record, id));
  });

  nodes.sort(compareNodes);
  return { nodes, malformed };
}

function toNode(record, id) {
  const warnings = [];

  const tradingName = cleanString(record.tradingDetails?.name);
  const topName = cleanString(record.name);
  const name = tradingName ?? topName;
  if (name === null) {
    warnings.push(NODE_WARNINGS.MISSING_NAME);
  } else if (tradingName !== null && topName !== null && tradingName !== topName) {
    warnings.push(NODE_WARNINGS.NAME_CONFLICT);
  }

  return {
    id,
    name,
    parentId: optionalString(record.parent, NODE_WARNINGS.INVALID_PARENT, warnings),
    sourceNodeId: optionalString(record.nodeId, NODE_WARNINGS.INVALID_SOURCE_NODE_ID, warnings),
    sourceStatus: optionalString(record.status, NODE_WARNINGS.INVALID_STATUS, warnings),
    warnings,
  };
}

/** Absent/blank -> null with no warning; present but not a string -> null with a warning. */
function optionalString(value, warning, warnings) {
  if (value === undefined || value === null) {
    return null;
  }
  const cleaned = cleanString(value);
  if (cleaned === null && typeof value !== 'string') {
    warnings.push(warning);
  }
  return cleaned;
}

function cleanString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function compareNodes(a, b) {
  if (a.name === null && b.name !== null) return 1;
  if (a.name !== null && b.name === null) return -1;
  const byName = a.name === null ? 0 : collator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
