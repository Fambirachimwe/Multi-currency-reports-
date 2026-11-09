import { CalendarDays } from 'lucide-react';
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { FilterPanel } from '@/features/reports/components/filter-panel';
import {
  configuredMaxRangeDays,
  fromInputValue,
  inclusiveDayCount,
  toInputValue,
  todayInReportingTimezone,
} from '@/features/reports/date-range';

/**
 * Start/end calendar dates (stored as YYYYMMDD like GAAP's createdDate filter; no timezone). The range is inclusive of both days.
 * Days are Africa/Harare (CAT); future dates are not allowed. GAAP createdDate boundary handling
 * is an open decision.
 */
export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  errors = {},
  maxDays = configuredMaxRangeDays(),
}) {
  const startId = useId();
  const endId = useId();
  const startErrorId = useId();
  const endErrorId = useId();
  const today = todayInReportingTimezone();
  const days = inclusiveDayCount(startDate, endDate);
  const summary =
    startDate && endDate
      ? `${startDate} → ${endDate}${days && days > 0 ? ` (${days} day${days === 1 ? '' : 's'})` : ''}`
      : 'No range selected';
  return (
    <FilterPanel title="Date range" icon={CalendarDays} summary={summary}>
      <div className="flex flex-col gap-1">
        <label htmlFor={startId} className="text-xs font-medium text-text-secondary">
          Start date
        </label>
        <Input
          id={startId}
          type="date"
          value={toInputValue(startDate)}
          max={toInputValue(endDate && endDate < today ? endDate : today)}
          aria-invalid={Boolean(errors.startDate)}
          aria-describedby={errors.startDate ? startErrorId : undefined}
          onChange={(event) => onChange({ startDate: fromInputValue(event.target.value) })}
        />
        {errors.startDate ? (
          <p id={startErrorId} role="alert" className="text-xs text-error">
            {errors.startDate}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={endId} className="text-xs font-medium text-text-secondary">
          End date
        </label>
        <Input
          id={endId}
          type="date"
          value={toInputValue(endDate)}
          min={toInputValue(startDate) || undefined}
          max={toInputValue(today)}
          aria-invalid={Boolean(errors.endDate)}
          aria-describedby={errors.endDate ? endErrorId : undefined}
          onChange={(event) => onChange({ endDate: fromInputValue(event.target.value) })}
        />
        {errors.endDate ? (
          <p id={endErrorId} role="alert" className="text-xs text-error">
            {errors.endDate}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-text-muted">
        Both days are included. Days are in Harare time (CAT, UTC+2); future dates are not allowed.
        Maximum range: {maxDays} days. How a day maps to GAAP&apos;s createdDate is not confirmed
        yet.
      </p>
    </FilterPanel>
  );
}
