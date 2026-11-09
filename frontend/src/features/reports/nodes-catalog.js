/**
 * Turns the backend's normalized nodes (GET /api/v1/nodes) into the shapes the
 * report filter form uses. Display grouping only: no report numbers are computed.
 *
 * ASSUMPTION, NOT VERIFIED WITH GAAP: a "brand" is a top-level node (one whose
 * `sourceNodeId` equals its own `id`), and its stores are the nodes whose
 * `parentId` is that id. This matches the structure seen in the live payload, but
 * GAAP does not state a brand relationship. Confirm it in Feature 08/10.
 */

/** @typedef {{id: string, name: string|null, parentId: string|null, sourceNodeId: string|null, warnings?: string[]}} ApiNode */

export function displayName(node) {
  return node.name ?? `Unnamed node (${node.id.slice(-6)})`;
}

const FOCUS_PATTERN = /chicken\s*inn/i;

/**
 * Current product focus: only Chicken Inn brands and nodes are offered. A brand is kept when its
 * name matches, and a node is kept when its own name matches or it belongs to a kept brand.
 * Display filtering only; the backend still holds every node.
 * @param {{brands: {id: string, name: string}[], nodes: {id: string, name: string, brandId?: string}[]}} catalog
 */
export function focusChickenInn({ brands, nodes }) {
  const keptBrands = brands.filter((b) => FOCUS_PATTERN.test(b.name));
  const keptIds = new Set(keptBrands.map((b) => b.id));
  return {
    brands: keptBrands,
    nodes: nodes.filter((n) => FOCUS_PATTERN.test(n.name) || keptIds.has(n.brandId)),
  };
}

/**
 * @param {ApiNode[]} apiNodes
 * @returns {{brands: {id: string, name: string}[], nodes: {id: string, name: string, brandId: string}[]}}
 */
export function buildNodeCatalog(apiNodes) {
  const topLevel = apiNodes.filter((n) => n.sourceNodeId === n.id);
  const parentsWithChildren = new Set(
    apiNodes.filter((n) => n.sourceNodeId !== n.id && n.parentId !== null).map((n) => n.parentId),
  );
  const brandIds = new Set(topLevel.filter((n) => parentsWithChildren.has(n.id)).map((n) => n.id));

  const brands = apiNodes
    .filter((n) => brandIds.has(n.id))
    .map((n) => ({ id: n.id, name: displayName(n) }));

  const nodes = apiNodes
    .filter((n) => !brandIds.has(n.id))
    .map((n) => ({
      id: n.id,
      name: displayName(n),
      brandId: n.parentId !== null && brandIds.has(n.parentId) ? n.parentId : '',
    }));

  return { brands, nodes };
}
