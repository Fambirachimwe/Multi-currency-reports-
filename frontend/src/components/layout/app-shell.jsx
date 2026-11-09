import { useState } from 'react';
import { Outlet } from 'react-router';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppHeader } from '@/components/layout/app-header';
import { AppSidebar, SidebarNav } from '@/components/layout/app-sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Full-height dark workspace: header on top, collapsible sidebar on the left
 * (md and up), a navigation drawer below md, and the routed page in the main
 * slot. Page render errors are contained in the main slot so navigation stays
 * usable.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AppHeader
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((value) => !value)}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <div className="flex min-h-0 flex-1">
          <AppSidebar collapsed={collapsed} />
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-auto">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent title="Navigation" description="Primary navigation links">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
