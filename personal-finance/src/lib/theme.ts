export const THEME_STORAGE_KEY = 'personal-finance-theme';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
}

export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var km='personal-finance-theme-mode';var kc='personal-finance-theme-config';var p=localStorage.getItem(k);var m=localStorage.getItem(km);var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var isDark=false;if(p==='system'||!p){if(m==='CUSTOM'){try{var c=JSON.parse(localStorage.getItem(kc)||'null');isDark=(c&&c.baseMode)?c.baseMode==='dark':prefersDark;}catch(e){isDark=prefersDark;}}else{isDark=prefersDark;}}else if(p==='dark'||m==='DARK'){isDark=true;}else if(p==='light'||m==='LIGHT'){isDark=false;}else{isDark=prefersDark;}var res=isDark?'dark':'light';document.documentElement.dataset.theme=res;document.documentElement.dataset.scheme=res;document.documentElement.dataset.themePreference=p==='dark'||p==='light'||p==='system'?p:'system';}catch(e){document.documentElement.dataset.theme='light';document.documentElement.dataset.scheme='light';document.documentElement.dataset.themePreference='system';}})();`;
