import * as React from 'react';
import { cn } from '@/lib/cn';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-(--control-radius) border border-border bg-surface px-3 py-2 text-base shadow-xs transition-all outline-none placeholder:text-text-subtle focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger md:text-sm',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
