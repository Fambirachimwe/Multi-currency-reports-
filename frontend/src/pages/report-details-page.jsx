import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/data-states';
import { PageLayout } from '@/components/layout/page-layout';
import { ReportStatusBadge } from '@/components/report-status-badge';
import { Button } from '@/components/ui/button';
import { ExportAction } from '@/features/reports/components/export-action';
import { ReportRowsTable } from '@/features/reports/components/report-rows-table';
import {
  SavedReportDetails,
  SavedReportSummary,
} from '@/features/reports/components/saved-report-summary';
import { useSavedReport } from '@/features/reports/use-saved-report';
import { PATHS } from '@/routes/paths';

const backLink = (
  <Button asChild variant="outline" size="sm">
    <Link to={PATHS.savedReports}>
      <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      Saved Reports
    </Link>
  </Button>
);

/** /reports/:reportId — one saved report snapshot, read from the application's own saved data. */
export function ReportDetailsPage() {
  const { reportId } = useParams();
  const saved = useSavedReport(reportId);
  const { report } = saved;

  if (saved.status === 'loading') {
    return (
      <PageLayout title="Saved report" actions={backLink}>
        <LoadingState label="Loading the saved report…" rows={4} />
      </PageLayout>
    );
  }
  if (saved.status === 'notfound') {
    return (
      <PageLayout title="Report not found" actions={backLink}>
        <EmptyState
          title="No saved report with this ID"
          description="The link may be wrong, or the report may not exist."
        />
      </PageLayout>
    );
  }
  if (saved.status === 'error') {
    return (
      <PageLayout title="Saved report" actions={backLink}>
        <ErrorState title="The saved report could not be loaded" description={saved.error.message}>
          {saved.error.requestId ? (
            <p className="text-text-muted">Request ID: {saved.error.requestId}</p>
          ) : null}
          <div>
            <Button type="button" size="sm" variant="outline" onClick={saved.reload}>
              Try again
            </Button>
          </div>
        </ErrorState>
      </PageLayout>
    );
  }

  let body;
  if (report.status === 'pending') {
    body = (
      <>
        <LoadingState label="Report is still being generated" rows={3} />
        <p className="text-text-muted">
          This report is still being generated, so there is nothing to show yet.
        </p>
        <div>
          <Button type="button" size="sm" variant="outline" onClick={saved.reload}>
            Check again
          </Button>
        </div>
      </>
    );
  } else if (report.status === 'failed') {
    body = (
      <ErrorState title="This report failed" description={report.error?.message ?? undefined}>
        {report.error?.code ? (
          <p className="text-text-muted">Error code: {report.error.code}</p>
        ) : null}
        <p className="text-text-muted">
          No partial data is shown for a failed report, and it cannot be exported.
        </p>
      </ErrorState>
    );
  } else {
    body = (
      <>
        <SavedReportDetails report={report} />
        <SavedReportSummary report={report} />
        <ReportRowsTable report={report} />
      </>
    );
  }

  return (
    <PageLayout
      title="Saved report"
      description={report.name ?? `Report ${report.reportId}`}
      actions={
        <>
          <ReportStatusBadge status={report.status} />
          <ExportAction status={report.status} reportId={report.reportId} />
          {backLink}
        </>
      }
    >
      <p className="text-text-muted">
        You are viewing a saved snapshot, not a fresh run. Opening it never refreshes data from the
        source system; regenerating creates a new report.
      </p>
      {body}
    </PageLayout>
  );
}
