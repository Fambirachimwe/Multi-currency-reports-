import { SELECTION_MODES } from '../catalog/node-filters.js';
import { inclusiveDayCount, isCompactDate } from './report-dates.js';

/**
 * Request schema for `POST /api/v1/reports` (pure, no I/O). See docs/report-request-contract.md.
 *
 * {
 *   startDate: 'YYYYMMDD', endDate: 'YYYYMMDD',          // inclusive, Africa/Harare, no future days
 *   productIds: string[],                                 // 1..maxProducts
 *   nodes: { mode: 'all' }
 *        | { mode: 'brands', brandIds: string[] }
 *        | { mode: 'nodes',  nodeIds: string[] },
 *   cachePolicy: 'use_cache' | 'bypass_cache'             // required; PROVISIONAL values
 * }
 *
 * Nothing is defaulted: every field is required so a stored request records exactly what was asked.
 * Unknown fields are rejected. Input values are never echoed back in messages.
 */
export const CACHE_POLICIES = Object.freeze(['use_cache', 'bypass_cache']);

export const MAX_ID_LENGTH = 200;
/** Cap on brand/node ids in the request itself (before any expansion). */
export const MAX_NODE_SELECTION_IDS = 1000;

const TOP_LEVEL_FIELDS = Object.freeze([
  'startDate',
  'endDate',
  'productIds',
  'nodes',
  'cachePolicy',
]);
const NODE_FIELDS = Object.freeze(['mode', 'brandIds', 'nodeIds']);

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Thrown with one client-safe message per offending field. */
export class ReportRequestError extends Error {
  /** @param {Record<string, string>} fields */
  constructor(fields) {
    super('The report request is not valid.');
    this.name = 'ReportRequestError';
    this.code = 'INVALID_REPORT_REQUEST';
    this.fields = fields;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasControlCharacter(text) {
  return [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * Validates and normalizes a list of ids: trimmed, no blanks/control characters, unique, sorted.
 * `max` bounds the raw length, so duplicates cannot be used to dodge the cap.
 */
function parseIds(value, name, { max, required }, errors) {
  if (value === undefined) {
    if (required) errors[name] = `"${name}" is required.`;
    return [];
  }
  if (!Array.isArray(value)) {
    errors[name] = `"${name}" must be an array of ids.`;
    return [];
  }
  if (value.length > max) {
    errors[name] = `"${name}" may contain at most ${max} ids.`;
    return [];
  }
  const ids = [];
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : null;
    if (id === null || id === '' || id.length > MAX_ID_LENGTH || hasControlCharacter(id)) {
      errors[name] = `"${name}" contains an invalid id.`;
      return [];
    }
    ids.push(id);
  }
  if (required && ids.length === 0) errors[name] = `"${name}" must contain at least one id.`;
  return [...new Set(ids)].sort(byId);
}

function parseNodes(value, limits, errors) {
  if (!isPlainObject(value)) {
    errors.nodes = '"nodes" must be an object with a "mode".';
    return null;
  }
  const unknown = Object.keys(value).find((key) => !NODE_FIELDS.includes(key));
  if (unknown !== undefined) {
    errors.nodes = `Unknown field "${unknown.slice(0, 40)}" in "nodes".`;
    return null;
  }
  if (!SELECTION_MODES.includes(value.mode)) {
    errors['nodes.mode'] = `"nodes.mode" must be one of: ${SELECTION_MODES.join(', ')}.`;
    return null;
  }
  const { mode } = value;
  const max = Math.min(limits.maxNodes, MAX_NODE_SELECTION_IDS);
  // An id list that does not belong to the mode is an unsupported combination, not ignored input.
  if (mode !== 'brands' && value.brandIds !== undefined) {
    errors['nodes.brandIds'] = '"nodes.brandIds" is only allowed with mode "brands".';
  }
  if (mode !== 'nodes' && value.nodeIds !== undefined) {
    errors['nodes.nodeIds'] = '"nodes.nodeIds" is only allowed with mode "nodes".';
  }
  const brandIds =
    mode === 'brands'
      ? parseIds(value.brandIds, 'nodes.brandIds', { max, required: true }, errors)
      : [];
  const nodeIds =
    mode === 'nodes'
      ? parseIds(value.nodeIds, 'nodes.nodeIds', { max, required: true }, errors)
      : [];
  return { mode, brandIds, nodeIds };
}

function parseDates(body, { limits, today }, errors) {
  const dates = {};
  for (const name of ['startDate', 'endDate']) {
    const raw = body[name];
    if (typeof raw !== 'string' || raw.trim() === '') {
      errors[name] = `"${name}" is required and must be a YYYYMMDD date.`;
    } else if (!isCompactDate(raw.trim())) {
      errors[name] = `"${name}" must be a real calendar date written YYYYMMDD.`;
    } else if (raw.trim() > today) {
      errors[name] = `"${name}" cannot be in the future.`;
    } else {
      dates[name] = raw.trim();
    }
  }
  if (dates.startDate !== undefined && dates.endDate !== undefined) {
    if (dates.startDate > dates.endDate) {
      errors.endDate = '"endDate" must be on or after "startDate".';
    } else {
      const days = inclusiveDayCount(dates.startDate, dates.endDate);
      if (days > limits.maxRangeDays) {
        errors.endDate = `The range is ${days} days; the maximum is ${limits.maxRangeDays} days.`;
      }
    }
  }
  return dates;
}

/**
 * @param {unknown} body Parsed JSON body (untrusted).
 * @param {{ limits: import('./report-limits.js').DEFAULT_REPORT_LIMITS, today: string }} context
 *   `today` is YYYYMMDD in the reporting timezone.
 * @returns {{ startDate: string, endDate: string, productIds: string[],
 *   nodes: { mode: string, brandIds: string[], nodeIds: string[] }, cachePolicy: string }}
 * @throws {ReportRequestError} listing every invalid field
 */
export function parseReportRequest(body, context) {
  if (!isPlainObject(body)) {
    throw new ReportRequestError({ body: 'A JSON object body is required.' });
  }
  const errors = {};
  const unknown = Object.keys(body).find((key) => !TOP_LEVEL_FIELDS.includes(key));
  if (unknown !== undefined) errors.body = `Unknown field "${unknown.slice(0, 40)}".`;

  const dates = parseDates(body, context, errors);
  const productIds = parseIds(
    body.productIds,
    'productIds',
    { max: context.limits.maxProducts, required: true },
    errors,
  );
  const nodes = parseNodes(body.nodes, context.limits, errors);
  if (!CACHE_POLICIES.includes(body.cachePolicy)) {
    errors.cachePolicy = `"cachePolicy" must be one of: ${CACHE_POLICIES.join(', ')}.`;
  }

  if (Object.keys(errors).length > 0) throw new ReportRequestError(errors);
  return {
    startDate: dates.startDate,
    endDate: dates.endDate,
    productIds,
    nodes,
    cachePolicy: body.cachePolicy,
  };
}
