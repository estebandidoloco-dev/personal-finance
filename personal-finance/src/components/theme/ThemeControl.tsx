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
      <div className="bg-surface-subtle mt-2 grid grid-cols-3 gap-1 rounded-xl p-1">
        {choices.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={`flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium ${preference === value ? 'bg-surface-raised text-primary shadow-sm' : 'text-text-muted hover:text-text'}`}
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
