import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { CurrencyTag } from '@/components/currency-tag';
import { EmptyState, ErrorState, LoadingState } from '@/components/data-states';
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
import { useReportRows } from '@/features/reports/use-report-rows';
import { formatAmount, formatDateTime, formatQuantity } from '@/lib/format';

export const ROW_PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

/** Columns the server can sort by (its allowlist), with the label shown in the header. */
const COLUMNS = Object.freeze([
  { sort: 'productName', label: 'Product' },
  { sort: 'nodeName', label: 'Node' },
  { sort: 'transactionAt', label: 'Date' },
  { sort: 'currency', label: 'Currency' },
  { sort: 'quantity', label: 'Quantity', numeric: true },
  { sort: 'turnover', label: 'Turnover', numeric: true },
]);

function SortHeader({ column, sort, order, onSort }) {
  const active = sort === column.sort;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={column.numeric ? 'text-right' : undefined}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm font-medium hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSort(column.sort)}
      >
        {column.label}
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

/** Per-currency totals of everything matching the search/filter, as computed by the server. */
function MatchingTotals({ totals, filtered }) {
  if (totals.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-text-secondary">
        {filtered
          ? 'Totals for the matching lines only (not the whole report)'
          : 'Totals for all saved lines (the same as the report totals)'}
      </p>
      <ul aria-label="Totals for the lines shown" className="flex flex-wrap gap-2">
        {totals.map((total) => (
          <li key={total.currency} className="rounded-md border px-3 py-1.5 text-sm tabular-nums">
            <CurrencyTag currency={total.currency} />{' '}
            <span className="text-text-muted">
              {total.lineCount} line{total.lineCount === 1 ? '' : 's'} · quantity{' '}
              {formatQuantity(total.quantity)} ·
            </span>{' '}
            {formatAmount(total.turnover)} {total.currency}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Detail lines of one saved report, one server page at a time. Search, currency filter, sorting and
 * paging are all done by the server over the saved rows of this report only; the browser never
 * receives the whole report and never recalculates a total.
 * @param {{ report: { reportId: string, rowCount: number|null, totals: Array<{ currency: string }> } }} props
 */
function ReportRowsPanel({ report }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('all');
  const [sort, setSort] = useState('lineIndex');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(0);
  const searchId = useId();

  // Wait for a pause in typing before asking the server; one request per search, not per keystroke.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(trimmed);
      setPage(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  const rows = useReportRows({
    reportId: report.reportId,
    search,
    currency,
    sort,
    order,
    page,
    pageSize: ROW_PAGE_SIZE,
  });
  const { pagination } = rows;
  const filtered = search !== '' || currency !== 'all';
  const currencies = (report.totals ?? []).map((total) => total.currency);

  const changeSort = (field) => {
    if (field === sort) setOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(field);
      setOrder('asc');
    }
    setPage(0);
  };
  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setCurrency('all');
    setPage(0);
  };

  let body;
  if (rows.status === 'loading') {
    body = <LoadingState label="Loading report lines…" rows={5} />;
  } else if (rows.status === 'error') {
    body = (
      <ErrorState title="The report lines could not be loaded" description={rows.error.message}>
        {rows.error.requestId ? (
          <p className="text-text-muted">Request ID: {rows.error.requestId}</p>
        ) : null}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={rows.reload}>
            Try again
          </Button>
        </div>
      </ErrorState>
    );
  } else if (pagination.total === 0) {
    body = (
      <EmptyState
        title={filtered ? 'No lines match' : 'No saved lines'}
        description={
          filtered
            ? 'Change or clear the search and currency filter to see other lines.'
            : 'This report has no lines to show.'
        }
      >
        {filtered ? (
          <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
            Clear search and filter
          </Button>
        ) : null}
      </EmptyState>
    );
  } else if (rows.rows.length === 0) {
    body = (
      <EmptyState
        title="This page is empty"
        description={`There are ${pagination.total} matching lines, but none on this page.`}
      >
        <Button type="button" size="sm" variant="outline" onClick={() => setPage(0)}>
          Back to the first page
        </Button>
      </EmptyState>
    );
  } else {
    const first = pagination.offset + 1;
    const last = pagination.offset + rows.rows.length;
    body = (
      <>
        <Table containerClassName="rounded-md border">
          <TableCaption>Saved report lines</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((column) => (
                <SortHeader
                  key={column.sort}
                  column={column}
                  sort={sort}
                  order={order}
                  onSort={changeSort}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.rows.map((row) => (
              <TableRow key={row.lineIndex}>
                <TableCell>
                  <span className="font-medium">{row.productName ?? row.productId}</span>
                </TableCell>
                <TableCell>{row.nodeName ?? row.nodeId}</TableCell>
                <TableCell className="tabular-nums">{formatDateTime(row.transactionAt)}</TableCell>
                <TableCell>
                  <CurrencyTag currency={row.currency} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(row.quantity)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(row.turnover)} {row.currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-text-muted" aria-live="polite">
            Showing {first}–{last} of {pagination.total} line{pagination.total === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!pagination.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby={`${searchId}-title`} className="flex flex-col gap-3">
      <h2 id={`${searchId}-title`} className="text-base font-semibold text-text-primary">
        Report lines
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-xs">
          <label htmlFor={searchId} className="text-xs font-medium text-text-secondary">
            Search lines
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
              placeholder="Product or node name"
              maxLength={100}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
        {currencies.length > 1 ? (
          <div role="group" aria-label="Currency filter" className="flex flex-wrap gap-1">
            {['all', ...currencies].map((code) => (
              <Button
                key={code}
                type="button"
                size="sm"
                variant={currency === code ? 'default' : 'outline'}
                aria-pressed={currency === code}
                onClick={() => {
                  setCurrency(code);
                  setPage(0);
                }}
              >
                {code === 'all' ? 'Any currency' : code}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {rows.status === 'success' ? (
        <MatchingTotals totals={rows.totals} filtered={filtered} />
      ) : null}
      {body}
    </section>
  );
}

/** The saved lines of a completed report; a report with no lines never asks the server for any. */
export function ReportRowsTable({ report }) {
  if (report.rowCount === 0) {
    return (
      <EmptyState
        title="This report has no saved lines"
        description="No sales lines matched the selection when the report was generated."
      />
    );
  }
  return <ReportRowsPanel report={report} />;
}
