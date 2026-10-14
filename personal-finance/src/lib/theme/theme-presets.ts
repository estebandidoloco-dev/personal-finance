import type {
  ThemeBaseColor,
  ThemeBaseMode,
  ThemeConfig,
  ThemeStyle,
} from '@/types/theme';
import {
  buildDefaultThemeConfig,
  defaultChartColors,
} from './theme-resolver';

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  config: ThemeConfig;
}

interface PresetInput {
  baseColor: ThemeBaseColor;
  style: ThemeStyle;
  accent: string;
  headingFont: string;
  bodyFont: string;
  radius?: number;
}

function preset(
  id: string,
  label: string,
  description: string,
  baseMode: ThemeBaseMode,
  input: PresetInput
): ThemePreset {
  const base = buildDefaultThemeConfig(baseMode);
  return {
    id,
    label,
    description,
    config: {
      ...base,
      baseColor: input.baseColor,
      style: input.style,
      accent: input.accent,
      chartColors: defaultChartColors(input.accent),
      headingFont: input.headingFont,
      bodyFont: input.bodyFont,
      radius: input.radius ?? base.radius,
    },
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  preset('pizarra', 'Pizarra', 'Directo y sobrio, azul frío', 'dark', {
    baseColor: 'slate',
    style: 'direct',
    accent: '#3b82f6',
    headingFont: 'inter',
    bodyFont: 'inter',
  }),
  preset('brisa', 'Brisa', 'Directo y luminoso, cian claro', 'light', {
    baseColor: 'cool',
    style: 'direct',
    accent: '#0284c7',
    headingFont: 'plus-jakarta-sans',
    bodyFont: 'inter',
  }),
  preset('onix', 'Ónix', 'Tonal, sin bordes, violeta profundo', 'dark', {
    baseColor: 'neutral',
    style: 'tonal',
    accent: '#8b5cf6',
    headingFont: 'outfit',
    bodyFont: 'inter',
    radius: 0.9,
  }),
  preset('menta', 'Menta', 'Tonal, amable, verde esmeralda', 'light', {
    baseColor: 'forest',
    style: 'tonal',
    accent: '#059669',
    headingFont: 'plus-jakarta-sans',
    bodyFont: 'plus-jakarta-sans',
    radius: 0.85,
  }),
  preset('terminal', 'Terminal', 'Denso y técnico, verde consola', 'dark', {
    baseColor: 'stone',
    style: 'compact',
    accent: '#22c55e',
    headingFont: 'jetbrains-mono',
    bodyFont: 'jetbrains-mono',
  }),
  preset(
    'indigo-corporativo',
    'Índigo corporativo',
    'Franja de marca, formal',
    'light',
    {
      baseColor: 'slate',
      style: 'corporate',
      accent: '#4f46e5',
      headingFont: 'outfit',
      bodyFont: 'inter',
    }
  ),
  preset(
    'grafito',
    'Grafito',
    'Corporativo monocromo, esquinas rectas',
    'dark',
    {
      baseColor: 'neutral',
      style: 'corporate',
      accent: '#e4e4e7',
      headingFont: 'roboto',
      bodyFont: 'roboto',
      radius: 0.2,
    }
  ),
  preset('aurora', 'Aurora', 'Cristal translúcido, violeta místico', 'dark', {
    baseColor: 'cool',
    style: 'glass',
    accent: '#7c3aed',
    headingFont: 'outfit',
    bodyFont: 'plus-jakarta-sans',
  }),
  preset('coral', 'Coral', 'Cristal cálido, luminoso', 'light', {
    baseColor: 'rose',
    style: 'glass',
    accent: '#f0644d',
    headingFont: 'plus-jakarta-sans',
    bodyFont: 'inter',
  }),
  preset(
    'editorial',
    'Editorial',
    'Líneas finas, tipografía de imprenta',
    'light',
    {
      baseColor: 'stone',
      style: 'editorial',
      accent: '#3f3f46',
      headingFont: 'playfair-display',
      bodyFont: 'roboto',
    }
  ),
];
