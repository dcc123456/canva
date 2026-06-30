// Toaster: stacks up to 4 toasts in the top-right corner. Each toast
// fades out after its lifetime (default 3s) and is removed from the DOM.
// The list of toasts is fed by `useToasts` so the component re-renders
// whenever `toast.success/info/error` is called from anywhere in the app.
import { useEffect } from 'react';
import clsx from 'clsx';
import { toast, useToasts, type ToastEntry } from '../utils/toast';

export interface ToasterProps {
  /** Optional override of the container className. */
  className?: string;
}

export function Toaster({ className }: ToasterProps) {
  const entries = useToasts();
  return (
    <div
      className={clsx(
        'pointer-events-none fixed right-4 top-4 z-50 flex w-72 flex-col gap-2',
        className
      )}
      role="status"
      aria-live="polite"
    >
      {entries.map((e) => (
        <ToastView key={e.id} entry={e} />
      ))}
    </div>
  );
}

function ToastView({ entry }: { entry: ToastEntry }) {
  useEffect(() => {
    const t = window.setTimeout(() => toast.dismiss(entry.id), entry.lifetime);
    return () => window.clearTimeout(t);
  }, [entry.id, entry.lifetime]);

  const palette =
    entry.kind === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : entry.kind === 'error'
        ? 'border-red-300 bg-red-50 text-red-900'
        : 'border-sky-300 bg-sky-50 text-sky-900';

  return (
    <div
      className={clsx(
        'pointer-events-auto rounded border px-3 py-2 text-sm shadow-md',
        palette
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 break-words">{entry.message}</div>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => toast.dismiss(entry.id)}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          ×
        </button>
      </div>
    </div>
  );
}