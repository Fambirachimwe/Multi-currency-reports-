import { RefreshCw } from 'lucide-react';
import { ErrorState, EmptyState, LoadingState } from '@/components/data-states';
import { PageLayout } from '@/components/layout/page-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NodesProvenance } from '@/features/reports/components/nodes-provenance';
import { useNodes } from '@/features/reports/use-nodes';

function NodeCard({ title, nodes, description }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description ?? `${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="max-h-80 divide-y overflow-y-auto" aria-label={`${title} nodes`}>
          {nodes.map((node) => (
            <li key={node.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0 truncate">{node.name}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Read-only brands with their nodes (stores), loaded from GAAP through the backend. */
export function NodesPage() {
  const catalog = useNodes();

  return (
    <PageLayout
      title="Nodes & Brands"
      description="Read-only reference list of brands and their nodes."
    >
      <Alert>
        <p className="text-text-secondary">
          Loaded from GAAP through the backend. Brands are the top-level GAAP nodes; GAAP does not
          state a brand relationship, so this grouping is not yet confirmed.
        </p>
      </Alert>

      {catalog.status === 'loading' ? <LoadingState label="Loading nodes…" rows={4} /> : null}

      {catalog.status === 'error' ? (
        <ErrorState title="Nodes could not be loaded" description={catalog.error?.message}>
          {catalog.error?.requestId ? (
            <p className="text-xs text-text-muted">Request ID: {catalog.error.requestId}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={catalog.reload}
          >
            Try again
          </Button>
        </ErrorState>
      ) : null}

      {catalog.status === 'success' ? <NodesContent catalog={catalog} /> : null}
    </PageLayout>
  );
}

function NodesContent({ catalog }) {
  const { brands, nodes, meta, refresh, refreshing, refreshError } = catalog;
  const isEmpty = brands.length === 0 && nodes.length === 0;
  const ungrouped = nodes.filter((n) => n.brandId === '');
  const malformed = meta?.malformedCount ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <NodesProvenance meta={meta} />
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={refresh}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh from GAAP'}
        </Button>
      </div>
      {refreshError ? (
        <ErrorState title="Refresh failed" description={refreshError.message}>
          <p className="text-text-muted">The previously saved nodes are still shown.</p>
          {refreshError.requestId ? (
            <p className="text-xs text-text-muted">Request ID: {refreshError.requestId}</p>
          ) : null}
        </ErrorState>
      ) : null}
      {isEmpty ? (
        <EmptyState
          title="No nodes returned"
          description="GAAP returned no nodes for this request."
        />
      ) : null}
      {meta?.complete === false ? (
        <p role="alert" className="text-warning">
          This node list may be incomplete.
        </p>
      ) : null}
      {malformed > 0 ? (
        <p role="alert" className="text-warning">
          {malformed} malformed record{malformed === 1 ? ' was' : 's were'} skipped.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((brand) => (
          <NodeCard
            key={brand.id}
            title={brand.name}
            nodes={nodes.filter((n) => n.brandId === brand.id)}
          />
        ))}
        {ungrouped.length > 0 ? (
          <NodeCard
            title="Ungrouped nodes"
            nodes={ungrouped}
            description={`${ungrouped.length} node${ungrouped.length === 1 ? '' : 's'} not under a known brand`}
          />
        ) : null}
      </div>
    </>
  );
}
