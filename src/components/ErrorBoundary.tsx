// ErrorBoundary: catches render-time exceptions in the React tree and
// shows a friendly fallback with a "重新加载" button. Without this, an
// uncaught render error in any feature (e.g. pdfjs throwing on a malformed
// file) would unmount the whole app and leave a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback render. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  reload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <DefaultFallback error={this.state.error} onReload={this.reload} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({
  error,
  onReload,
  onReset,
}: {
  error: Error;
  onReload: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <div className="text-5xl">:(</div>
      <h1 className="mt-4 text-lg font-semibold text-gray-800">
        出了点问题 / Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-gray-600">
        编辑器遇到了一个意外错误。你可以尝试重置,或者重新加载页面以恢复。
      </p>
      <pre className="mt-4 max-h-40 max-w-xl overflow-auto rounded border border-gray-200 bg-white p-3 text-left text-xs text-gray-700">
        {error.name}: {error.message}
      </pre>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100"
        >
          重试
        </button>
        <button
          type="button"
          onClick={onReload}
          className="rounded border border-blue-600 bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}