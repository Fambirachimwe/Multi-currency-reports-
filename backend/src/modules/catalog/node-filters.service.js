import { buildNodeFilterOptions, resolveNodeSelection } from './node-filters.js';

/**
 * Brand/node filtering on top of the stored nodes. Reads follow the nodes service rules:
 * served from MongoDB, GAAP only when nothing is stored.
 * @param {{ nodesService: { listAllNodes: Function } }} deps
 */
export function createNodeFiltersService({ nodesService }) {
  async function load(requestId) {
    const { nodes, meta } = await nodesService.listAllNodes({ requestId });
    return { options: buildNodeFilterOptions(nodes), meta };
  }

  return Object.freeze({
    async getOptions({ requestId } = {}) {
      const { options, meta } = await load(requestId);
      return { options, meta: filterMeta(meta, options) };
    },
    /** @throws {import('./node-filters.js').SelectionError} */
    async resolveSelection({ selection, requestId }) {
      const { options, meta } = await load(requestId);
      return {
        selection: resolveNodeSelection(options, selection),
        meta: filterMeta(meta, options),
      };
    },
  });
}

function filterMeta(meta, options) {
  return {
    brandDefinition: 'TOP_LEVEL_NODE_WITH_CHILDREN_UNVERIFIED',
    source: meta.source,
    origin: meta.origin,
    fetchedAt: meta.fetchedAt,
    cacheFreshness: meta.cacheFreshness,
    // False means the node list may be missing nodes; "all nodes" is then not guaranteed to be all.
    complete: meta.complete,
    brandCount: options.brands.length,
    nodeCount: options.nodes.length,
  };
}
