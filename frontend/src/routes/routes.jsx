import { ErrorFallback } from '@/components/error-fallback';
import { AppShell } from '@/components/layout/app-shell';
import { DashboardPage } from '@/pages/dashboard-page';
import { GenerateReportPage } from '@/pages/generate-report-page';
import { NodesPage } from '@/pages/nodes-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { ReportDetailsPage } from '@/pages/report-details-page';
import { SavedReportsPage } from '@/pages/saved-reports-page';
import { SettingsPage } from '@/pages/settings-page';
import { PATHS } from '@/routes/paths';

/** Route tree shared by the browser router and tests (memory router). */
export const routes = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <ErrorFallback />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: PATHS.generateReport, element: <GenerateReportPage /> },
      { path: PATHS.savedReports, element: <SavedReportsPage /> },
      { path: PATHS.reportDetails, element: <ReportDetailsPage /> },
      { path: PATHS.nodes, element: <NodesPage /> },
      { path: PATHS.settings, element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
