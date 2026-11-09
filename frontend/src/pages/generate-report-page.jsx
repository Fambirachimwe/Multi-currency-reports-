import { FilePlus2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState } from '@/components/data-states';
import { PageLayout } from '@/components/layout/page-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateRangePicker } from '@/features/reports/components/date-range-picker';
import { DepartmentPicker } from '@/features/reports/components/department-picker';
import { NodeSelector } from '@/features/reports/components/node-selector';
import { ProductMultiSelect } from '@/features/reports/components/product-multiselect';
import { EMPTY_FILTERS, validateFilters, withDepartment } from '@/features/reports/filters';
import {
  useDepartmentProducts,
  useDepartments,
  useValidatedProducts,
} from '@/features/reports/use-catalog';
import { useGenerateReport } from '@/features/reports/use-generate-report';
import { useNodeFilterOptions, useResolvedNodes } from '@/features/reports/use-node-filters';

function GenerationStatus({ generation }) {
  const { phase, reportId, error } = generation;
  if (phase === 'cancelling') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md border p-4">
        <Loader2
          size={24}
          strokeWidth={1.75}
          className="animate-spin text-accent-primary"
          aria-hidden="true"
        />
        <p className="font-semibold text-text-primary">Cancelling the report…</p>
      </div>
    );
  }
  if (phase === 'cancelled') {
    return (
      <div role="status" className="rounded-md border p-4">
        <p className="font-semibold text-text-primary">Report cancelled</p>
        <p className="text-text-muted">
          Nothing was saved. You can change the filters and start again.
        </p>
      </div>
    );
  }
  if (phase === 'submitting') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md border p-4">
        <Loader2
          size={24}
          strokeWidth={1.75}
          className="animate-spin text-accent-primary"
          aria-hidden="true"
        />
        <p className="font-semibold text-text-primary">Starting the report…</p>
      </div>
    );
  }
  if (phase === 'pending') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md border p-4">
        <Loader2
          size={24}
          strokeWidth={1.75}
          className="shrink-0 animate-spin text-accent-primary"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-text-primary">Report is being generated</p>
          <p className="text-text-muted">
            This can take a little while. This page checks its status every few seconds.
          </p>
        </div>
      </div>
    );
  }
  if (phase === 'completed') {
    return (
      <div role="status" className="flex flex-col items-start gap-2 rounded-md border p-4">
        <p className="font-semibold text-text-primary">Report completed</p>
        <p className="text-text-muted">Report {reportId} was saved.</p>
        <Button asChild size="sm">
          <Link to={`/reports/${reportId}`}>View saved report</Link>
        </Button>
      </div>
    );
  }
  if (phase === 'failed' || phase === 'error') {
    return (
      <ErrorState
        title={phase === 'failed' ? 'The report failed' : 'The report could not be started'}
        description={error.message}
      >
        {error.requestId ? <p className="text-text-muted">Request ID: {error.requestId}</p> : null}
        {reportId ? <p className="text-text-muted">Report ID: {reportId}</p> : null}
        <p className="text-text-muted">
          Nothing was saved as completed. Adjust the filters and try again.
        </p>
      </ErrorState>
    );
  }
  return (
    <EmptyState
      title="No report generated"
      description="Choose your filters and press Generate Report. Finished reports appear in Saved Reports."
    />
  );
}

/**
 * Filter form for a new report. Filters are explicit state and are validated; Generate sends them to
 * the backend, which creates a pending report and builds it in the background. Success is shown only
 * once the server reports the saved report as completed.
 */
