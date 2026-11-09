import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex gap-2 rounded-md border bg-surface px-3 py-2.5 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: '[&_svg]:text-accent-primary',
        warning: 'border-warning [&_svg]:text-warning',
        error: 'border-error [&_svg]:text-error',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** Icon (first child, decorative) + text. Role is `alert` for errors, `status` otherwise. */
function Alert({ className, variant, ...props }) {
  return (
    <div
      data-slot="alert"
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert };
