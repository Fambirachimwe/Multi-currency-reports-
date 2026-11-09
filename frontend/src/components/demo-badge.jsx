import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Marks any fixture-backed view. Required wherever mock data is shown. */
export function DemoBadge({ children = 'Demo data', className }) {
  return (
    <Badge variant="warning" className={className}>
      <FlaskConical aria-hidden="true" />
      {children}
    </Badge>
  );
}

/** Banner placed at the top of a fixture-backed page body. */
export function DemoNotice({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning bg-surface px-3 py-2 text-text-secondary">
      <DemoBadge className="mt-0.5">Demo / mock</DemoBadge>
      <p>
        {children ??
          'This screen shows local demo fixtures. It is not connected to GAAP Unity, MongoDB or the backend, and is not live-integration evidence.'}
      </p>
    </div>
  );
}
