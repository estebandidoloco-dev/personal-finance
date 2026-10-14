import type {
  ThemeDensity,
  ThemeMotion,
} from '@/types/theme';

/**
 * Quick-pick brand colours, in the order the editor shows them. The first two
 * are the neutral primaries of Light and Dark. This is also the pool Shuffle
 * draws from.
 */
export const ACCENT_SWATCHES = [
  { name: 'Grafito', hex: '#3f3f46' },
  { name: 'Perla', hex: '#e4e4e7' },
  { name: 'Pizarra', hex: '#475569' },
  { name: 'Rojo', hex: '#dc2626' },
  { name: 'Carmín', hex: '#e11d48' },
  { name: 'Rosa', hex: '#db2777' },
  { name: 'Fucsia', hex: '#c026d3' },
  { name: 'Púrpura', hex: '#9333ea' },
  { name: 'Violeta', hex: '#7c3aed' },
  { name: 'Índigo', hex: '#4f46e5' },
  { name: 'Azul', hex: '#2563eb' },
  { name: 'Cielo', hex: '#0284c7' },
  { name: 'Cian', hex: '#0891b2' },
  { name: 'Turquesa', hex: '#0d9488' },
  { name: 'Esmeralda', hex: '#059669' },
  { name: 'Verde', hex: '#16a34a' },
  { name: 'Lima', hex: '#65a30d' },
  { name: 'Amarillo', hex: '#eab308' },
  { name: 'Ámbar', hex: '#d97706' },
  { name: 'Naranja', hex: '#ea580c' },
  { name: 'Coral', hex: '#f0644d' },
  { name: 'Terracota', hex: '#c2410c' },
] as const;

/** Text size: scales every `rem` in the app (the root font size). */
export const FONT_SCALE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.9, label: 'Pequeño' },
  { value: 1, label: 'Normal' },
  { value: 1.1, label: 'Grande' },
  { value: 1.2, label: 'Muy grande' },
];

/** Density: scales Tailwind's spacing unit, so padding, gaps and sizes follow. */
export const DENSITY_OPTIONS: {
  value: ThemeDensity;
  label: string;
  scale: number;
}[] = [
  { value: 'compact', label: 'Compacta', scale: 0.88 },
  { value: 'comfortable', label: 'Cómoda', scale: 1 },
  { value: 'spacious', label: 'Amplia', scale: 1.12 },
];

export const MOTION_OPTIONS: { value: ThemeMotion; label: string }[] = [
  { value: 'full', label: 'Completas' },
  { value: 'reduced', label: 'Reducidas' },
];
