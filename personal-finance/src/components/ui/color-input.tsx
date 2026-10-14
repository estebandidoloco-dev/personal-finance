import * as React from 'react';
import { cn } from '@/lib/cn';

function ColorInput({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="color"
      data-slot="color-input"
      className={cn(
        'h-8 w-8 shrink-0 cursor-pointer appearance-none rounded-(--control-radius) border border-border bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0',
        className
      )}
      {...props}
    />
  );
}

export { ColorInput };
