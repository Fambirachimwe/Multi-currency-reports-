import { cn } from '@/lib/utils';

/** Scroll container + table. Give `containerClassName` a max height to get a sticky header. */
function Table({ className, containerClassName, ...props }) {
  return (
    <div
      data-slot="table-container"
      // Scrollable regions must be keyboard reachable.
      tabIndex={0}
      className={cn('relative w-full overflow-auto', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full border-collapse text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }) {
  return (
    <thead data-slot="table-header" className={cn('sticky top-0 z-10', className)} {...props} />
  );
}

function TableBody({ className, ...props }) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableRow({ className, ...props }) {
  return (
    <tr
      data-slot="table-row"
      className={cn('transition-colors hover:bg-hover', className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'whitespace-nowrap border-b border-r bg-surface px-3 py-2 text-left text-xs font-medium text-text-secondary last:border-r-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'whitespace-nowrap border-b border-r px-3 py-1.5 text-text-primary last:border-r-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }) {
  return <caption className={cn('sr-only', className)} {...props} />;
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow };
