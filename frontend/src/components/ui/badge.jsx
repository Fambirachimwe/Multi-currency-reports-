import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-surface text-text-secondary',
        accent: 'border-accent-primary text-accent-primary',
        success: 'border-success text-success',
        warning: 'border-warning text-warning',
        error: 'border-error text-error',
        usd: 'border-currency-usd text-currency-usd',
        zwg: 'border-currency-zwg text-currency-zwg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, ...props }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
