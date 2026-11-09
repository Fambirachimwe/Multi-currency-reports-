import { NavLink } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from '@/routes/paths';

/**
 * Primary navigation list. When `collapsed` it shows icons only; the label stays
 * in the DOM for screen readers and appears in a tooltip.
 */
export function SidebarNav({ collapsed = false, onNavigate }) {
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2 text-sidebar-foreground">
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ label, to, icon: Icon, end }) => (
          <li key={to}>
            <Tooltip open={collapsed ? undefined : false}>
              {/* Wrapper element: Slot would otherwise clobber NavLink's className function. */}
              <TooltipTrigger asChild>
                <div>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-sm border-l-2 border-transparent px-3 py-2 transition-colors hover:bg-hover hover:text-text-primary',
                        collapsed && 'justify-center px-0',
                        isActive &&
                          'border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={16}
                          strokeWidth={1.75}
                          aria-hidden="true"
                          className={isActive ? 'text-accent-primary' : 'text-text-muted'}
                        />
                        <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
                      </>
                    )}
                  </NavLink>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Desktop/tablet sidebar. Hidden below `md`, where the header opens a drawer instead. */
export function AppSidebar({ collapsed }) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r bg-sidebar transition-[width] md:flex',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <SidebarNav collapsed={collapsed} />
    </aside>
  );
}
