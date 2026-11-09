/**
 * Display name of a saved report: "<node> - <product> sales", for example
 * "Simbisa Chicken Inn - Fastjet sales". Built only from names already saved on the report's own
 * rows (never GAAP). When several nodes or products were selected, the first name is followed by
 * "+N more" using the selected counts. `null` when the report has no named line to take names from.
 *
 * @param {{ nodeName?: string|null, productName?: string|null }|null} firstRow first saved line
 * @param {{ nodeCount?: number|null, productCount?: number|null }} counts selected counts
 * @returns {string|null}
 */
export function buildReportName(firstRow, { nodeCount, productCount } = {}) {
  const label = (name, count) => {
    const text = typeof name === 'string' ? name.trim() : '';
    if (text === '') return null;
    return Number.isInteger(count) && count > 1 ? `${text} +${count - 1} more` : text;
  };
  const node = label(firstRow?.nodeName, nodeCount);
  const product = label(firstRow?.productName, productCount);
  if (node && product) return `${node} - ${product} sales`;
  if (product) return `${product} sales`;
  if (node) return `${node} sales`;
  return null;
}
