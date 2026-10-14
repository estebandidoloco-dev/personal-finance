import * as React from 'react';
import { cn } from '@/lib/cn';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-(--control-height) w-full min-w-0 rounded-(--control-radius) [border-width:max(var(--control-border-width,1px),1px)] border-border bg-surface px-3 py-1.5 text-base shadow-xs transition-all outline-none selection:bg-primary selection:text-on-primary placeholder:text-text-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20',
        'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20',
        className
      )}
      {...props}
    />
  );
}

export { Input };
