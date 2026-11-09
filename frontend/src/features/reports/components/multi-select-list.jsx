import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Searchable checkbox list with Select All (applies to the visible, filtered
 * options) and Clear. Selection is by stable id, never by label or index.
 */
export function MultiSelectList({
  label,
  options,
  selectedIds,
  onChange,
  disabled = false,
  emptyText = 'No options available.',
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const selected = new Set(selectedIds);

  const toggle = (id) => {
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };
  const selectAllVisible = () => {
    const merged = new Set([...selectedIds, ...visible.map((o) => o.id)]);
    onChange([...merged]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search {label}
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
          placeholder={`Search ${label}`}
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || visible.length === 0}
          onClick={selectAllVisible}
        >
          Select all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || selectedIds.length === 0}
          onClick={() => onChange([])}
        >
          Clear
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="py-2 text-text-muted">
          {needle ? `No ${label} match “${query}”.` : emptyText}
        </p>
      ) : (
        <ul
          aria-label={label}
          className="max-h-48 min-h-24 overflow-y-auto rounded-sm border bg-background xl:max-h-none xl:flex-1"
        >
          {visible.map((option) => (
            <li key={option.id}>
              <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-hover">
                <input
                  type="checkbox"
                  className="size-4 accent-accent-primary"
                  checked={selected.has(option.id)}
                  disabled={disabled}
                  onChange={() => toggle(option.id)}
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
