import * as React from 'react';

/**
 * Error boundary. When a child throws during render, we show a card with the
 * message instead of unmounting and leaving a blank page.
 *
 * `compact` renders a small inline fallback instead of the full-height card —
 * use it to wrap individual widgets/sections so one failing widget degrades
 * in place rather than blanking the whole page (the page-level boundary in
 * App.tsx is the non-compact last line of defense).
 */
interface Props { children: React.ReactNode; label?: string; compact?: boolean }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console for ops; production errors land in Cloudflare logs.
    console.error('CaptureRadar render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.compact) {
      return (
        <div className="rounded-xl border border-brand-vermilion/30 bg-brand-vermilion/5 p-4 text-sm">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-vermilion-soft">
            {this.props.label ?? 'Section unavailable'}
          </div>
          <p className="mt-1 text-muted">{this.state.error.message || 'This section failed to load.'}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-brand-vermilion/30 bg-brand-vermilion/15 px-2.5 py-1 text-[12px] font-semibold text-brand-vermilion-soft transition-colors hover:bg-brand-vermilion/25"
          >
            Retry
          </button>
        </div>
      );
    }

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
