/**
 * ErrorBoundary — Production-quality error boundary.
 * Catches React render errors and shows a branded recovery screen.
 * Never leaks stack traces in production builds.
 */
import React from 'react';

const IS_DEV = import.meta.env.DEV;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production, only log the error message — never the stack trace
    if (IS_DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg = IS_DEV && this.state.error
      ? this.state.error.message
      : null;

    return (
      <div
        style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '20px',
          background: 'hsl(220, 28%, 6%)', color: 'rgba(220,230,255,0.85)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          padding: '2rem', textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '40px', marginBottom: '4px' }}>⚠️</div>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 8px' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(150,175,225,0.55)', margin: 0, maxWidth: '360px', lineHeight: 1.6 }}>
            An unexpected error occurred. Please restart the app.
            If this persists, contact{' '}
            <a href="mailto:support@eodi.me" style={{ color: 'rgba(100,150,255,0.7)' }}>
              support@eodi.me
            </a>
          </p>
          {msg && (
            <pre style={{
              marginTop: '16px', padding: '10px 14px', fontSize: '11px',
              background: 'rgba(248,113,113,0.08)', border: '0.5px solid rgba(248,113,113,0.2)',
              borderRadius: '8px', color: 'rgba(248,150,150,0.7)', textAlign: 'left',
              maxWidth: '480px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{msg}</pre>
          )}
        </div>
        <button
          onClick={this.handleReset}
          style={{
            padding: '10px 24px', borderRadius: '12px', fontSize: '13.5px', fontWeight: 600,
            background: 'linear-gradient(160deg, #3B82F6 0%, #2563EB 100%)',
            border: '0.5px solid rgba(59,130,246,0.5)', color: 'white',
            cursor: 'pointer', letterSpacing: '-0.01em',
            boxShadow: '0 4px 16px rgba(59,130,246,0.28)',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
