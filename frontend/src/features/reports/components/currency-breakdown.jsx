import { AlertTriangle } from 'lucide-react';
import { useId, useState } from 'react';
import { CurrencyTag } from '@/components/currency-tag';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  UNKNOWN_CURRENCY,
  buildCurrencySections,
  filterCurrencySections,
} from '@/features/reports/currency-breakdown';
import { GroupTable } from '@/features/reports/components/group-table';
import { formatAmount, formatQuantity } from '@/lib/format';

function CurrencySection({ section }) {
  const { currency, totals, products, nodes } = section;
  const headingId = useId();
  const unknown = currency === UNKNOWN_CURRENCY;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
            <CurrencyTag currency={currency} />
            <span>{unknown ? 'Unclassified currency' : `${currency} sales`}</span>
          </h3>
          {totals ? (
            <p className="text-sm tabular-nums text-text-primary">
              <span className="text-text-muted">
                {totals.lineCount} line{totals.lineCount === 1 ? '' : 's'} · quantity{' '}
                {formatQuantity(totals.quantity)} ·
              </span>{' '}
              {formatAmount(totals.turnover)} {currency}
            </p>
          ) : null}
        </div>
        {unknown ? (
          <Alert variant="warning">
            <AlertTriangle strokeWidth={1.75} aria-hidden="true" />
            <p className="text-text-secondary">
              The currency of these lines could not be determined from the source data. They are
              kept apart: they are not USD, ZWG or any other currency, and are never converted or
              added to another currency&apos;s totals.
            </p>
          </Alert>
        ) : null}
        {totals ? null : (
          <p className="text-text-muted">No {currency} lines in this report.</p>
        )}
      </Card>
      {totals ? (
        <>
          <GroupTable
            caption={`${currency} totals by product`}
            idLabel="Product"
            groups={products}
          />
          <GroupTable caption={`${currency} totals by node`} idLabel="Node" groups={nodes} />
        </>
      ) : null}
    </section>
  );
}

/**
 * Currency-specific breakdown of a saved report: USD, ZWG, any additional currency, and UNKNOWN
 * separately. The filter only chooses which sections are visible; every figure is the saved one and
 * is never recalculated, so the report's persisted totals are unaffected.
 */
export function CurrencyBreakdown({ report }) {
  const [filter, setFilter] = useState('all');
  const titleId = useId();
  const sections = buildCurrencySections(report.totals, report.summary);
  const visible = filterCurrencySections(sections, filter);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="text-base font-semibold text-text-primary">
        Currency breakdown
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-text-secondary">
          Choose which currency sections to show. This does not change the saved totals.
        </p>
        <div role="group" aria-label="Show currency sections" className="flex flex-wrap gap-1">
          {['all', ...sections.map((section) => section.currency)].map((code) => (
            <Button
              key={code}
              type="button"
              size="sm"
              variant={filter === code ? 'default' : 'outline'}
              aria-pressed={filter === code}
              onClick={() => setFilter(code)}
            >
              {code === 'all' ? 'All sections' : code}
            </Button>
          ))}
        </div>
      </div>
      {visible.map((section) => (
        <CurrencySection key={section.currency} section={section} />
      ))}
    </section>
  );
}
