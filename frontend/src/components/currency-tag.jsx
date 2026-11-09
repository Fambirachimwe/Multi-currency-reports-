import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const VARIANTS = { USD: 'usd', ZWG: 'zwg' };

/** Currency code is always visible text; colour is supplemental. UNKNOWN is flagged, never styled as USD. */
export function CurrencyTag({ currency }) {
  if (currency === 'UNKNOWN') {
    return (
      <Badge variant="warning">
        <AlertTriangle aria-hidden="true" />
        UNKNOWN
      </Badge>
    );
  }
  return <Badge variant={VARIANTS[currency] ?? 'default'}>{currency}</Badge>;
}
