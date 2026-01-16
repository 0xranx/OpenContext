import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'oc.theme';
const THEME_VALUES = new Set(['system', 'light', 'dark']);

const ThemeContext = createContext(null);

function getStoredPreference() {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_VALUES.has(stored)) return stored;
  } catch {
    // Ignore storage failures and fall back to system theme.
  }
  return 'system';
}

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyDocumentTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

async function applyTauriTheme(preference) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const tauriWindow = getCurrentWindow();
    await tauriWindow.setTheme(preference === 'system' ? null : preference);
  } catch {
    // Ignore if not running in Tauri or permissions are missing.
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(getStoredPreference);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => setSystemTheme(event.matches ? 'dark' : 'light');
    handler(media);
    if (media.addEventListener) {
      media.addEventListener('change', handler);
      return () => media.removeEventListener('change', handler);
    }
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, []);

  const resolvedTheme = preference === 'system' ? systemTheme : preference;

  useLayoutEffect(() => {
    applyDocumentTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Ignore storage failures.
    }
  }, [preference]);

  useEffect(() => {
    void applyTauriTheme(preference);
  }, [preference]);

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
    }),
    [preference, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
