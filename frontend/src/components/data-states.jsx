import { AlertCircle, Inbox } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

/** Skeleton rows shown while content loads; never a blank grid. */
export function LoadingState({ label = 'Loading…', rows = 6 }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-md border p-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-6 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, children }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center">
      <Inbox size={20} strokeWidth={1.75} className="text-text-muted" aria-hidden="true" />
      <p className="font-semibold text-text-primary">{title}</p>
      {description ? <p className="max-w-prose text-text-muted">{description}</p> : null}
      {children}
    </div>
  );
}

/** Error view. Shows a fixed, user-safe message and never raw error detail. */
export function ErrorState({ title = 'Something went wrong', description, children }) {
  return (
    <Alert variant="error">
      <AlertCircle strokeWidth={1.75} aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-text-primary">{title}</p>
        {description ? <p className="text-text-secondary">{description}</p> : null}
        {children}
      </div>
    </Alert>
  );
}
