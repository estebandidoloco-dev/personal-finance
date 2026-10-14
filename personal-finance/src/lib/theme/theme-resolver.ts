// Pure theme-resolution logic â€” deliberately has NO "use client" and no React
// imports, so it can run both on the server (root layout, to paint the
// correct theme into the very first HTML response) and on the client
// (theme-provider.tsx's live-editing paint effect). Both call the exact same
// resolveThemeAttributes() so SSR output and the first client paint can never
// drift apart â€” that drift is what caused the old default-theme flash on
// reload: the server always sent a hardcoded dark shell, then client JS
// corrected it a beat later.
import { FONT_OPTIONS, fontStack } from "./theme-fonts";
import { ACCENT_SWATCHES, DENSITY_OPTIONS } from "./theme-options";
import type {
  ThemeBaseColor,
  ThemeBaseMode,
  ThemeConfig,
  ThemeDensity,
  ThemeMode,
  ThemeStyle,
} from "@/types/theme";

// Fonts live in theme-fonts.ts (the catalogue) and are re-exported here so
// existing imports keep working.
export { FONT_OPTIONS, FONT_CATEGORIES, googleFontsHrefs } from "./theme-fonts";

export interface BaseColorPreset {
  label: string;
  background: string;
  foreground: string;
  card: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accentSurface: string;
  accentForeground: string;
  border: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
}

interface BaseColorSeed {
  label: string;
  /** Hue in degrees (0-360). */
  hue: number;
  /** Base saturation (0-1) â€” scaled down per-token below so surfaces stay
   *  subtle while sidebar/border still read as tinted. */
  saturation: number;
}

// Eight base-color families, each a single hue+saturation seed rendered at
// both light and dark lightness ramps (see buildBasePreset) â€” one set of
// numbers to tune instead of sixteen hand-picked palettes.
const BASE_COLOR_SEEDS: Record<ThemeBaseColor, BaseColorSeed> = {
  warm: { label: 'Cálido', hue: 25, saturation: 0.45 },
  cool: { label: 'Frío', hue: 215, saturation: 0.35 },
  neutral: { label: 'Neutral', hue: 240, saturation: 0.02 },
  stone: { label: 'Piedra', hue: 40, saturation: 0.1 },
  rose: { label: 'Rosa', hue: 350, saturation: 0.45 },
  forest: { label: 'Bosque', hue: 150, saturation: 0.35 },
  violet: { label: 'Violeta', hue: 265, saturation: 0.4 },
  slate: { label: 'Pizarra', hue: 205, saturation: 0.2 },
};

export const BASE_COLOR_OPTIONS: { value: ThemeBaseColor; label: string }[] = (
  Object.keys(BASE_COLOR_SEEDS) as ThemeBaseColor[]
).map((value) => ({
  value,
  label: BASE_COLOR_SEEDS[value].label,
}));

function buildBasePreset(
  seed: BaseColorSeed,
  mode: ThemeBaseMode,
): BaseColorPreset {
  const { hue, saturation: s } = seed;
  const hex = (satFactor: number, lightness: number) =>
    rgbToHex(...hslToRgb(hue, s * satFactor, lightness));

  if (mode === "dark") {
    const foreground = hex(0.2, 0.965);
    const surface = hex(0.55, 0.16);
    const border = hex(0.5, 0.21);
    return {
      label: seed.label,
      background: hex(0.7, 0.085),
      foreground,
      card: hex(0.6, 0.125),
      secondary: surface,
      secondaryForeground: foreground,
      muted: hex(0.6, 0.125),
      mutedForeground: hex(0.3, 0.66),
      accentSurface: surface,
      accentForeground: foreground,
      border,
      sidebar: hex(0.7, 0.065),
      sidebarForeground: foreground,
      sidebarBorder: border,
    };
  }

  // HSL chroma collapses toward white as lightness approaches 1, so a light
  // base needs *more* saturation than a dark one (not less) at any given
  // lightness for the hue to stay visible â€” the opposite ratio from the dark
  // branch above, whose darkest surface is already vivid on its own.
  const foreground = hex(0.45, 0.16);
  const surface = hex(0.9, 0.9);
  const border = hex(0.7, 0.82);
  return {
    label: seed.label,
    background: hex(0.75, 0.955),
    foreground,
    card: hex(0.55, 0.985),
    secondary: surface,
    secondaryForeground: foreground,
    muted: surface,
    mutedForeground: hex(0.35, 0.46),
    accentSurface: surface,
    accentForeground: foreground,
    border,
    sidebar: hex(1, 0.91),
    sidebarForeground: foreground,
    sidebarBorder: border,
  };
}

