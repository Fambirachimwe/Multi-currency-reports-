import { createDecimalSum } from '../gaap/decimal-sum.js';

/**
 * Accumulates the SAVED rows of one report into per-currency product and node groups and row warning
 * counts (Feature 23). Amounts are summed exactly with decimals; every group is keyed by currency
 * first, so currencies are never combined. Output order is left to `buildReportSummary`.
 */
function createGroups(idField, nameField) {
  const groups = new Map();
  return {
    add(row) {
      const key = `${row.currency}\u0000${row[idField]}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          currency: row.currency,
          id: row[idField],
          name: null,
          lineCount: 0,
          quantity: createDecimalSum(),
          turnover: createDecimalSum(),
        };
        groups.set(key, group);
      }
      if (group.name === null && typeof row[nameField] === 'string') group.name = row[nameField];
      group.lineCount += 1;
      group.quantity.add(row.quantity);
      group.turnover.add(row.turnover);
    },
    result() {
      return [...groups.values()].map((group) => ({
        currency: group.currency,
        id: group.id,
        name: group.name,
        lineCount: group.lineCount,
        quantity: group.quantity.toString(),
        turnover: group.turnover.toString(),
      }));
    },
  };
}

/** @returns {{ add(row: object): void, result(): { products: object[], nodes: object[], warnings: object[] } }} */
export function createGroupAccumulator() {
  const products = createGroups('productId', 'productName');
  const nodes = createGroups('nodeId', 'nodeName');
  const warnings = new Map();
  return {
    /** @param {object} row a canonical row (valid currency, decimal-text quantity and turnover) */
    add(row) {
      products.add(row);
      nodes.add(row);
      for (const code of new Set(row.warnings ?? [])) {
        warnings.set(code, (warnings.get(code) ?? 0) + 1);
      }
    },
    result() {
      return {
        products: products.result(),
        nodes: nodes.result(),
        warnings: [...warnings.entries()].map(([code, rowCount]) => ({ code, rowCount })),
      };
    },
  };
}
