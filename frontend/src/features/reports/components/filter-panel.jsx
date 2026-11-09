import { useId } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Bordered selector panel (the screenshot-inspired filter tile): heading,
 * a concise selection summary, an optional validation message, then controls.
 */
export function FilterPanel({ title, icon: Icon, summary, error, children, className }) {
  const headingId = useId();
  return (
    <Card role="group" aria-labelledby={headingId} className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-0.5 border-b px-3 py-2">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-sm font-semibold text-text-primary"
        >
          {Icon ? (
            <Icon size={16} strokeWidth={1.75} className="text-text-muted" aria-hidden="true" />
          ) : null}
          {title}
        </h2>
        <p className="text-xs text-text-muted">{summary}</p>
        {error ? (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">{children}</div>
    </Card>
  );
}
