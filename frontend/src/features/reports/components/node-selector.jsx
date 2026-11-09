import { Store } from 'lucide-react';
import { useId } from 'react';
import { ErrorState } from '@/components/data-states';
import { Button } from '@/components/ui/button';
import { FilterPanel } from '@/features/reports/components/filter-panel';
import { MultiSelectList } from '@/features/reports/components/multi-select-list';
import { NodesProvenance } from '@/features/reports/components/nodes-provenance';

const MODES = [
  { value: 'all', label: 'All nodes' },
  { value: 'brands', label: 'By brand' },
  { value: 'nodes', label: 'Selected nodes' },
];

function ResolvedLine({ resolved }) {
  if (resolved.status === 'loading') {
    return <p className="text-xs text-text-muted">Checking selection…</p>;
  }
  if (resolved.status === 'success') {
    const count = resolved.nodeIds.length;
    return (
      <p className="text-xs text-text-secondary">
        {count} node{count === 1 ? '' : 's'} will be included.
      </p>
    );
  }
  if (resolved.status === 'error') {
    const stale =
      resolved.error?.code === 'UNKNOWN_NODE' || resolved.error?.code === 'UNKNOWN_BRAND';
    return (
      <p role="alert" className="text-xs text-warning">
        {stale
          ? 'Part of this selection is no longer in the node list. Clear it and choose again.'
          : resolved.error?.message}
        {resolved.error?.requestId ? ` (Request ID: ${resolved.error.requestId})` : ''}
      </p>
    );
  }
  return null;
}

/**
 * Node filter with three explicit modes: all nodes, by brand (one or more brands), or selected
 * nodes. Options come from the backend; the node IDs a selection means are resolved by the
 * backend and only counted here. `status` is 'loading' | 'success' | 'error'.
 */
export function NodeSelector({
  status = 'success',
  loadError,
  partial = false,
  meta = null,
  onRetry,
  brands,
  nodes,
  nodeMode,
  brandIds,
  nodeIds,
  resolved,
  onModeChange,
  onBrandsChange,
  onNodesChange,
  error,
}) {
  const groupName = useId();
  const ready = status === 'success';
  const summary = !ready
    ? status === 'loading'
      ? 'Loading nodes…'
      : 'Nodes unavailable'
    : nodeMode === 'all'
      ? `All nodes (${nodes.length})`
      : nodeMode === 'brands'
        ? `${brandIds.length} of ${brands.length} brands selected`
        : `${nodeIds.length} of ${nodes.length} nodes selected`;

  return (
    <FilterPanel title="Brand / nodes" icon={Store} summary={summary} error={error}>
      {status === 'error' ? (
        <ErrorState title="Nodes could not be loaded" description={loadError?.message}>
          {loadError?.requestId ? (
            <p className="text-xs text-text-muted">Request ID: {loadError.requestId}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onRetry}
          >
            Try again
          </Button>
        </ErrorState>
      ) : null}
      {status === 'loading' ? (
        <p role="status" className="text-text-muted">
          Loading nodes…
        </p>
      ) : null}
      {status === 'success' ? <NodesProvenance meta={meta} /> : null}
      {partial ? (
        <p role="alert" className="text-xs text-warning">
          This node list may be incomplete. Do not rely on it for a full report.
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-1" disabled={!ready}>
        <legend className="text-xs font-medium text-text-secondary">Node filter</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {MODES.map((mode) => (
            <label key={mode.value} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name={groupName}
                className="size-4 accent-accent-primary"
                value={mode.value}
                checked={nodeMode === mode.value}
                onChange={() => onModeChange(mode.value)}
              />
              {mode.label}
            </label>
          ))}
        </div>
      </fieldset>

      {nodeMode === 'all' ? (
        <p className="text-text-secondary">
          Every node in the list is included
          {ready ? ` (${nodes.length})` : ''}.
        </p>
      ) : null}
      {nodeMode === 'brands' ? (
        <>
          <MultiSelectList
            label="brands"
            options={brands}
            selectedIds={brandIds}
            onChange={onBrandsChange}
            disabled={!ready}
            emptyText={ready ? 'No brands found.' : 'Brands are not available.'}
          />
          <p className="text-xs text-text-muted">
            Brands are the top-level GAAP nodes that have stores. This grouping is not yet confirmed
            with GAAP.
          </p>
        </>
      ) : null}
      {nodeMode === 'nodes' ? (
        <MultiSelectList
          label="nodes"
          options={nodes}
          selectedIds={nodeIds}
          onChange={onNodesChange}
          disabled={!ready}
          emptyText={ready ? 'No nodes returned.' : 'Nodes are not available.'}
        />
      ) : null}
      {ready ? <ResolvedLine resolved={resolved} /> : null}
    </FilterPanel>
  );
}
