// theme.ts: tiny wrapper around `localStorage['canva.theme']` to persist
// the user's light/dark preference. The actual `<html class="dark">` flip
// is done in `main.tsx` (so the very first paint already has the right
// theme) and in the Toolbar's toggle button.

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'canva.theme';

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function getStoredTheme(): Theme {
  if (!hasLocalStorage()) return 'light';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function setStoredTheme(theme: Theme): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}