// The "neutral" base is not generated: it is the exact surface palette of the
// fixed Light/Dark presets in globals.css, so a fresh Custom theme is pixel
// identical to the preset it was seeded from. Keep both in sync.
const NEUTRAL_PRESETS: Record<ThemeBaseMode, BaseColorPreset> = {
  light: {
    label: "Neutral",
    background: "#fafafa",
    foreground: "#18181b",
    card: "#ffffff",
    secondary: "#f4f4f5",
    secondaryForeground: "#18181b",
    muted: "#f4f4f5",
    mutedForeground: "#71717a",
    accentSurface: "#f4f4f5",
    accentForeground: "#18181b",
    border: "#e4e4e7",
    sidebar: "#f4f4f5",
    sidebarForeground: "#18181b",
    sidebarBorder: "#e4e4e7",
  },
  dark: {
    label: "Neutral",
    background: "#121214",
    foreground: "#f4f4f5",
    card: "#18181b",
    secondary: "#27272a",
    secondaryForeground: "#f4f4f5",
    muted: "#18181b",
    mutedForeground: "#a1a1aa",
    accentSurface: "#27272a",
    accentForeground: "#f4f4f5",
    border: "#2e2e33",
    sidebar: "#0e0e10",
    sidebarForeground: "#f4f4f5",
    sidebarBorder: "#2e2e33",
  },
};

export function getBasePreset(
  color: ThemeBaseColor,
  mode: ThemeBaseMode,
): BaseColorPreset {
  if (color === "neutral") return NEUTRAL_PRESETS[mode];
  return buildBasePreset(BASE_COLOR_SEEDS[color], mode);
}

// ---------------------------------------------------------------------------
// Small color math â€” everything here works in the sRGB hex space the editor
// exposes to the user, converting to HSL only internally for the operations
// that need it (lightening/darkening, hue rotation for chart defaults).
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0");
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hk = h / 360;
  return [
    hue2rgb(hk + 1 / 3) * 255,
    hue2rgb(hk) * 255,
    hue2rgb(hk - 1 / 3) * 255,
  ];
}

/** Lighten (positive delta) or darken (negative) a hex color by a fraction of L, in HSL space. */
function adjustLightness(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l + delta)));
  return rgbToHex(r, g, b);
}

