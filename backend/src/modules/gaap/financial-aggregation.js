import { applyEligibility } from './transaction-eligibility.js';
import { classifyLineCurrencies, CURRENCY_UNKNOWN } from './currency.resolver.js';
import { createDecimalSum, isDecimalString } from './decimal-sum.js';

/**
 * Financial aggregation (Feature 18): per-currency, per-product, per-node (and per-department where
 * mapped) totals over normalized lines. Pure: no I/O, no floating point (exact BigInt decimal sums),
 * no rounding, no currency conversion, and money from different currencies is never combined.
 *
 * Inputs are lines that already went through Feature 16 (`currency`) and Feature 17 (`eligibility`).
 * Only eligible lines are summed. Ineligible lines are counted by reason in `excluded`, never lost.
 * An eligible line whose fields cannot be aggregated (non-decimal quantity/turnover, missing
 * product or node id) is also excluded with a visible `AGGREGATION_*` reason rather than guessed.
 * `UNKNOWN` is its own currency bucket and is never merged into another currency.
 *
 * Fields: `quantity` and `turnover` (tax-inclusive, net of discounts, per the Feature 15 owner
 * decision) always; `tax` from `amounts.tax` where present. A line without a tax amount adds nothing
 * to tax and is counted in `taxMissingLineCount` (absent is never treated as 0), so a total with a
 * non-zero missing count is not a complete tax figure.
 *
 * Output is deterministic: exact sums are independent of input order, groups are sorted by id with
 * plain string comparison (currencies alphabetically, `UNKNOWN` last), and a group's name is the
 * lexicographically smallest non-empty name seen.
 *
 * Departments are not on the line. They come from the optional `departmentsByProductId` mapping
 * (Feature 09 catalog). A product can sit in several departments, so department totals overlap and
 * must never be added to each other; products with no mapping go to `unmappedDepartment`.
 */

export const FINANCIAL_AGGREGATION_VERSION = 1;

export const AGGREGATION_EXCLUSIONS = Object.freeze({
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  AGGREGATION_QUANTITY_INVALID: 'AGGREGATION_QUANTITY_INVALID',
  AGGREGATION_TURNOVER_INVALID: 'AGGREGATION_TURNOVER_INVALID',
  AGGREGATION_PRODUCT_MISSING: 'AGGREGATION_PRODUCT_MISSING',
  AGGREGATION_NODE_MISSING: 'AGGREGATION_NODE_MISSING',
});

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * @typedef {object} Totals
 * @property {number} lineCount
 * @property {string} quantity Exact decimal text.
 * @property {string} turnover Exact decimal text.
 * @property {string} tax Exact sum of the tax amounts present.
 * @property {number} taxLineCount Lines that had a tax amount.
 * @property {number} taxMissingLineCount Lines without one (`lineCount - taxLineCount`).
 */

/**
 * Aggregates lines that carry `currency` and `eligibility`.
 * @param {object[]} lines Output of `classifyLineCurrencies` then `applyEligibility`.
 * @param {{ departmentsByProductId?: Map<string, string[]> | Record<string, string[]>,
 *   departmentNames?: Map<string, string> | Record<string, string> }} [options]
 */
export function aggregateFinancials(lines, options = {}) {
  if (!Array.isArray(lines)) throw new TypeError('lines must be an array');
  const departmentMap = toMap(options.departmentsByProductId, 'departmentsByProductId');
  const departmentNames = toMap(options.departmentNames, 'departmentNames');

  const buckets = new Map(); // currency -> bucket
  const reasonCounts = {};
  let excludedLineCount = 0;
  let eligibleLineCount = 0;

  lines.forEach((line, index) => {
    assertClassified(line, index);
    if (line.eligibility.eligible !== true) {
      excludedLineCount += 1;
      const codes = new Set(line.eligibility.reasons.map((reason) => reason.code));
      if (codes.size === 0) codes.add(AGGREGATION_EXCLUSIONS.NOT_ELIGIBLE);
      for (const code of codes) reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
      return;
    }
    const problem = findAggregationProblem(line);
    if (problem !== null) {
      excludedLineCount += 1;
      reasonCounts[problem] = (reasonCounts[problem] ?? 0) + 1;
      return;
    }
    eligibleLineCount += 1;
    const bucket = bucketFor(buckets, line.currency);
    bucket.total.add(line);
    group(bucket.products, line.productId, line.productName).add(line);
    group(bucket.nodes, line.nodeId, line.nodeName).add(line);
    group(bucket.productNodes, `${line.productId}\u0000${line.nodeId}`, null, {
      productId: line.productId,
      nodeId: line.nodeId,
    }).add(line);
  });

  const currencies = [...buckets.keys()].sort(compareCurrency).map((currency) => {
    const bucket = buckets.get(currency);
    return finishCurrency(currency, bucket, departmentMap, departmentNames);
  });

  const result = {
    aggregationVersion: FINANCIAL_AGGREGATION_VERSION,
    currencies,
    summary: {
      lineCount: lines.length,
      eligibleLineCount,
      excludedLineCount,
      excludedReasonCounts: sortedCounts(reasonCounts),
      currencyCodes: currencies.map((entry) => entry.currency),
      unknownCurrencyLineCount:
        currencies.find((entry) => entry.currency === CURRENCY_UNKNOWN)?.totals.lineCount ?? 0,
    },
  };
  result.reconciliation = verifyReconciliation(result);
  return result;
}

