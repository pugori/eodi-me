/**
 * InlineErrorBoundary — Component-level error boundary.
 * Catches render errors inside a subtree and shows a compact recovery card
 * instead of crashing the entire app. Use around VibeReport, MapLibreMap,
 * and other complex render trees.
 */
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Optional fallback slot. If omitted, shows the default recovery card. */
  fallback?: React.ReactNode;
  /** Optional label for identification in dev-mode messages. */
  label?: string;
}

interface State {
  hasError: boolean;
}

const IS_DEV = import.meta.env.DEV;

export class InlineErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (IS_DEV) {
      const label = this.props.label ? `[${this.props.label}]` : '';
      console.error(`[InlineErrorBoundary${label}]`, error.message, info.componentStack?.slice(0, 240));
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-[16px] p-6 text-center"
        style={{
          background: 'rgba(248,113,113,0.04)',
          border: '0.5px solid rgba(248,113,113,0.15)',
          minHeight: '120px',
        }}
      >
        <div
          className="flex items-center justify-center rounded-full p-2"
          style={{ background: 'rgba(248,113,113,0.10)' }}
        >
          <AlertTriangle size={18} style={{ color: 'rgba(248,113,113,0.75)' }} />
        </div>
        <div>
          <p className="text-[12.5px] font-semibold" style={{ color: 'rgba(235,235,245,0.70)' }}>
            Display error
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(235,235,245,0.35)' }}>
            This section couldn't render.
          </p>
        </div>
        <button
          onClick={this.handleReset}
          className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-[8px] transition-all"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            color: 'rgba(235,235,245,0.55)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        >
          <RefreshCw size={10} />
          Try again
        </button>
      </div>
    );
  }
}

export default InlineErrorBoundary;
