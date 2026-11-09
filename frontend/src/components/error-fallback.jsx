import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Generic, non-technical error panel shared by the error boundary and router errors. */
export function ErrorFallback({ onRetry }) {
  return (
    <div
      role="alert"
      className="m-6 flex max-w-xl flex-col gap-3 rounded-md border border-error/60 bg-surface p-4"
    >
      <div className="flex items-center gap-2 font-semibold text-error">
        <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
        Something went wrong
      </div>
      <p className="text-text-muted">
        This part of the application failed to load. Try again, or reload the page if the problem
        continues.
      </p>
      {onRetry ? (
        <div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
