import * as React from 'react';
import { cn } from '@/lib/cn';

const nativeSelectClassName =
  'h-(--control-height) w-full rounded-(--control-radius) [border-width:var(--control-border-width)] border-(--control-border-color) bg-background [background-image:linear-gradient(var(--control-fill),var(--control-fill))] px-[calc(var(--control-padding-x)-0.25rem)] text-sm shadow-(--control-shadow) outline-none focus-visible:border-ring focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_option]:bg-background [&_option]:text-foreground';

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(nativeSelectClassName, className)}
      {...props}
    />
  );
}

export { NativeSelect };