/** Rotate a hex color's hue by N degrees, keeping saturation/lightness â€” used for chart-color defaults. */
function rotateHue(hex: string, degrees: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const [r, g, b] = hslToRgb(h + degrees, s, l);
  return rgbToHex(r, g, b);
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(background: string, foreground: string): number {
  const first = relativeLuminance(background);
  const second = relativeLuminance(foreground);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick the higher-contrast foreground for an arbitrary brand accent. */
function pickForeground(hex: string): string {
  const dark = "#18181b";
  const light = "#fafafa";
  const best =
    contrastRatio(hex, dark) >= contrastRatio(hex, light) ? dark : light;
  // Mid-tone colours (amber, coralâ€¦) can fall short of 4.5:1 with both soft
  // tones; pure black or white always reaches it (the worst case is ~4.6).
  if (contrastRatio(hex, best) >= MIN_TEXT_CONTRAST) return best;
  return contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/** WCAG AA: normal text against its background. */
const MIN_TEXT_CONTRAST = 4.5;


// Chart palettes of the fixed Light/Dark presets (globals.css). Used when the
// accent is a neutral gray, where rotating its hue would yield five grays.
const NEUTRAL_CHART_COLORS: Record<
  ThemeBaseMode,
  [string, string, string, string, string]
> = {
  light: ["#3f3f46", "#2f9e6f", "#3b82c4", "#c58a1e", "#8b5cf6"],
  dark: ["#e4e4e7", "#4ade9f", "#60a5fa", "#f0b429", "#a78bfa"],
};

export function defaultChartColors(
  accent: string,
): [string, string, string, string, string] {
  const [, saturation, lightness] = rgbToHsl(...hexToRgb(accent));
  if (saturation < 0.08) {
    return [...NEUTRAL_CHART_COLORS[lightness > 0.5 ? "dark" : "light"]];
  }
  return [
    accent,
    rotateHue(accent, 130),
    rotateHue(accent, 210),
    rotateHue(accent, 40),
    rotateHue(accent, 300),
  ];
}

// ---------------------------------------------------------------------------
// Component styles. A style is a complete *visual language* with its own
// structural idea, not a spacing tweak or "more shadow":
//
//   Clásico     outlined, flat            (1px line around everything)
//   Tonal       filled, borderless        (separation by tone, pill shapes)
//   Editorial   rules and underlines      (no boxes, square, spaced small caps)
//   Denso       dense and technical       (small, uppercase, tight)
//   Corporativo brand rule on cards       (accent bar, firm high-contrast fields)
//   Cristal     translucent glass         (blur over a softly tinted page)
//
// A style is a *function of the light/dark base*, because the same device does
// not work in both. The rules that keep every style good in both modes:
//  - Depth in LIGHT may use a soft drop shadow; in DARK it never does. Shadows
//    vanish on dark surfaces and coloured/light halos make them look dirty, so
//    dark depth comes from tone (lighter surfaces) and hairlines instead.
//  - No shadow is ever tinted with the brand colour: shadows use only `--scrim`
//    (black). The brand colour appears as fills, rules and accent bars.
//  - Colours come from theme tokens (`var(--foreground)`, `color-mix(...)`),
//    never a literal, so every style follows the chosen palette.
//  - `control-shadow` feeds Tailwind's `shadow-*`, which composes with the focus
//    ring, so "no shadow" must be `0 0 #0000`, never `none` (a `none` inside the
//    composed list invalidates the whole box-shadow, ring included).
//    `surface-shadow` and `nav-active-shadow` are plain box-shadows: `none` is fine.
//  - `*-border-width` accept the CSS shorthand ("1px", "0 0 1px" for an
//    underline), which is how a style changes the *shape* of a border.
//  - The focus ring is always visible.
//
// Each style is a set of CSS variables read by packages/ui, globals.css and the
// shell. They live here (not in globals.css) so appearance has a single source
// of truth; Light and Dark are just the "direct" style.
// ---------------------------------------------------------------------------

type StyleVars = Record<string, string>;

export interface StylePreset {
  label: string;
  hint: string;
  /** The style's variables for the given light/dark base. */
  vars: (scheme: ThemeBaseMode) => StyleVars;
}

const mix = (token: string, percent: number) =>
  `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;

const NO_SHADOW = "0 0 #0000";
const RADIUS = "calc(var(--radius) * var(--surface-radius-scale) - 2px)";

/** Every dial with the Classic value. A style overrides only what it changes,
 *  so all styles always define exactly the same set of variables. */
const baseStyleVars = (scheme: ThemeBaseMode): StyleVars => ({
  // Page and surfaces
  "page-background": "var(--background)",
  "surface-fill": "var(--card)",
  "surface-backdrop": "none",
  "surface-border-width": "1px",
  "surface-border-color": "var(--border)",
  "surface-shadow": "none",
  "surface-radius-scale": "1",
  "surface-gap": "1.5rem",
  "surface-padding": "1.5rem",
  "sidebar-fill": "var(--sidebar)",
  "sidebar-backdrop": "none",
  // Fields and controls
  "control-height": "2.25rem",
  "control-padding-x": "1rem",
  "control-radius": RADIUS,
  "control-border-width": "1px",
  "control-border-color": "var(--input)",
  "control-fill": "transparent",
  "control-shadow":
    scheme === "light" ? `0 1px 2px 0 ${mix("--scrim", 8)}` : NO_SHADOW,
  "control-weight": "500",
  "control-tracking": "0em",
  "control-transform": "none",
  "control-font-size": "0.875rem",
  "control-active-transform": "none",
  "focus-ring-width": "3px",
  // Type, badges and navigation
  "heading-weight": "600",
  "heading-tracking": "-0.01em",
  "heading-transform": "none",
  "badge-radius": "9999px",
  "nav-active-shadow": "none",
});

const preset = (
  label: string,
  hint: string,
  overrides: (scheme: ThemeBaseMode) => StyleVars,
): StylePreset => ({
  label,
  hint,
  vars: (scheme) => ({ ...baseStyleVars(scheme), ...overrides(scheme) }),
});

export const STYLE_PRESETS: Record<ThemeStyle, StylePreset> = {
  // Outlined and flat: a thin line around every surface and field.
  direct: preset('Clásico', 'Bordes finos, esquinas suaves', () => ({})),

  // Tonal: no borders and no shadows. Surfaces separate by tone, fields are
  // filled, controls are pills. The calmest and friendliest.
  tonal: preset(
    'Tonal',
    'Sin bordes: rellenos suaves y píldoras',
    (scheme) => ({
      // Light: a slightly darker page so white cards read by tone alone.
      'page-background':
        scheme === 'light'
          ? 'color-mix(in srgb, var(--foreground) 5%, var(--background))'
          : 'var(--background)',
      'surface-border-width': '0px',
      'surface-radius-scale': '2',
      'surface-padding': '1.75rem',
      'control-height': '2.5rem',
      'control-padding-x': '1.25rem',
      'control-radius': '9999px',
      'control-border-width': '0px',
      'control-fill': 'var(--secondary)',
      'control-shadow': NO_SHADOW,
      'control-active-transform': 'scale(0.98)',
      'focus-ring-width': '4px',
      'control-weight': '600',
      'heading-weight': '700',
      'heading-tracking': '-0.02em',
    })
  ),

  // Dense and technical: tiny uppercase controls, tight spacing, square-ish.
  compact: preset('Denso', 'Compacto, técnico, texto pequeño', () => ({
    'surface-radius-scale': '0.35',
    'surface-gap': '0.75rem',
    'surface-padding': '0.875rem',
    'control-height': '1.75rem',
    'control-padding-x': '0.625rem',
    'control-shadow': NO_SHADOW,
    'control-weight': '600',
    'control-tracking': '0.05em',
    'control-transform': 'uppercase',
    'control-font-size': '0.6875rem',
    'focus-ring-width': '2px',
    'badge-radius': '0.125rem',
    'heading-tracking': '0.02em',
    'heading-transform': 'uppercase',
    'nav-active-shadow': 'inset 2px 0 0 var(--sidebar-primary)',
  })),

  // Corporate: a brand-coloured rule across the top of every card, firm
  // high-contrast field borders (they meet the 3:1 non-text contrast guideline),
  // squarer corners and confident headings.
  corporate: preset(
    'Corporativo',
    'Franja de marca y campos firmes',
    (scheme) => ({
      'page-background':
        scheme === 'light'
          ? 'color-mix(in srgb, var(--foreground) 3%, var(--background))'
          : 'var(--background)',
      'surface-radius-scale': '0.75',
      // The bar is an inset shadow (drawn inside, never a halo); light adds one
      // soft black drop shadow, dark adds nothing.
      'surface-shadow':
        scheme === 'light'
          ? `inset 0 3px 0 0 var(--primary), 0 1px 3px ${mix('--scrim', 10)}`
          : 'inset 0 3px 0 0 var(--primary)',
      'control-border-color': mix('--foreground', 38),
      'control-weight': '600',
      'heading-weight': '700',
      'heading-tracking': '-0.015em',
      'badge-radius': '0.25rem',
      'nav-active-shadow': 'inset 3px 0 0 var(--sidebar-primary)',
    })
  ),

  // Glass: translucent panels with a backdrop blur over a softly tinted page,
  // hairline light borders. Fill opacity stays high enough to keep text legible.
  glass: preset('Cristal', 'Translúcido con desenfoque', (scheme) => {
    const light = scheme === 'light';
    return {
      'page-background': `radial-gradient(900px 620px at 6% -8%, ${mix('--primary', light ? 30 : 42)}, transparent 62%), radial-gradient(820px 620px at 100% 8%, ${mix('--info', light ? 26 : 38)}, transparent 60%), radial-gradient(900px 700px at 58% 112%, ${mix('--primary', light ? 20 : 30)}, transparent 62%), var(--background)`,
      'surface-fill': mix('--card', light ? 58 : 46),
      'surface-backdrop': 'blur(18px) saturate(1.6)',
      'surface-border-color': mix('--foreground', light ? 12 : 16),
      // A one-pixel inner top edge of light: an inset line, not a halo.
      'surface-shadow': `inset 0 1px 0 0 ${mix('--foreground', light ? 10 : 12)}`,
      'surface-radius-scale': '1.5',
      'sidebar-fill': mix('--sidebar', light ? 62 : 50),
      'sidebar-backdrop': 'blur(16px) saturate(1.5)',
      'control-height': '2.5rem',
      'control-border-color': mix('--foreground', light ? 16 : 20),
      'control-fill': mix('--foreground', light ? 4 : 7),
      'control-shadow': NO_SHADOW,
      'control-weight': '600',
      'heading-tracking': '-0.02em',
      'nav-active-shadow': `inset 0 0 0 1px ${mix('--sidebar-primary', 45)}`,
    };
  }),

  // Editorial: printed-page austerity. Hairline rules instead of boxes,
  // underline-only fields, square buttons in spaced small caps.
  editorial: preset('Editorial', 'Líneas finas, campos subrayados', () => ({
    "surface-fill": "transparent",
    "surface-border-width": "1px 0 0 0",
    "surface-border-color": mix("--foreground", 60),
    "surface-radius-scale": "0",
    "control-radius": "0px",
    "control-border-width": "0 0 1px 0",
    "control-border-color": mix("--foreground", 60),
    "control-shadow": NO_SHADOW,
    "control-weight": "600",
    "control-tracking": "0.14em",
    "control-transform": "uppercase",
    "control-font-size": "0.6875rem",
    "focus-ring-width": "2px",
    "badge-radius": "0px",
    "heading-weight": "700",
    "heading-tracking": "-0.03em",
    "nav-active-shadow": "inset 2px 0 0 var(--sidebar-primary)",
  })),
};

const STYLE_IDS = Object.keys(STYLE_PRESETS) as ThemeStyle[];

/** The hex of every accent swatch (see ACCENT_SWATCHES); also the pool Shuffle
 *  draws from. */
export const ACCENT_PRESETS: readonly string[] = ACCENT_SWATCHES.map(
  (swatch) => swatch.hex,
);

export const RADIUS_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * The Custom theme starts as a copy of the neutral Light/Dark preset the user
 * is coming from (same base color and same charcoal/light primary as
 * globals.css), so opening the editor never changes what they see.
 */
export function buildDefaultThemeConfig(
  baseMode: ThemeBaseMode = "light",
): ThemeConfig {
  const accent = baseMode === "dark" ? "#e4e4e7" : "#3f3f46";
  return {
    style: "direct",
    baseMode,
    baseColor: "neutral",
    accent,
    chartColors: defaultChartColors(accent),
    headingFont: "inter",
    bodyFont: "inter",
    radius: 0.5,
    fontScale: 1,
    density: "comfortable",
    motion: "full",
  };
}

/**
 * Config to hold once the user is in Custom mode. An existing config is NEVER
 * replaced: it is the user's work. Only a first-time visit (no config yet) is
 * seeded from the light/dark preset they are leaving.
 */
export function ensureCustomConfig(
  current: ThemeConfig | null,
  leavingMode: ThemeMode,
): ThemeConfig {
  return (
    current ??
    buildDefaultThemeConfig(leavingMode === "DARK" ? "dark" : "light")
  );
}

/**
 * The provider lives in the root layout, so it survives navigation: opening
 * /login mounts it as "signed out" (dark, no config), and logging in does not
 * remount it. It must therefore adopt the account's theme whenever it meets a
 * user it has not synced with yet, or "Custom" would look empty and be rebuilt
 * from a preset instead of loading what the user saved.
 */
export function shouldAdoptServerTheme(
  syncedUserId: string | null,
  incomingUserId: string,
): boolean {
  return syncedUserId !== incomingUserId;
}

/**
 * A saved config may predate a field added later. Fill any missing key from
 * the defaults so old themes keep working when the editor grows, and repair
 * values that no longer exist.
 */
export function withDefaults(config: ThemeConfig): ThemeConfig {
  const merged = {
    ...buildDefaultThemeConfig(config.baseMode ?? "light"),
    ...config,
  };
  // A style that no longer exists (renamed or removed) falls back instead of
  // leaving the whole app without its control variables.
  if (!(merged.style in STYLE_PRESETS)) merged.style = "direct";
  return merged;
}

/**
 * Shuffle: a random but coherent theme. Keeps the user's light/dark base and
 * icon library (those are choices, not "looks"); everything else is redrawn.
 * `rng` is injectable so tests are deterministic.
 */
export function randomThemeConfig(
  current: ThemeConfig,
  rng: () => number = Math.random,
): ThemeConfig {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rng() * items.length)];
  const accent = pick(ACCENT_PRESETS);
  return {
    ...current,
    style: pick(STYLE_IDS),
    baseColor: pick(BASE_COLOR_OPTIONS).value,
    accent,
    chartColors: defaultChartColors(accent),
    radius: pick(RADIUS_STEPS),
    headingFont: pick(FONT_OPTIONS).id,
    // Body text stays sans-serif: a random serif body hurts readability.
    bodyFont: pick(FONT_OPTIONS.filter((f) => f.category === "sans")).id,
  };
}

// ---------------------------------------------------------------------------
// The full set of CSS custom properties Custom mode owns. Kept as one list
// so applying and clearing (on leaving Custom mode) never drift apart.
// Semantic colors (destructive, success, warning, info, scrim) follow the base
// mode only: they are not brand accents, so the editor never changes them.
// ---------------------------------------------------------------------------

/**
 * State colors are semantic, not brand: fixed per light/dark base and never
 * editable. Components use them as `text-warning`, `bg-success/10`,
 * `border-info/30`… so no component ever hardcodes a palette color. Each value
 * is the text/border tone, already legible on its base (so no `dark:` variant
 * is needed); tinted surfaces come from the same token with an opacity.
 */
const SEMANTIC_COLORS: Record<ThemeBaseMode, Record<string, string>> = {
  light: {
    destructive: "#dc2626",
    "destructive-foreground": "#ffffff",
    success: "#047857",
    warning: "#b45309",
    info: "#0369a1",
    scrim: "#000000",
  },
  dark: {
    destructive: "#ef4444",
    "destructive-foreground": "#ffffff",
    success: "#34d399",
    warning: "#fcd34d",
    info: "#7dd3fc",
    scrim: "#000000",
  },
};

function densityScale(density: ThemeDensity): number {
  return DENSITY_OPTIONS.find((option) => option.value === density)?.scale ?? 1;
}

export function resolveCustomVars(config: ThemeConfig): Record<string, string> {
  const preset = getBasePreset(config.baseColor, config.baseMode);
  const accentForeground = pickForeground(config.accent);
  const styleVars = STYLE_PRESETS[config.style].vars(config.baseMode);

  return {
    background: preset.background,
    foreground: preset.foreground,
    card: preset.card,
    "card-foreground": preset.foreground,
    popover: preset.card,
    "popover-foreground": preset.foreground,
    primary: config.accent,
    "primary-foreground": accentForeground,
    "primary-hover": adjustLightness(config.accent, 0.08),
    "primary-active": adjustLightness(config.accent, -0.08),
    secondary: preset.secondary,
    "secondary-foreground": preset.secondaryForeground,
    muted: preset.muted,
    "muted-foreground": preset.mutedForeground,
    accent: preset.accentSurface,
    "accent-foreground": preset.accentForeground,
    border: preset.border,
    input: preset.border,
    ring: config.accent,
    "chart-1": config.chartColors[0],
    "chart-2": config.chartColors[1],
    "chart-3": config.chartColors[2],
    "chart-4": config.chartColors[3],
    "chart-5": config.chartColors[4],
    sidebar: preset.sidebar,
    "sidebar-foreground": preset.sidebarForeground,
    "sidebar-muted-foreground": preset.mutedForeground,
    "sidebar-primary": config.accent,
    "sidebar-primary-foreground": accentForeground,
    "sidebar-accent": preset.muted,
    "sidebar-accent-foreground": preset.foreground,
    "sidebar-border": preset.sidebarBorder,
    "sidebar-ring": config.accent,
    // Semantic, not brand: fixed per light/dark base, never user-editable.
    ...SEMANTIC_COLORS[config.baseMode],
    ...styleVars,
    "sidebar-fill": styleVars["sidebar-fill"],
    radius: `${config.radius}rem`,
    // Accessibility and rhythm. `font-scale` multiplies the root font size (the
    // whole UI is in rem) and `spacing` is Tailwind's spacing unit, so every
    // padding, gap and sized box follows the density.
    "font-scale": String(config.fontScale),
    spacing: `${0.25 * densityScale(config.density)}rem`,
    "font-heading": fontStack(config.headingFont),
    "font-body": fontStack(config.bodyFont),
  };
}

/**
 * Single source of truth for "what should the DOM look like for this
 * mode/config" â€” called identically from the root server layout (to paint
 * the very first HTML response) and from the client provider's paint effect
 * (to keep it live-editable). Because both sides call the same function with
 * the same inputs, the client's first paint always matches what the server
 * already sent: no flash from a default theme to the real one.
 */
export function resolveThemeAttributes(
  mode: ThemeMode,
  config: ThemeConfig | null,
): {
  dataTheme: string;
  /** Light or dark surface actually in use â€” drives Tailwind's `dark:` variant. */
  dataScheme: ThemeBaseMode;
  /** "reduced" switches transitions and animations off (see globals.css). */
  dataMotion: ThemeConfig["motion"];
  cssVars: Record<string, string>;
} {
  const resolvedConfig = config
    ? withDefaults(config)
    : buildDefaultThemeConfig();
  return {
    dataTheme: mode.toLowerCase(),
    dataMotion: mode === "CUSTOM" ? resolvedConfig.motion : "full",
    dataScheme:
      mode === "CUSTOM"
        ? resolvedConfig.baseMode
        : mode === "DARK"
          ? "dark"
          : "light",
    // Light and Dark are not separate palettes: they are the default Custom
    // theme for that base, so every mode paints through the same resolver.
    cssVars: resolveCustomVars(
      mode === "CUSTOM"
        ? resolvedConfig
        : buildDefaultThemeConfig(mode === "DARK" ? "dark" : "light"),
    ),
  };
}

