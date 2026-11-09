import { Card } from '@/components/ui/card';
import { CurrencyBreakdown } from '@/features/reports/components/currency-breakdown';
import { SummaryCards } from '@/features/reports/components/summary-cards';
import { describeDateRange, describeFreshness } from '@/features/reports/saved-reports';
import { formatDateTime } from '@/lib/format';

function Item({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-text-secondary">{label}</dt>
      <dd className="text-text-primary">{children}</dd>
    </div>
  );
}

const when = (iso) => (iso ? formatDateTime(iso) : '—');

/** Date range, selected filters and source freshness of a saved report, as stored. */
export function SavedReportDetails({ report }) {
  const { filters, provenance } = report;
  return (
    <Card>
      <dl className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Item label="Date range">{describeDateRange(filters)}</Item>
        <Item label="Generated at">{when(report.completedAt ?? report.failedAt)}</Item>
        <Item label="Source data fetched at">{when(provenance?.fetchedAt)}</Item>
        <Item label="Source data">{describeFreshness(provenance)}</Item>
        <Item label="Products">{filters.productIds.length} selected</Item>
        <Item label="Nodes">{filters.nodeIds.length} selected</Item>
        <Item label="Brands">
          {filters.brandIds.length > 0 ? `${filters.brandIds.length} selected` : 'None selected'}
        </Item>
        <Item label="Saved lines">{report.rowCount ?? '—'}</Item>
      </dl>
      <details className="border-t px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-text-secondary">
          Calculation version
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Item label="Calculation version">{report.calculationVersion ?? '—'}</Item>
        </dl>
      </details>
    </Card>
  );
}

/** Per-currency KPI panels plus the currency breakdown, all from the saved snapshot. */
export function SavedReportSummary({ report }) {
  return (
    <div className="flex flex-col gap-4">
      {report.totals.length === 0 ? null : <SummaryCards totals={report.totals} />}
      {report.totals.length === 0 ? null : <CurrencyBreakdown report={report} />}
    </div>
  );
}
