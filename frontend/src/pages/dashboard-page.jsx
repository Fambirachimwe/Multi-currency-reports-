import { Bookmark, FilePlus2 } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/data-states';
import { PageLayout } from '@/components/layout/page-layout';
import { ReportStatusBadge } from '@/components/report-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SummaryCards } from '@/features/reports/components/summary-cards';
import {
  describeDateRange,
  describeFreshness,
  describeSelection,
  generatedAt,
} from '@/features/reports/saved-reports';
import { useDashboard } from '@/features/reports/use-dashboard';
import { formatDateTime } from '@/lib/format';
import { PATHS } from '@/routes/paths';

function CountTile({ label, value }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <span className="text-xl font-semibold tabular-nums text-text-primary">{value}</span>
    </Card>
  );
}

function LatestReport({ latest }) {
  const { item } = latest;
  const when = generatedAt(item);
  return (
    <section aria-labelledby="latest-heading" className="flex flex-col gap-2">
      <h2 id="latest-heading" className="text-sm font-semibold text-text-primary">
        Latest completed saved report
      </h2>
      <p className="text-text-muted">
        <Link
          to={`/reports/${item.reportId}`}
          className="rounded-sm font-medium text-accent-primary hover:text-accent-hover hover:underline"
        >
          {item.reportId}
        </Link>
        {' · '}
        {describeDateRange(item.filters)}
        {' · '}
        {describeSelection(item.filters)}
        {when ? ` · Generated ${formatDateTime(when)}` : ''}
      </p>
      <p className="text-text-muted">
        {describeFreshness(item.provenance)}. These totals describe this saved snapshot only (its
        date range and selection), not live or all-time sales. Each currency is totalled separately.
      </p>
      {latest.status === 'error' ? (
        <ErrorState
          title="Totals for this report could not be loaded"
          description={latest.error.message}
        >
          {latest.error.requestId ? (
            <p className="text-text-muted">Request ID: {latest.error.requestId}</p>
          ) : null}
        </ErrorState>
      ) : latest.totals.length === 0 ? (
        <p className="text-text-muted">This saved report has no sales lines.</p>
      ) : (
        <SummaryCards totals={latest.totals} />
      )}
    </section>
  );
}

function Content({ data }) {
  if (data.status === 'loading') {
    return <LoadingState label="Loading dashboard…" rows={4} />;
  }
  if (data.status === 'error') {
    return (
      <ErrorState title="The dashboard could not be loaded" description={data.error.message}>
        {data.error.requestId ? (
          <p className="text-text-muted">Request ID: {data.error.requestId}</p>
        ) : null}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={data.reload}>
            Try again
          </Button>
        </div>
      </ErrorState>
    );
  }

  const { counts, recent, latest } = data;
  return (
    <>
      <ul aria-label="Saved report counts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <li>
          <CountTile label="Saved reports" value={counts.all} />
        </li>
        <li>
          <CountTile label="Completed" value={counts.completed} />
        </li>
        <li>
          <CountTile label="In progress" value={counts.pending} />
        </li>
        <li>
          <CountTile label="Failed" value={counts.failed} />
        </li>
      </ul>

      {latest ? <LatestReport latest={latest} /> : null}

      {recent.length === 0 ? (
        <EmptyState
          title="No saved reports yet"
          description="Generate a report and it will appear here."
        >
          <Button asChild size="sm">
            <Link to={PATHS.generateReport}>Generate new report</Link>
          </Button>
        </EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent reports</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul aria-label="Recent reports" className="divide-y">
              {recent.map((report) => {
                const when = generatedAt(report);
                return (
                  <li key={report.reportId} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    {report.status === 'completed' ? (
                      <Link
                        to={`/reports/${report.reportId}`}
                        className="min-w-0 flex-1 truncate rounded-sm font-mono text-xs font-medium text-accent-primary hover:text-accent-hover hover:underline"
                      >
                        {report.reportId}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {report.reportId}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-text-muted">
                      {describeDateRange(report.filters)}
                    </span>
                    <ReportStatusBadge status={report.status} />
                    <span className="text-xs tabular-nums text-text-muted">
                      {when ? formatDateTime(when) : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Landing page: saved-report counts, the latest completed report's per-currency totals, quick links. */
export function DashboardPage() {
  const data = useDashboard();

  return (
    <PageLayout
      title="Dashboard"
      description="Saved report snapshots and shortcuts. Figures come from saved reports only, not live sales."
      actions={
        <Button asChild size="sm">
          <Link to={PATHS.generateReport}>
            <FilePlus2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Generate Report
          </Link>
        </Button>
      }
    >
      <Content data={data} />

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={PATHS.savedReports}>
            <Bookmark size={16} strokeWidth={1.75} aria-hidden="true" />
            All saved reports
          </Link>
        </Button>
      </div>
    </PageLayout>
  );
}
