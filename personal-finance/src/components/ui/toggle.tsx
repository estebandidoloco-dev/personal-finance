'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

const ON_STATE =
  'data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:ring-2 data-[state=on]:ring-primary/40';

const toggleVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-(--control-radius) text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default: cn(
          'border border-transparent bg-transparent hover:bg-surface-subtle hover:text-text',
          ON_STATE
        ),
        outline: cn(
          'border border-border bg-surface shadow-xs hover:bg-surface-subtle hover:text-text',
          ON_STATE
        ),
        chip: 'rounded-full border border-transparent bg-surface-subtle text-text-muted hover:bg-surface data-[state=on]:bg-primary data-[state=on]:text-on-primary',
      },
      size: {
        default: 'h-9 min-w-9 px-3',
        sm: 'h-8 min-w-8 px-2.5',
        xs: 'h-6 min-w-6 px-2 text-xs',
        lg: 'h-10 min-w-10 px-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
