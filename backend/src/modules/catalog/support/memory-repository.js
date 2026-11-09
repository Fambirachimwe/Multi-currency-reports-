/** Test double for the nodes repository: stores in memory, records calls. */
export function memoryRepository({ failFind = false, failSave = false, ttlMs = 3_600_000 } = {}) {
  const state = { stored: null, finds: 0, saves: 0 };
  return {
    state,
    async find() {
      state.finds += 1;
      if (failFind) throw new Error('db down');
      if (state.stored === null) return null;
      const expired = Date.parse(state.stored.expiresAt) <= Date.now();
      let freshness = 'fresh';
      if (!state.stored.complete) freshness = 'incomplete';
      else if (expired) freshness = 'stale';
      return { ...state.stored, freshness };
    },
    async save(result) {
      state.saves += 1;
      if (failSave) throw new Error('db down');
      state.stored = {
        nodes: result.nodes,
        malformed: result.malformed,
        rawCount: result.rawCount,
        upstreamTotal: result.upstreamTotal,
        complete: result.complete,
        fetchedAt: result.fetchedAt,
        expiresAt: new Date(Date.parse(result.fetchedAt) + ttlMs).toISOString(),
        freshness: result.complete ? 'fresh' : 'incomplete',
      };
      return state.stored;
    },
  };
}