/**
 * Convenience: runs Feature 16 then Feature 17 on normalized lines, then aggregates.
 * @param {object[]} normalizedLines `normalizeSalesLines().lines`.
 * @param {Parameters<typeof aggregateFinancials>[1] & { differingPolicy?: 'base' | 'unknown' }} [options]
 */
export function aggregateNormalizedLines(normalizedLines, options = {}) {
  const { differingPolicy, ...aggregateOptions } = options;
  const classified = classifyLineCurrencies(normalizedLines, { differingPolicy }).lines;
  const evaluated = applyEligibility(classified).lines;
  return aggregateFinancials(evaluated, aggregateOptions);
}

/**
 * Checks that detail adds up to summary, using fresh exact sums: per currency, products, nodes and
 * product-node cells each sum to the currency total on every field; each department equals the sum
 * of its products; the unmapped bucket equals the sum of its products; no currency code repeats.
 * @param {ReturnType<typeof aggregateFinancials>} aggregation
 * @returns {{ ok: boolean, mismatches: { currency: string, check: string, field: string,
 *   expected: string, actual: string }[] }}
 */
export function verifyReconciliation(aggregation) {
  const mismatches = [];
  const seen = new Set();
  let lineSum = 0;
  for (const entry of aggregation.currencies) {
    if (seen.has(entry.currency)) {
      mismatches.push(mismatch(entry.currency, 'currency-unique', 'currency', '1', '2'));
    }
    seen.add(entry.currency);
    lineSum += entry.totals.lineCount;
    const compare = (check, parts, expected = entry.totals) => {
      const sums = sumTotals(parts);
      for (const field of TOTAL_FIELDS) {
        if (String(sums[field]) !== String(expected[field])) {
          mismatches.push(
            mismatch(entry.currency, check, field, String(expected[field]), String(sums[field])),
          );
        }
      }
    };
    compare('products', entry.products);
    compare('nodes', entry.nodes);
    compare('product-nodes', entry.productNodes);
    const byProduct = new Map(entry.products.map((product) => [product.productId, product]));
    for (const department of entry.departments) {
      compare(
        `department:${department.departmentId}`,
        department.productIds.map((id) => byProduct.get(id)).filter(Boolean),
        department.totals,
      );
    }
    if (entry.unmappedDepartment !== null) {
      compare(
        'unmapped-department',
        entry.unmappedDepartment.productIds.map((id) => byProduct.get(id)).filter(Boolean),
        entry.unmappedDepartment.totals,
      );
    }
  }
  if (lineSum !== aggregation.summary.eligibleLineCount) {
    mismatches.push(
      mismatch(
        '*',
        'eligible-lines',
        'lineCount',
        String(aggregation.summary.eligibleLineCount),
        String(lineSum),
      ),
    );
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ---------------------------------------------------------------------------------------------

const TOTAL_FIELDS = ['lineCount', 'quantity', 'turnover', 'tax', 'taxLineCount'];

function finishCurrency(currency, bucket, departmentMap, departmentNames) {
  const products = finishGroups(bucket.products, 'productId', 'productName');
  const nodes = finishGroups(bucket.nodes, 'nodeId', 'nodeName');
  const productNodes = [...bucket.productNodes.values()]
    .map((entry) => ({
      productId: entry.extra.productId,
      nodeId: entry.extra.nodeId,
      ...entry.out(),
    }))
    .sort((a, b) => compareText(a.productId, b.productId) || compareText(a.nodeId, b.nodeId))
    .map(({ productId, nodeId, totals }) => ({ productId, nodeId, totals }));

  // Departments, from the mapping. Overlapping by design: a product can be in several departments.
  const byDepartment = new Map();
  const unmappedProducts = [];
  for (const product of products) {
    const ids = departmentIdsFor(departmentMap, product.productId);
    if (ids.length === 0) unmappedProducts.push(product);
    for (const id of ids) {
      if (!byDepartment.has(id)) byDepartment.set(id, []);
      byDepartment.get(id).push(product);
    }
  }
  const departments = [...byDepartment.keys()].sort(compareText).map((departmentId) => {
    const members = byDepartment.get(departmentId);
    return {
      departmentId,
      departmentName: nameFor(departmentNames, departmentId),
      productIds: members.map((product) => product.productId),
      totals: sumTotals(members),
    };
  });

  return {
    currency,
    totals: bucket.total.out().totals,
    products,
    nodes,
    productNodes,
    departments,
    unmappedDepartment:
      unmappedProducts.length === 0
        ? null
        : {
            productIds: unmappedProducts.map((product) => product.productId),
            totals: sumTotals(unmappedProducts),
          },
  };
}

function finishGroups(map, idKey, nameKey) {
  return [...map.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([id, accumulator]) => {
      const { totals, name } = accumulator.out();
      return { [idKey]: id, [nameKey]: name, totals };
    });
}

function newAccumulator(extra = null) {
  const quantity = createDecimalSum();
  const turnover = createDecimalSum();
  const tax = createDecimalSum();
  let lineCount = 0;
  let taxLineCount = 0;
  let name = null;
  return {
    extra,
    add(line, displayName = null) {
      lineCount += 1;
      quantity.add(line.quantity);
      turnover.add(line.turnover);
      const taxText = line.amounts?.tax;
      if (isDecimalString(taxText)) {
        tax.add(taxText);
        taxLineCount += 1;
      }
      if (typeof displayName === 'string' && displayName !== '') {
        if (name === null || displayName < name) name = displayName;
      }
    },
    out() {
      return {
        name,
        totals: {
          lineCount,
          quantity: quantity.toString(),
          turnover: turnover.toString(),
          tax: tax.toString(),
          taxLineCount,
          taxMissingLineCount: lineCount - taxLineCount,
        },
      };
    },
  };
}

function bucketFor(buckets, currency) {
  if (!buckets.has(currency)) {
    buckets.set(currency, {
      total: newAccumulator(),
      products: new Map(),
      nodes: new Map(),
      productNodes: new Map(),
    });
  }
  return buckets.get(currency);
}

/** Returns an accumulator whose `add(line)` also records the display name for the group. */
function group(map, id, name, extra = null) {
  if (!map.has(id)) map.set(id, newAccumulator(extra));
  const accumulator = map.get(id);
  return { add: (line) => accumulator.add(line, name) };
}

function sumTotals(parts) {
  const quantity = createDecimalSum();
  const turnover = createDecimalSum();
  const tax = createDecimalSum();
  let lineCount = 0;
  let taxLineCount = 0;
  for (const part of parts) {
    const totals = part.totals ?? part;
    lineCount += totals.lineCount;
    taxLineCount += totals.taxLineCount;
    quantity.add(totals.quantity);
    turnover.add(totals.turnover);
    tax.add(totals.tax);
  }
  return {
    lineCount,
    quantity: quantity.toString(),
    turnover: turnover.toString(),
    tax: tax.toString(),
    taxLineCount,
    taxMissingLineCount: lineCount - taxLineCount,
  };
}

function assertClassified(line, index) {
  if (line === null || typeof line !== 'object' || Array.isArray(line)) {
    throw new TypeError(`lines[${index}] must be an object`);
  }
  if (
    typeof line.currency !== 'string' ||
    (line.currency !== CURRENCY_UNKNOWN && !CURRENCY_PATTERN.test(line.currency))
  ) {
    throw new TypeError(`lines[${index}] has no resolved currency (run classifyLineCurrencies)`);
  }
  if (
    line.eligibility === null ||
    typeof line.eligibility !== 'object' ||
    typeof line.eligibility.eligible !== 'boolean' ||
    !Array.isArray(line.eligibility.reasons)
  ) {
    throw new TypeError(`lines[${index}] has no eligibility (run applyEligibility)`);
  }
}

function findAggregationProblem(line) {
  if (!isDecimalString(line.quantity)) return AGGREGATION_EXCLUSIONS.AGGREGATION_QUANTITY_INVALID;
  if (!isDecimalString(line.turnover)) return AGGREGATION_EXCLUSIONS.AGGREGATION_TURNOVER_INVALID;
  if (typeof line.productId !== 'string' || line.productId === '') {
    return AGGREGATION_EXCLUSIONS.AGGREGATION_PRODUCT_MISSING;
  }
  if (typeof line.nodeId !== 'string' || line.nodeId === '') {
    return AGGREGATION_EXCLUSIONS.AGGREGATION_NODE_MISSING;
  }
  return null;
}

function toMap(value, label) {
  if (value === undefined || value === null) return new Map();
  if (value instanceof Map) return value;
  if (typeof value === 'object' && !Array.isArray(value)) return new Map(Object.entries(value));
  throw new TypeError(`${label} must be a Map or a plain object`);
}

function departmentIdsFor(map, productId) {
  const ids = map.get(productId);
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))].sort(compareText);
}

function nameFor(map, id) {
  const name = map.get(id);
  return typeof name === 'string' && name !== '' ? name : null;
}

function compareText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function compareCurrency(a, b) {
  if (a === CURRENCY_UNKNOWN) return b === CURRENCY_UNKNOWN ? 0 : 1;
  if (b === CURRENCY_UNKNOWN) return -1;
  return compareText(a, b);
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareText(a, b)));
}

function mismatch(currency, check, field, expected, actual) {
  return { currency, check, field, expected, actual };
}
