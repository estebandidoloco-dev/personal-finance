'use client';

import { PaletteIcon as Palette } from '@/components/ui/icons';
import { useTheme } from '@/lib/theme/theme-provider';
import { Button } from '@/components/ui/button';

export function ThemeEditorTrigger({
  variant = 'outline',
  size = 'sm',
  className,
  onClick,
}: {
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'default' | 'icon' | 'xs';
  className?: string;
  onClick?: () => void;
}) {
  const { openEditor } = useTheme();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => {
        openEditor();
        onClick?.();
      }}
      title="Personalizar apariencia"
      className={className}
    >
      <Palette className="size-4" />
      <span>Personalizar tema</span>
    </Button>
  );
}
