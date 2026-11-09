import { Building2, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { ErrorState } from '@/components/data-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterPanel } from '@/features/reports/components/filter-panel';
import { groupDepartments } from '@/features/reports/filters';

/**
 * Department / category browser: group > department with product counts. Choosing a department
 * only changes which products are listed; it never changes the product selection.
 */
export function DepartmentPicker({
  status = 'success',
  loadError,
  onRetry,
  departments,
  value,
  onChange,
}) {
  const radioName = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visibleDepartments = needle
    ? departments.filter((d) => d.name.toLowerCase().includes(needle))
    : departments;
  const selected = departments.find((d) => d.id === value);
  const summary =
    status === 'loading'
      ? 'Loading departments…'
      : status === 'error'
        ? 'Departments unavailable'
        : selected
          ? `Browsing ${selected.name}`
          : `${departments.length} department${departments.length === 1 ? '' : 's'}`;

  return (
    <FilterPanel title="Department / category" icon={Building2} summary={summary}>
      {status === 'loading' ? (
        <p role="status" className="text-text-muted">
          Loading departments…
        </p>
      ) : null}
      {status === 'error' ? (
        <ErrorState title="Departments could not be loaded" description={loadError?.message}>
          {loadError?.requestId ? (
            <p className="text-xs text-text-muted">Request ID: {loadError.requestId}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onRetry}
          >
            Try again
          </Button>
        </ErrorState>
      ) : null}
      {status === 'success' && departments.length === 0 ? (
        <p className="text-text-muted">No departments returned.</p>
      ) : null}
      {status === 'success' && departments.length > 0 ? (
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            Search departments
          </label>
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
            placeholder="Search departments"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      {status === 'success' && departments.length > 0 && visibleDepartments.length === 0 ? (
        <p className="text-text-muted">No departments match “{query}”.</p>
      ) : null}
      {status === 'success' ? (
        <div className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto xl:min-h-0">
          {groupDepartments(visibleDepartments).map((group) => (
            <div
              key={group.id}
              role="radiogroup"
              aria-label={group.name}
              className="flex flex-col gap-0.5"
            >
              <p className="px-2 text-xs font-medium uppercase text-text-muted">{group.name}</p>
              {group.departments.map((department) => (
                <label
                  key={department.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-hover"
                >
                  <input
                    type="radio"
                    name={radioName}
                    className="size-4 accent-accent-primary"
                    value={department.id}
                    checked={value === department.id}
                    onChange={() => onChange(department.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{department.name}</span>
                  <span
                    className="text-xs text-text-muted"
                    aria-label={`${department.productCount} products`}
                  >
                    {department.productCount}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </FilterPanel>
  );
}
