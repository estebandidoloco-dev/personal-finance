'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ThemeConfig, ThemeMode } from '@/types/theme';
import {
  buildDefaultThemeConfig,
  ensureCustomConfig,
  randomThemeConfig,
  resolveThemeAttributes,
  withDefaults,
} from './theme-resolver';
import {
  canRedo,
  canUndo,
  emptyHistory,
  recordChange,
  redoStep,
  undoStep,
} from './theme-history';

export {
  ACCENT_PRESETS,
  BASE_COLOR_OPTIONS,
  FONT_CATEGORIES,
  FONT_OPTIONS,
  RADIUS_STEPS,
  STYLE_PRESETS,
  buildDefaultThemeConfig,
  defaultChartColors,
  getBasePreset,
} from './theme-resolver';

const STORAGE_MODE_KEY = 'personal-finance-theme-mode';
const STORAGE_CONFIG_KEY = 'personal-finance-theme-config';
const LEGACY_STORAGE_KEY = 'personal-finance-theme';

interface ThemeContextValue {
  mode: ThemeMode;
  config: ThemeConfig | null;
  resolvedConfig: ThemeConfig;
  setMode: (mode: ThemeMode) => void;
  updateConfig: (patch: Partial<ThemeConfig>) => void;
  resetConfig: () => void;
  shuffleConfig: () => void;
  importConfig: (config: ThemeConfig) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  editorOpen: boolean;
  setEditorOpen: (open: boolean) => void;
  openEditor: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'DARK';
    try {
      const savedMode = localStorage.getItem(STORAGE_MODE_KEY) as ThemeMode | null;
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (savedMode === 'CUSTOM') return 'CUSTOM';
      if (legacy === 'system' || !legacy) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'DARK' : 'LIGHT';
      }
      if (savedMode === 'LIGHT' || savedMode === 'DARK') return savedMode;
      if (legacy === 'light') return 'LIGHT';
      if (legacy === 'dark') return 'DARK';
    } catch {
      // localStorage unavailable
    }
    return 'DARK';
  });

  const [config, setConfig] = useState<ThemeConfig | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const savedConfigRaw = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (savedConfigRaw) {
        const parsed = JSON.parse(savedConfigRaw);
        if (parsed && typeof parsed === 'object') {
          return withDefaults(parsed as ThemeConfig);
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [editorOpen, setEditorOpen] = useState(false);

  const configRef = useRef<ThemeConfig | null>(config);
  const historyRef = useRef(emptyHistory<ThemeConfig>());
  const [historyFlags, setHistoryFlags] = useState({
    canUndo: false,
    canRedo: false,
  });

  const syncHistoryFlags = useCallback(() => {
    setHistoryFlags({
      canUndo: canUndo(historyRef.current),
      canRedo: canRedo(historyRef.current),
    });
  }, []);

  const resolvedConfig = useMemo(
    () => (config ? withDefaults(config) : buildDefaultThemeConfig()),
    [config]
  );

  // Paint the real app: apply every managed CSS variable and dataset on the root
  useEffect(() => {
    const root = document.documentElement;
    const { dataScheme, dataMotion, cssVars } = resolveThemeAttributes(mode, config);
    // Align data-theme with dataScheme ('dark' | 'light') so CSS selectors and utilities consistently match
    root.dataset.theme = dataScheme;
    root.dataset.scheme = dataScheme;
    root.dataset.motion = dataMotion;
    root.dataset.themeMode = mode.toLowerCase();

    // Keep legacy personal-finance tokens aligned
    if (cssVars['background']) {
      root.style.setProperty('--background', cssVars['background']);
    }
    if (cssVars['card']) {
      root.style.setProperty('--surface', cssVars['card']);
      root.style.setProperty('--surface-raised', cssVars['card']);
    }
    if (cssVars['muted']) {
      root.style.setProperty('--surface-subtle', cssVars['muted']);
    }
    if (cssVars['foreground']) {
      root.style.setProperty('--text', cssVars['foreground']);
    }
    if (cssVars['muted-foreground']) {
      root.style.setProperty('--text-muted', cssVars['muted-foreground']);
    }
    if (cssVars['border']) {
      root.style.setProperty('--border', cssVars['border']);
    }
    if (cssVars['primary']) {
      root.style.setProperty('--primary', cssVars['primary']);
    }
    if (cssVars['destructive']) {
      root.style.setProperty('--danger', cssVars['destructive']);
      root.style.setProperty('--expense', cssVars['destructive']);
    }
    if (cssVars['success']) {
      root.style.setProperty('--success', cssVars['success']);
      root.style.setProperty('--income', cssVars['success']);
    }

    // Dynamic soft tones that naturally adapt in both light and dark modes
    const isDark = dataScheme === 'dark';
    root.style.setProperty(
      '--primary-soft',
      isDark
        ? 'color-mix(in srgb, var(--primary) 22%, var(--surface, #232724))'
        : 'color-mix(in srgb, var(--primary) 14%, var(--surface, #ffffff))'
    );
    root.style.setProperty(
      '--danger-soft',
      isDark
        ? 'color-mix(in srgb, var(--danger, #e28187) 22%, var(--surface, #232724))'
        : 'color-mix(in srgb, var(--danger, #b74a51) 12%, var(--surface, #ffffff))'
    );
    root.style.setProperty(
      '--success-soft',
      isDark
        ? 'color-mix(in srgb, var(--success, #78be98) 22%, var(--surface, #232724))'
        : 'color-mix(in srgb, var(--success) 12%, var(--surface, #ffffff))'
    );
    root.style.setProperty(
      '--warning-soft',
      isDark
        ? 'color-mix(in srgb, var(--warning, #d5a565) 22%, var(--surface, #232724))'
        : 'color-mix(in srgb, var(--warning, #9a6a32) 12%, var(--surface, #ffffff))'
    );
    root.style.setProperty(
      '--info-soft',
      isDark
        ? 'color-mix(in srgb, var(--info, #8ba4b3) 22%, var(--surface, #232724))'
        : 'color-mix(in srgb, var(--info, #597080) 12%, var(--surface, #ffffff))'
    );
    root.style.setProperty(
      '--text-subtle',
      isDark ? '#8f9891' : '#64748b'
    );

    for (const [key, value] of Object.entries(cssVars)) {
      root.style.setProperty(`--${key}`, value);
    }

    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_MODE_KEY, mode);
      const currentPref = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (currentPref !== 'system') {
        localStorage.setItem(LEGACY_STORAGE_KEY, dataScheme);
      }
      if (config) {
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
      }
    } catch {
      // localStorage error ignored
    }
  }, [mode, config]);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const applyConfig = useCallback((next: ThemeConfig | null) => {
    configRef.current = next;
    setConfig(next);
  }, []);

  const commit = useCallback(
    (compute: (current: ThemeConfig) => ThemeConfig) => {
      const current = configRef.current ?? buildDefaultThemeConfig();
      const next = compute(withDefaults(current));
      historyRef.current = recordChange(historyRef.current, current, Date.now());
      setModeState('CUSTOM');
      applyConfig(next);
      syncHistoryFlags();
    },
    [applyConfig, syncHistoryFlags]
  );

  const setMode = useCallback(
    (next: ThemeMode) => {
      const previous = modeRef.current;
      setModeState(next);
      if (next === 'CUSTOM') {
        const ensured = ensureCustomConfig(configRef.current, previous);
        if (ensured !== configRef.current) applyConfig(ensured);
      }
    },
    [applyConfig]
  );

  useEffect(() => {
    const handleLegacyChange = () => {
      try {
        const legacyPref = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyPref === 'system') {
          const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          if (configRef.current) {
            commit((c) => ({ ...c, baseMode: sysDark ? 'dark' : 'light' }));
          } else {
            setModeState(sysDark ? 'DARK' : 'LIGHT');
          }
        } else if (legacyPref === 'light' && modeRef.current !== 'LIGHT') {
          if (configRef.current) {
            commit((c) => ({ ...c, baseMode: 'light' }));
          } else {
            setModeState('LIGHT');
          }
        } else if (legacyPref === 'dark' && modeRef.current !== 'DARK') {
          if (configRef.current) {
            commit((c) => ({ ...c, baseMode: 'dark' }));
          } else {
            setModeState('DARK');
          }
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('personal-finance-theme-change', handleLegacyChange);
    return () => window.removeEventListener('personal-finance-theme-change', handleLegacyChange);
  }, [commit]);

  const openEditor = useCallback(() => {
    setMode('CUSTOM');
    setEditorOpen(true);
  }, [setMode]);

  const updateConfig = useCallback(
    (patch: Partial<ThemeConfig>) => commit((current) => ({ ...current, ...patch })),
    [commit]
  );

  const shuffleConfig = useCallback(
    () => commit((current) => randomThemeConfig(current)),
    [commit]
  );

  const importConfig = useCallback(
    (imported: ThemeConfig) => commit(() => withDefaults(imported)),
    [commit]
  );

  const resetConfig = useCallback(
    () => commit((current) => buildDefaultThemeConfig(current.baseMode ?? 'light')),
    [commit]
  );

  const undo = useCallback(() => {
    const current = configRef.current ?? buildDefaultThemeConfig();
    const step = undoStep(historyRef.current, current);
    if (!step) return;
    historyRef.current = step.history;
    setModeState('CUSTOM');
    applyConfig(step.value);
    syncHistoryFlags();
  }, [applyConfig, syncHistoryFlags]);

  const redo = useCallback(() => {
    const current = configRef.current ?? buildDefaultThemeConfig();
    const step = redoStep(historyRef.current, current);
    if (!step) return;
    historyRef.current = step.history;
    setModeState('CUSTOM');
    applyConfig(step.value);
    syncHistoryFlags();
  }, [applyConfig, syncHistoryFlags]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      config,
      resolvedConfig,
      setMode,
      updateConfig,
      resetConfig,
      shuffleConfig,
      importConfig,
      undo,
      redo,
      canUndo: historyFlags.canUndo,
      canRedo: historyFlags.canRedo,
      editorOpen,
      setEditorOpen,
      openEditor,
    }),
    [
      mode,
      config,
      resolvedConfig,
      setMode,
      updateConfig,
      resetConfig,
      shuffleConfig,
      importConfig,
      undo,
      redo,
      editorOpen,
      openEditor,
      historyFlags,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
