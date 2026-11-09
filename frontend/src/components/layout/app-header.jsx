import { FileSpreadsheet, Menu, PanelLeft } from 'lucide-react';
import { Link } from 'react-router';
import { DemoBadge } from '@/components/demo-badge';
import { Button } from '@/components/ui/button';
import { PATHS } from '@/routes/paths';

/**
 * Narrow top header: menu control, product name and a demo-data marker.
 * No account controls: v1 has no authentication.
 * Below `md` the menu button opens the drawer; from `md` up it collapses the sidebar.
 */
export function AppHeader({ sidebarCollapsed, onToggleSidebar, onOpenMobileNav }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 sm:px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation menu"
        onClick={onOpenMobileNav}
      >
        <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={20} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <Link
        to={PATHS.dashboard}
        className="flex min-w-0 items-center gap-2 rounded-sm font-semibold text-text-primary"
      >
        <FileSpreadsheet
          size={20}
          strokeWidth={1.75}
          className="shrink-0 text-accent-primary"
          aria-hidden="true"
        />
        <span className="truncate">Multi-Currency Sales Reporting</span>
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DemoBadge>Demo data</DemoBadge>
      </div>
    </header>
  );
}
