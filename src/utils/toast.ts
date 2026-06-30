// toast.ts: a tiny pub-sub for the Toaster component.
//
// `toast.success/info/error(msg, options?)` pushes an entry onto a global
// queue that the `<Toaster />` component watches. The default lifetime is
// 3000ms and the queue is capped at 4 — pushing a 5th toast drops the
// oldest one.
import { useEffect, useState } from 'react';

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastEntry {
  id: string;
  kind: ToastKind;
  message: string;
  /** Epoch ms when this toast was created. */
  createdAt: number;
  /** Lifetime in ms; the Toaster removes it after this many ms. */
  lifetime: number;
}

export interface ToastOptions {
  lifetime?: number;
}

const MAX_VISIBLE = 4;

type Listener = (entries: ToastEntry[]) => void;

let entries: ToastEntry[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    l(entries.slice());
  }
}

let counter = 0;
function push(kind: ToastKind, message: string, opts: ToastOptions = {}): string {
  const entry: ToastEntry = {
    id: `toast-${++counter}-${Date.now()}`,
    kind,
    message,
    createdAt: Date.now(),
    lifetime: opts.lifetime ?? 3000,
  };
  entries = [...entries, entry];
  if (entries.length > MAX_VISIBLE) {
    entries = entries.slice(entries.length - MAX_VISIBLE);
  }
  notify();
  return entry.id;
}

function dismiss(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  notify();
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => push('success', message, opts),
  info: (message: string, opts?: ToastOptions) => push('info', message, opts),
  error: (message: string, opts?: ToastOptions) => push('error', message, opts),
  dismiss,
};

export function useToasts(): ToastEntry[] {
  const [list, setList] = useState<ToastEntry[]>(() => entries.slice());
  useEffect(() => {
    const listener: Listener = (next) => setList(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return list;
}