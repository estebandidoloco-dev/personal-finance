import type { CSSProperties } from 'react';
import type { ThemeConfig } from '@/types/theme';
import { cn } from '@/lib/cn';
import { resolveCustomVars } from '@/lib/theme/theme-resolver';

/**
 * A miniature, fully accurate rendering of a theme: every color, radius and
 * shadow comes from the exact same resolver the real app paints with, scoped
 * to this one element via inline CSS custom properties.
 */
export function ThemeSample({
  config,
  className,
}: {
  config: ThemeConfig;
  className?: string;
}) {
  const vars = resolveCustomVars(config);
  const scope = Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties;

  return (
    <div
      aria-hidden="true"
      style={scope}
      className={cn('relative flex w-full overflow-hidden border', className)}
    >
      <div
        className="flex w-[32%] shrink-0 flex-col justify-center gap-1 px-1.5"
        style={{ background: 'var(--sidebar)' }}
      >
        <span
          className="h-1.5 w-4/5 shrink-0 rounded-sm"
          style={{ background: 'var(--sidebar-accent)' }}
        />
        <span
          className="h-1 w-3/5 shrink-0 rounded-full opacity-70"
          style={{ background: 'var(--sidebar-foreground)' }}
        />
        <span
          className="h-1 w-2/3 shrink-0 rounded-full opacity-70"
          style={{ background: 'var(--sidebar-foreground)' }}
        />
      </div>
      <div
        className="flex flex-1 flex-col justify-center gap-1.5 px-2"
        style={{ background: 'var(--background)' }}
      >
        <span
          className="h-1.5 w-3/5 shrink-0 rounded-full"
          style={{ background: 'var(--foreground)' }}
        />
        <span
          className="h-1 w-2/5 shrink-0 rounded-full opacity-50"
          style={{ background: 'var(--foreground)' }}
        />
        <span
          className="mt-0.5 h-2.5 w-9 shrink-0"
          style={{
            background: 'var(--primary)',
            borderRadius: 'var(--control-radius)',
          }}
        />
      </div>
    </div>
  );
}
