export type ThemeMode = 'LIGHT' | 'DARK' | 'CUSTOM';

export type ThemeStyle =
  | 'direct'
  | 'tonal'
  | 'compact'
  | 'corporate'
  | 'glass'
  | 'editorial';

export type ThemeBaseMode = 'light' | 'dark';

export type ThemeBaseColor =
  | 'warm'
  | 'cool'
  | 'neutral'
  | 'stone'
  | 'rose'
  | 'forest'
  | 'violet'
  | 'slate';

export type ThemeIconLibrary = 'lucide';

export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type ThemeMotion = 'full' | 'reduced';

export interface ThemeConfig {
  style: ThemeStyle;
  baseMode: ThemeBaseMode;
  baseColor: ThemeBaseColor;
  accent: string;
  chartColors: [string, string, string, string, string];
  headingFont: string;
  bodyFont: string;
  iconLibrary?: ThemeIconLibrary;
  radius: number;
  /** Root text size multiplier (0.9 to 1.2); scales every rem. */
  fontScale: number;
  /** Spacing scale: padding, gaps and sizes. */
  density: ThemeDensity;
  /** "reduced" turns off transitions and animations. */
  motion: ThemeMotion;
}