export function GenerateReportPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showErrors, setShowErrors] = useState(false);
  const catalog = useNodeFilterOptions();
  const resolved = useResolvedNodes(filters, catalog.status === 'success');
  const departments = useDepartments();
  const browsed = useDepartmentProducts(filters.departmentId);
  const validation = useValidatedProducts(filters.productIds, departments.status === 'success');
  const generation = useGenerateReport();
  const busy =
    generation.phase === 'submitting' ||
    generation.phase === 'pending' ||
    generation.phase === 'cancelling';
  const cancellable = generation.phase === 'submitting' || generation.phase === 'pending';

  const errors = {
    ...validateFilters(filters),
    ...(validation.unknownIds.length > 0
      ? { productIds: 'Remove the products that are no longer available.' }
      : {}),
  };
  const visibleErrors = showErrors ? errors : {};
  const errorList = Object.values(errors);

  return (
    <PageLayout
      title="Generate Report"
      description="Choose a department, products, nodes and a date range. Nothing runs until you press Generate Report."
    >
      <form
        aria-label="Report filters"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setShowErrors(true);
        }}
        noValidate
      >
        <div className="grid items-stretch gap-3 md:grid-cols-2 xl:h-[calc(100vh-15rem)] xl:min-h-[26rem] xl:grid-cols-4 xl:[&>*]:min-h-0">
          <DepartmentPicker
            status={departments.status}
            loadError={departments.error}
            onRetry={departments.reload}
            departments={departments.departments}
            value={filters.departmentId}
            onChange={(id) => setFilters((f) => withDepartment(f, id))}
          />
          <ProductMultiSelect
            status={browsed.status}
            loadError={browsed.error}
            onRetry={browsed.reload}
            partial={browsed.partial}
            products={browsed.products}
            namesById={browsed.namesById}
            validation={validation}
            hasDepartment={filters.departmentId !== ''}
            selectedIds={filters.productIds}
            error={visibleErrors.productIds}
            onChange={(productIds) => setFilters((f) => ({ ...f, productIds }))}
          />
          <NodeSelector
            status={catalog.status}
            loadError={catalog.error}
            partial={catalog.status === 'success' && catalog.meta?.complete === false}
            meta={catalog.meta}
            onRetry={catalog.reload}
            brands={catalog.brands}
            nodes={catalog.nodes}
            nodeMode={filters.nodeMode}
            brandIds={filters.brandIds}
            nodeIds={filters.nodeIds}
            resolved={resolved}
            error={visibleErrors.nodeIds}
            onModeChange={(nodeMode) => setFilters((f) => ({ ...f, nodeMode }))}
            onBrandsChange={(brandIds) => setFilters((f) => ({ ...f, brandIds }))}
            onNodesChange={(nodeIds) => setFilters((f) => ({ ...f, nodeIds }))}
          />
          <DateRangePicker
            startDate={filters.startDate}
            endDate={filters.endDate}
            errors={visibleErrors}
            onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          />
        </div>

        <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text-primary">Selection check</p>
            {errorList.length === 0 ? (
              <p className="text-text-secondary">All required filters are set.</p>
            ) : (
              <p className="text-text-muted">
                {showErrors
                  ? errorList.join(' ')
                  : `${errorList.length} required filter${errorList.length === 1 ? '' : 's'} still missing.`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setShowErrors(false);
              }}
            >
              <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
              Reset filters
            </Button>
            <Button type="submit" variant="outline" size="sm">
              Check selection
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                setShowErrors(true);
                if (errorList.length === 0) generation.start(filters);
              }}
            >
              {busy ? (
                <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
              ) : (
                <FilePlus2 size={16} strokeWidth={1.75} aria-hidden="true" />
              )}
              {busy ? 'Generating…' : 'Generate Report'}
            </Button>
            {cancellable ? (
              <Button type="button" variant="outline" size="sm" onClick={generation.cancel}>
                <XCircle size={16} strokeWidth={1.75} aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
          </div>
        </Card>
      </form>

      <section aria-labelledby="results-heading" className="flex flex-col gap-2">
        <h2 id="results-heading" className="text-sm font-semibold text-text-primary">
          Report status
        </h2>
        <GenerationStatus generation={generation} />
      </section>
    </PageLayout>
  );
}
