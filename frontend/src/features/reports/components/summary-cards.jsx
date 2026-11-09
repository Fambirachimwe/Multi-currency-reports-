import { CurrencyTag } from '@/components/currency-tag';
import { Card } from '@/components/ui/card';
import { formatAmount, formatQuantity } from '@/lib/format';

/**
 * One card per currency. Totals come from a saved report and are shown as
 * given: currencies are never added together.
 */
export function SummaryCards({ totals }) {
  if (totals.length === 0) return null;
  return (
    <ul aria-label="Totals by currency" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {totals.map((total) => (
        <li key={total.currency}>
          <Card className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-secondary">Turnover</span>
              <CurrencyTag currency={total.currency} />
            </div>
            <p className="text-xl font-semibold tabular-nums text-text-primary">
              <span className="sr-only">{total.currency} </span>
              {formatAmount(total.turnover)}
              <span aria-hidden="true" className="ml-1.5 text-sm font-medium text-text-muted">
                {total.currency}
              </span>
            </p>
            <p className="text-xs tabular-nums text-text-muted">
              Quantity: {formatQuantity(total.quantity)}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
