'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

const CHANGE_EVENT = 'personal-finance-theme-change';

function applyPreference(preference: ThemePreference) {
  const resolved = resolveTheme(
    preference,
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.scheme = resolved;
  document.documentElement.dataset.themePreference = preference;
}

function getSnapshot() {
  return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const notify = () => {
    applyPreference(getSnapshot());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, notify);
  window.addEventListener('storage', notify);
  media.addEventListener('change', notify);
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener('storage', notify);
    media.removeEventListener('change', notify);
  };
}

function setPreference(preference: ThemePreference) {
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  if (preference === 'system') {
    window.localStorage.removeItem('personal-finance-theme-mode');
  } else {
    window.localStorage.setItem('personal-finance-theme-mode', preference === 'dark' ? 'DARK' : 'LIGHT');
  }
  applyPreference(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const choices = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
] as const;

export function ThemeControl() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, () => 'system' as const);
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Apariencia</legend>
      <div className="bg-surface-subtle mt-2 grid grid-cols-3 gap-1 rounded-[var(--control-radius)] p-1 border border-border/50">
        {choices.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={`flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-[calc(var(--control-radius)*0.75)] px-2 text-xs font-semibold transition-all ${
              preference === value
                ? 'bg-card text-foreground shadow-xs border border-border/70 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
            }`}
          >
            <input
              type="radio"
              name="theme-preference"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="sr-only"
            />
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyPreference(getSnapshot());
    sync();
    media.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return null;
}
