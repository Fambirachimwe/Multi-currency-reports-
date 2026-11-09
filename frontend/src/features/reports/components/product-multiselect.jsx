import { Package, X } from 'lucide-react';
import { ErrorState } from '@/components/data-states';
import { Button } from '@/components/ui/button';
import { FilterPanel } from '@/features/reports/components/filter-panel';
import { MultiSelectList } from '@/features/reports/components/multi-select-list';

function SelectedProducts({ selectedIds, namesById, onChange }) {
  if (selectedIds.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-text-secondary">
        Selected products ({selectedIds.length})
      </p>
      <ul aria-label="Selected products" className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
        {selectedIds.map((id) => {
          const name = namesById.get(id) ?? id;
          return (
            <li
              key={id}
              className="flex items-center gap-1 rounded-sm border bg-background py-0.5 pl-2 pr-0.5 text-xs"
            >
              <span className="max-w-40 truncate">{name}</span>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="rounded-sm p-0.5 text-text-muted hover:bg-hover hover:text-text-primary"
                onClick={() => onChange(selectedIds.filter((x) => x !== id))}
              >
                <X size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ValidationLine({ validation, selectedIds, onChange }) {
  if (validation.status === 'loading') {
    return <p className="text-xs text-text-muted">Checking selection…</p>;
  }
  if (validation.status === 'success') {
    return (
      <p className="text-xs text-text-secondary">
        {selectedIds.length} product{selectedIds.length === 1 ? '' : 's'} will be included.
      </p>
    );
  }
  if (validation.status !== 'error') return null;
  const requestId = validation.error?.requestId
    ? ` (Request ID: ${validation.error.requestId})`
    : '';
  if (validation.unknownIds.length > 0) {
    const gone = new Set(validation.unknownIds);
    const count = validation.unknownIds.length;
    return (
      <div role="alert" className="flex flex-col items-start gap-1 text-xs text-warning">
        <p>
          {count} selected product{count === 1 ? ' is' : 's are'} no longer available and cannot be
          reported on.{requestId}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(selectedIds.filter((id) => !gone.has(id)))}
        >
          Remove unavailable products
        </Button>
      </div>
    );
  }
  return (
    <p role="alert" className="text-xs text-warning">
      {validation.error?.message}
      {requestId}
    </p>
  );
}

/**
 * Product multi-select for the browsed department. The selection spans departments: switching
 * department never drops a selected product, and selected products stay visible and removable.
 * `status` is the product-list status: 'idle' (no department) | 'loading' | 'success' | 'error'.
 */
export function ProductMultiSelect({
  status = 'idle',
  loadError,
  onRetry,
  partial = false,
  products,
  selectedIds,
  namesById,
  validation,
  onChange,
  hasDepartment,
  error,
}) {
  const inDepartment = products.filter((p) => selectedIds.includes(p.id)).length;
  const summary = !hasDepartment
    ? selectedIds.length > 0
      ? `${selectedIds.length} selected · choose a department to add more`
      : 'Choose a department first'
    : status === 'loading'
      ? 'Loading products…'
      : status === 'error'
        ? 'Products unavailable'
        : `${selectedIds.length} selected · ${inDepartment} of ${products.length} in this department`;

  return (
    <FilterPanel title="Products" icon={Package} summary={summary} error={error}>
      {status === 'error' ? (
        <ErrorState title="Products could not be loaded" description={loadError?.message}>
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
          Loading products…
        </p>
      ) : null}
      {partial ? (
        <p role="alert" className="text-xs text-warning">
          This department has more products than were loaded. Search cannot reach all of them.
        </p>
      ) : null}
      <MultiSelectList
        label="products"
        options={products}
        selectedIds={selectedIds}
        onChange={onChange}
        disabled={!hasDepartment || status !== 'success'}
        emptyText={
          hasDepartment
            ? 'No products in this department.'
            : 'Choose a department to list products.'
        }
      />
      <SelectedProducts selectedIds={selectedIds} namesById={namesById} onChange={onChange} />
      <ValidationLine validation={validation} selectedIds={selectedIds} onChange={onChange} />
    </FilterPanel>
  );
}
