import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--control-radius)] text-[length:var(--control-font-size)] [font-weight:var(--control-weight)] [letter-spacing:var(--control-tracking)] [text-transform:var(--control-transform)] whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 active:[transform:var(--control-active-transform)]",
  {
    variants: {
      variant: {
        default:
          '[border-width:var(--control-border-width)] border-transparent bg-primary text-primary-foreground shadow-[var(--control-shadow)] hover:bg-primary-hover',
        destructive:
          '[border-width:var(--control-border-width)] border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          '[border-width:var(--control-border-width)] border-[var(--control-border-color)] bg-[var(--control-fill)] shadow-[var(--control-shadow)] hover:bg-accent hover:text-accent-foreground',
        secondary:
          '[border-width:var(--control-border-width)] border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        row: 'h-auto justify-start text-left text-sm font-normal whitespace-normal [letter-spacing:normal] [text-transform:none] hover:bg-accent/50',
      },
      size: {
        default:
          'h-[var(--control-height)] px-[var(--control-padding-x)] py-2 has-[>svg]:px-3',
        xs: 'h-6 gap-1 rounded-[var(--control-radius)] px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*=\'size-\'])]:size-3',
        sm: 'h-8 gap-1.5 rounded-[var(--control-radius)] px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-[var(--control-radius)] px-6 has-[>svg]:px-4',
        icon: 'size-[var(--control-height)]',
        'icon-xs':
          'size-6 rounded-[var(--control-radius)] [&_svg:not([class*=\'size-\'])]:size-3',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
