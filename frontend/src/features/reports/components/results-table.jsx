import { RefreshCw, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { CurrencyTag } from '@/components/currency-tag';
import { EmptyState } from '@/components/data-states';
import { NotConnectedButton } from '@/components/not-connected-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExportAction } from '@/features/reports/components/export-action';
import { formatAmount, formatQuantity } from '@/lib/format';

const CURRENCY_ORDER = ['USD', 'ZWG'];

/** USD, ZWG, other codes alphabetically, UNKNOWN last. */
function sortCurrencies(codes) {
  const rank = (code) => {
    if (code === 'UNKNOWN') return 1000;
    const known = CURRENCY_ORDER.indexOf(code);
    return known === -1 ? 100 : known;
  };
  return [...codes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function matches(row, query, currency) {
  if (currency !== 'ALL' && row.currency !== currency) return false;
  if (query === '') return true;
  const haystack = `${row.nodeName} ${row.brandName} ${row.productName ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

const numeric = 'text-right tabular-nums';

function SummaryGrid({ rows }) {
  return (
    <Table containerClassName="max-h-[28rem] rounded-md border">
      <TableCaption>Summary by node and currency</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Node</TableHead>
          <TableHead>Brand</TableHead>
          <TableHead>Currency</TableHead>
          <TableHead className={numeric}>Quantity</TableHead>
          <TableHead className={numeric}>Turnover</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.nodeName}</TableCell>
            <TableCell>{row.brandName}</TableCell>
            <TableCell>
              <CurrencyTag currency={row.currency} />
            </TableCell>
            <TableCell className={numeric}>{formatQuantity(row.quantity)}</TableCell>
            <TableCell className={numeric}>
              {formatAmount(row.turnover)} <span className="text-text-muted">{row.currency}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DetailGrid({ rows }) {
  return (
    <Table containerClassName="max-h-[28rem] rounded-md border">
      <TableCaption>Detailed product sales by node and currency</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Node</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Currency</TableHead>
          <TableHead className={numeric}>Quantity</TableHead>
          <TableHead className={numeric}>Turnover</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.nodeName}</TableCell>
            <TableCell>{row.departmentName}</TableCell>
            <TableCell>{row.productName}</TableCell>
            <TableCell>
              <CurrencyTag currency={row.currency} />
            </TableCell>
            <TableCell className={numeric}>{formatQuantity(row.quantity)}</TableCell>
            <TableCell className={numeric}>
              {formatAmount(row.turnover)} <span className="text-text-muted">{row.currency}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Reporting toolbar + Summary/Detailed views over one saved report. Search and
 * the currency filter only narrow which rows are displayed; nothing is recomputed.
 */
export function ResultsTable({ report }) {
  const [query, setQuery] = useState('');
  const [currency, setCurrency] = useState('ALL');
  const searchId = useId();

  const currencies = useMemo(
    () => sortCurrencies(new Set(report.detailRows.map((row) => row.currency))),
    [report.detailRows],
  );
  const needle = query.trim().toLowerCase();
  const summary = report.summaryRows.filter((row) => matches(row, needle, currency));
  const detail = report.detailRows.filter((row) => matches(row, needle, currency));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-xs">
          <label htmlFor={searchId} className="text-xs font-medium text-text-secondary">
            Search results
          </label>
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-2.5 top-2.5 text-text-muted"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              className="pl-8"
              placeholder="Node, brand or product"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div role="group" aria-label="Currency display" className="flex flex-wrap gap-1">
          {['ALL', ...currencies].map((code) => (
            <Button
              key={code}
              type="button"
              size="sm"
              variant={currency === code ? 'default' : 'outline'}
              aria-pressed={currency === code}
              onClick={() => setCurrency(code)}
            >
              {code === 'ALL' ? 'All currencies' : code}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 md:ml-auto">
          <NotConnectedButton icon={RefreshCw}>Re-generate</NotConnectedButton>
          <ExportAction status={report.status} />
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList aria-label="Report view">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="detailed">Detailed</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          {summary.length === 0 ? (
            <EmptyState
              title="No rows match"
              description="Clear the search or choose another currency."
            />
          ) : (
            <SummaryGrid rows={summary} />
          )}
        </TabsContent>
        <TabsContent value="detailed">
          {detail.length === 0 ? (
            <EmptyState
              title="No rows match"
              description="Clear the search or choose another currency."
            />
          ) : (
            <DetailGrid rows={detail} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
