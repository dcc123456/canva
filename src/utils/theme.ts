// theme.ts: tiny wrapper around `localStorage['canva.theme']` to persist
// the user's light/dark preference. The actual `<html class="dark">` flip
// is done in `main.tsx` (so the very first paint already has the right
// theme) and in the TopBar's toggle button.
//
// Accent color support: stores a separate accent preference and applies
// it by setting CSS custom properties on document.documentElement.

export type Theme = 'light' | 'dark';
export type AccentColor = 'blue' | 'purple' | 'green' | 'rose' | 'amber';

const STORAGE_KEY = 'canva.theme';
const ACCENT_KEY = 'canva.accent';

export interface AccentPalette {
  main: string;
  hover: string;
  light: string;
  text: string;
}

export const ACCENT_COLORS: Record<AccentColor, AccentPalette> = {
  blue: { main: '#2563eb', hover: '#1d4ed8', light: '#dbeafe', text: '#1e40af' },
  purple: { main: '#7c3aed', hover: '#6d28d9', light: '#ede9fe', text: '#5b21b6' },
  green: { main: '#059669', hover: '#047857', light: '#d1fae5', text: '#065f46' },
  rose: { main: '#e11d48', hover: '#be123c', light: '#ffe4e6', text: '#9f1239' },
  amber: { main: '#d97706', hover: '#b45309', light: '#fef3c7', text: '#92400e' },
};

export const ACCENT_COLOR_KEYS = Object.keys(ACCENT_COLORS) as AccentColor[];

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

export function getStoredAccent(): AccentColor {
  if (!hasLocalStorage()) return 'blue';
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    if (v && v in ACCENT_COLORS) return v as AccentColor;
    return 'blue';
  } catch {
    return 'blue';
  }
}

export function setStoredAccent(accent: AccentColor): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    /* ignore */
  }
}

export function applyAccent(accent: AccentColor): void {
  if (typeof document === 'undefined') return;
  const palette = ACCENT_COLORS[accent];
  const root = document.documentElement;
  root.style.setProperty('--accent', palette.main);
  root.style.setProperty('--accent-hover', palette.hover);
  root.style.setProperty('--accent-light', palette.light);
  root.style.setProperty('--accent-text', palette.text);
}

export function getAccentPalette(accent: AccentColor): AccentPalette {
  return ACCENT_COLORS[accent];
}