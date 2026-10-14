export type FontCategory = 'sans' | 'serif' | 'display' | 'mono';

export interface FontOption {
  id: string;
  label: string;
  stack: string;
  category: FontCategory;
  /** Google Fonts family spec, e.g. "Inter:wght@400;500;600". */
  google: string;
}

export const FONT_CATEGORIES: { value: FontCategory; label: string }[] = [
  { value: 'sans', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Titulares' },
  { value: 'mono', label: 'Monoespaciada' },
];

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter',
    stack: '"Inter", system-ui, -apple-system, sans-serif',
    category: 'sans',
    google: 'Inter:wght@400;500;600;700',
  },
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    stack: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
    category: 'sans',
    google: 'Plus+Jakarta+Sans:wght@400;500;600;700',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    stack: '"Roboto", system-ui, -apple-system, sans-serif',
    category: 'sans',
    google: 'Roboto:wght@400;500;700',
  },
  {
    id: 'outfit',
    label: 'Outfit',
    stack: '"Outfit", system-ui, -apple-system, sans-serif',
    category: 'display',
    google: 'Outfit:wght@400;500;600;700',
  },
  {
    id: 'playfair-display',
    label: 'Playfair Display',
    stack: '"Playfair Display", Georgia, serif',
    category: 'serif',
    google: 'Playfair+Display:wght@500;600;700',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", ui-monospace, monospace',
    category: 'mono',
    google: 'JetBrains+Mono:wght@400;500;600',
  },
];

/** The single lightweight Google Fonts stylesheet URL that loads the curated catalogue. */
export function googleFontsHrefs(): string[] {
  const families = FONT_OPTIONS.map((f) => `family=${f.google}`).join('&');
  return [`https://fonts.googleapis.com/css2?${families}&display=swap`];
}

/** CSS font stack for a catalogue id (falls back to the default Inter body font). */
export function fontStack(id: string): string {
  return (
    FONT_OPTIONS.find((font) => font.id === id)?.stack ??
    '"Inter", system-ui, -apple-system, sans-serif'
  );
}
