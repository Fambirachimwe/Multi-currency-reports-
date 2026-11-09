/**
 * Brand and node filter options, and expansion of a selection into exact node IDs.
 *
 * ASSUMPTION, NOT VERIFIED WITH GAAP (owner has not confirmed; see docs/gaap-catalog-source.md):
 * a "brand" is a top-level node (`sourceNodeId === id`) that has child nodes, and a brand's nodes
 * are the nodes whose `parentId` is that brand's id. Top-level nodes with no children stay
 * selectable as nodes (ungrouped). Replace `buildNodeFilterOptions` if the owner approves a
 * different brand definition or a configured mapping.
 *
 * Everything here is pure and deterministic: lists are sorted by name then id, and a resolved
 * selection is sorted by id with duplicates removed.
 */

export const SELECTION_MODES = Object.freeze(['all', 'brands', 'nodes']);

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function displayName(node) {
  return node.name ?? `Unnamed node (${node.id.slice(-6)})`;
}

const byNameThenId = (a, b) =>
  a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || byId(a.id, b.id);

/**
 * @param {{id: string, name: string|null, parentId: string|null, sourceNodeId: string|null}[]} apiNodes
 * @returns {{brands: {id: string, name: string, nodeIds: string[]}[], nodes: {id: string, name: string, brandId: string|null}[]}}
 */
export function buildNodeFilterOptions(apiNodes) {
  const isTopLevel = (n) => n.sourceNodeId === n.id;
  const parentsWithChildren = new Set(
    apiNodes.filter((n) => !isTopLevel(n) && n.parentId !== null).map((n) => n.parentId),
  );
  const brandIds = new Set(
    apiNodes.filter((n) => isTopLevel(n) && parentsWithChildren.has(n.id)).map((n) => n.id),
  );

  const nodes = apiNodes
    .filter((n) => !brandIds.has(n.id))
    .map((n) => ({
      id: n.id,
      name: displayName(n),
      brandId: n.parentId !== null && brandIds.has(n.parentId) ? n.parentId : null,
    }))
    .sort(byNameThenId);

  const brands = apiNodes
    .filter((n) => brandIds.has(n.id))
    .map((n) => ({
      id: n.id,
      name: displayName(n),
      // Exact node IDs the brand expands to, so the UI and backend can never disagree.
      nodeIds: nodes
        .filter((x) => x.brandId === n.id)
        .map((x) => x.id)
        .sort(byId),
    }))
    .sort(byNameThenId);

  return { brands, nodes };
}

/** Raised for a selection that cannot be resolved; `code` maps to an API error. */
export class SelectionError extends Error {
  constructor(code, message, unknownIds = []) {
    super(message);
    this.name = 'SelectionError';
    this.code = code;
    this.unknownIds = unknownIds;
  }
}

/**
 * Expands a selection into exact permitted node IDs (unique, sorted by id).
 * Ids that are not in the current options (stale mapping) are an error, never silently dropped.
 *
 * @param {ReturnType<typeof buildNodeFilterOptions>} options
 * @param {{mode: 'all'|'brands'|'nodes', brandIds?: string[], nodeIds?: string[]}} selection
 * @returns {{mode: string, brandIds: string[], nodeIds: string[]}}
 * @throws {SelectionError}
 */
export function resolveNodeSelection(options, { mode, brandIds = [], nodeIds = [] }) {
  const known = new Set(options.nodes.map((n) => n.id));
  let resolved;
  let brands = [];

  if (mode === 'all') {
    resolved = [...known];
  } else if (mode === 'brands') {
    brands = [...new Set(brandIds)].sort(byId);
    const byBrand = new Map(options.brands.map((b) => [b.id, b]));
    const unknown = brands.filter((id) => !byBrand.has(id));
    if (unknown.length > 0) {
      throw new SelectionError(
        'UNKNOWN_BRAND',
        'A selected brand is not in the current brand list.',
        unknown,
      );
    }
    resolved = [...new Set(brands.flatMap((id) => byBrand.get(id).nodeIds))];
  } else if (mode === 'nodes') {
    const wanted = [...new Set(nodeIds)];
    const unknown = wanted.filter((id) => !known.has(id)).sort(byId);
    if (unknown.length > 0) {
      throw new SelectionError(
        'UNKNOWN_NODE',
        'A selected node is not in the current node list.',
        unknown,
      );
    }
    resolved = wanted;
  } else {
    throw new SelectionError('INVALID_MODE', 'Unsupported selection mode.');
  }

  if (resolved.length === 0) {
    throw new SelectionError('NO_NODES', 'The selection contains no nodes.');
  }
  return { mode, brandIds: brands, nodeIds: resolved.sort(byId) };
}
