import { ArrowDownUp, Eye, FilePlus2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/data-states';
import { PageLayout } from '@/components/layout/page-layout';
import { ReportStatusBadge } from '@/components/report-status-badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  PAGE_SIZE,
  SORT_OPTIONS,
  STATUS_FILTERS,
  describeDateRange,
  describeFreshness,
  describeSelection,
  generatedAt,
} from '@/features/reports/saved-reports';
import { useSavedReports } from '@/features/reports/use-saved-reports';
import { formatDateTime } from '@/lib/format';
import { PATHS } from '@/routes/paths';

export function SavedReportsPage() {
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(0);
  const sortId = useId();
  const saved = useSavedReports({ status, sort, order, page, pageSize: PAGE_SIZE });

  const change = (setter) => (value) => {
    setter(value);
    setPage(0);
  };
  const { pagination } = saved;
  const first = pagination && saved.reports.length > 0 ? pagination.offset + 1 : 0;
  const last = pagination ? pagination.offset + saved.reports.length : 0;

  let body;
  if (saved.status === 'loading') {
    body = <LoadingState label="Loading saved reports…" rows={5} />;
  } else if (saved.status === 'error') {
    body = (
      <ErrorState title="Saved reports could not be loaded" description={saved.error.message}>
        {saved.error.requestId ? (
          <p className="text-text-muted">Request ID: {saved.error.requestId}</p>
        ) : null}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={saved.reload}>
            Try again
          </Button>
        </div>
      </ErrorState>
    );
  } else if (pagination.total === 0) {
    body = (
      <EmptyState
        title={status === 'all' ? 'No saved reports yet' : 'No reports with this status'}
        description={
          status === 'all'
            ? 'Generate a report and it will appear here.'
            : 'Choose another status to see other saved reports.'
        }
      >
        {status === 'all' ? (
          <Button asChild size="sm">
            <Link to={PATHS.generateReport}>Generate new report</Link>
          </Button>
        ) : null}
      </EmptyState>
    );
  } else if (saved.reports.length === 0) {
    // Reports were removed or filtered since the previous page was shown.
    body = (
      <EmptyState
        title="This page is empty"
        description={`There are ${pagination.total} saved reports, but none on this page.`}
      >
        <Button type="button" size="sm" variant="outline" onClick={() => setPage(0)}>
          Back to the first page
        </Button>
      </EmptyState>
    );
  } else {
    body = (
      <>
        <Table containerClassName="rounded-md border">
          <TableCaption>Saved reports</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Report</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date range</TableHead>
              <TableHead>Selection</TableHead>
              <TableHead>Generated at</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {saved.reports.map((report) => {
              const when = generatedAt(report);
              const name = report.name ?? `Report ${report.reportId}`;
              return (
                <TableRow key={report.reportId}>
                  <TableCell className="whitespace-normal font-medium">{name}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <ReportStatusBadge status={report.status} />
                      {report.status === 'failed' && report.error ? (
                        <span className="text-xs text-text-muted">
                          {report.error.message ?? report.error.code}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal tabular-nums">
                    {describeDateRange(report.filters)}
                  </TableCell>
                  <TableCell className="whitespace-normal">{describeSelection(report.filters)}</TableCell>
                  <TableCell className="whitespace-normal tabular-nums">
                    {when ? formatDateTime(when) : '—'}
                    <span className="block text-xs text-text-muted">
                      {describeFreshness(report.provenance)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {report.status === 'completed' ? (
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          to={`/reports/${report.reportId}`}
                          aria-label={`View saved report ${name}`}
                          title="View saved report"
                        >
                          <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-text-muted" aria-live="polite">
            Showing {first}–{last} of {pagination.total}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!pagination.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <PageLayout
      title="Saved Reports"
      description="Reopen a saved report snapshot. Viewing never refreshes data from the source system. Reports are shared across the application; they are not private to a user."
      actions={
        <Button asChild size="sm">
          <Link to={PATHS.generateReport}>
            <FilePlus2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Generate new report
          </Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Status filter" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={status === option.value ? 'default' : 'outline'}
              aria-pressed={status === option.value}
              onClick={() => change(setStatus)(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={sortId} className="text-xs font-medium text-text-secondary">
              Sort by
            </label>
            <select
              id={sortId}
              className="h-8 rounded-sm border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
              value={sort}
              onChange={(event) => change(setSort)(event.target.value)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => change(setOrder)(order === 'desc' ? 'asc' : 'desc')}
          >
            <ArrowDownUp size={16} strokeWidth={1.75} aria-hidden="true" />
            {order === 'desc' ? 'Descending' : 'Ascending'}
          </Button>
        </div>
      </div>
      {body}
    </PageLayout>
  );
}
