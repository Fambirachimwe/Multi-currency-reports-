import { Bookmark, Building2, FilePlus2, LayoutDashboard, Settings } from 'lucide-react';

/** Route paths used across the app. Keep links pointed at these constants. */
export const PATHS = Object.freeze({
  dashboard: '/',
  generateReport: '/reports/new',
  savedReports: '/reports',
  reportDetails: '/reports/:reportId',
  nodes: '/nodes',
  settings: '/settings',
});

/** Primary sidebar navigation, in display order. Report Details is reached from Saved Reports. */
export const NAV_ITEMS = Object.freeze([
  { label: 'Dashboard', to: PATHS.dashboard, icon: LayoutDashboard, end: true },
  { label: 'Generate Report', to: PATHS.generateReport, icon: FilePlus2, end: true },
  { label: 'Saved Reports', to: PATHS.savedReports, icon: Bookmark, end: true },
  { label: 'Nodes & Brands', to: PATHS.nodes, icon: Building2, end: false },
  { label: 'Settings', to: PATHS.settings, icon: Settings, end: false },
]);
