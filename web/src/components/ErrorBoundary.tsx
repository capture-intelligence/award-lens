import * as React from 'react';

/**
 * Last-line-of-defense error boundary. When a child throws during render,
 * we show a plain card with the message instead of unmounting the whole
 * app and leaving a blank page.
 */
interface Props { children: React.ReactNode; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console for ops; production errors land in Cloudflare logs.
    console.error('AwardLens AI render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid min-h-[60vh] place-items-center px-6">
        <div className="glass max-w-xl rounded-2xl border border-brand-vermilion/30 p-8 text-center shadow-glass-lg">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-vermilion-soft">
            {this.props.label ?? 'Something went wrong'}
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight">A component failed to render</h2>
          <p className="mt-3 text-sm text-muted">
            {this.state.error.message || 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-brand-vermilion/30 bg-brand-vermilion/15 px-4 py-2 text-sm font-semibold text-brand-vermilion-soft transition-colors hover:bg-brand-vermilion/25"
          >
            Try again
          </button>
          <p className="mt-4 text-[11px] text-muted-soft">
            If this keeps happening, hard-reload (Ctrl+Shift+R) to drop a stale cached bundle.
          </p>
        </div>
      </div>
    );
  }
}
