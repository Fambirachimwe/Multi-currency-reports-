import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const STATUS = {
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle2 },
  pending: { label: 'In progress', variant: 'accent', icon: Loader2 },
  failed: { label: 'Failed', variant: 'error', icon: XCircle },
};

/** Status is conveyed by icon and text, not colour alone. */
export function ReportStatusBadge({ status }) {
  const config = STATUS[status];
  if (!config) return <Badge>{status}</Badge>;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
