import type { ThemeConfig } from '@/types/theme';
import {
  BASE_COLOR_OPTIONS,
  STYLE_PRESETS,
  buildDefaultThemeConfig,
  withDefaults,
} from './theme-resolver';
import { FONT_OPTIONS } from './theme-fonts';
import {
  DENSITY_OPTIONS,
  FONT_SCALE_OPTIONS,
  MOTION_OPTIONS,
} from './theme-options';

export type ParseThemeResult =
  | { ok: true; config: ThemeConfig }
  | { ok: false; error: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

const isHex = (value: unknown): value is string =>
  typeof value === 'string' && HEX.test(value);

/** The theme as pretty JSON, ready to copy. */
export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify(withDefaults(config), null, 2);
}

/**
 * Read a theme from pasted text. Returns the sanitised config, or a Spanish
 * message naming the first problem (shown to the user as is).
 */
export function parseThemeConfig(text: string): ParseThemeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El texto no es un JSON válido.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'El tema debe ser un objeto JSON.' };
  }
  const input = raw as Record<string, unknown>;

  const oneOf = (
    key: string,
    allowed: readonly unknown[],
    label: string
  ): string | null =>
    key in input && !allowed.includes(input[key])
      ? `"${label}" no es un valor válido.`
      : null;

  const problems = [
    oneOf('style', Object.keys(STYLE_PRESETS), 'style'),
    oneOf('baseMode', ['light', 'dark'], 'baseMode'),
    oneOf(
      'baseColor',
      BASE_COLOR_OPTIONS.map((o) => o.value),
      'baseColor'
    ),
    oneOf(
      'headingFont',
      FONT_OPTIONS.map((f) => f.id),
      'headingFont'
    ),
    oneOf(
      'bodyFont',
      FONT_OPTIONS.map((f) => f.id),
      'bodyFont'
    ),
    oneOf(
      'fontScale',
      FONT_SCALE_OPTIONS.map((o) => o.value),
      'fontScale'
    ),
    oneOf(
      'density',
      DENSITY_OPTIONS.map((o) => o.value),
      'density'
    ),
    oneOf(
      'motion',
      MOTION_OPTIONS.map((o) => o.value),
      'motion'
    ),
    'accent' in input && !isHex(input.accent)
      ? '"accent" debe ser un color #rrggbb.'
      : null,
    'chartColors' in input &&
    !(
      Array.isArray(input.chartColors) &&
      input.chartColors.length === 5 &&
      input.chartColors.every(isHex)
    )
      ? '"chartColors" debe tener 5 colores #rrggbb.'
      : null,
    'radius' in input &&
    !(
      typeof input.radius === 'number' &&
      input.radius >= 0 &&
      input.radius <= 1
    )
      ? '"radius" debe ser un número entre 0 y 1.'
      : null,
  ].filter((problem): problem is string => problem !== null);

  if (problems.length > 0) return { ok: false, error: problems[0] };

  // Only known keys are read; everything else in the text is ignored.
  const known = Object.keys(buildDefaultThemeConfig('light'));
  const picked = Object.fromEntries(
    Object.entries(input).filter(([key]) => known.includes(key))
  ) as Partial<ThemeConfig>;

  return { ok: true, config: withDefaults(picked as ThemeConfig) };
}
