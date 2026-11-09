/** Test double for the catalog repository: stores in memory, records calls. */
export function catalogMemoryRepository({
  failFind = false,
  failSave = false,
  ttlMs = 3_600_000,
} = {}) {
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
      return { ...state.stored, freshness, expired };
    },
    async save(result) {
      state.saves += 1;
      if (failSave) throw new Error('db down');
      state.stored = {
        departments: result.departments,
        products: result.products,
        malformed: result.malformed,
        scan: result.scan,
        complete: result.complete,
        incompleteReasons: result.incompleteReasons,
        fetchedAt: result.fetchedAt,
        expiresAt: new Date(Date.parse(result.fetchedAt) + ttlMs).toISOString(),
        freshness: result.complete ? 'fresh' : 'incomplete',
        expired: false,
      };
      return state.stored;
    },
  };
}
