import { cn } from '@/lib/utils';

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-md border bg-card text-card-foreground', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1 border-b px-4 py-3', className)}
      {...props}
    />
  );
}

function CardTitle({ as: Comp = 'h2', className, ...props }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn('text-sm font-semibold text-text-primary', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }) {
  return <p data-slot="card-description" className={cn('text-text-muted', className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
