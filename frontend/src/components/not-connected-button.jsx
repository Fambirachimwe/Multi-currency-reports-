import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * A control whose feature does not exist yet. It is always disabled and always
 * says why, so it can never be mistaken for a working action.
 */
export function NotConnectedButton({ icon: Icon, children, reason = 'Not connected', ...props }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled {...props}>
        {Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
        {children}
      </Button>
      <Badge>{reason}</Badge>
    </span>
  );
}
