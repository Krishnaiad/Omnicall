import React from 'react';
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = () => {
    localStorage.clear();
    window.location.href = '/';
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050811', color: '#fff', padding: '20px', fontFamily: 'Inter, sans-serif' }}>
          <div className="glass-card" style={{ maxWidth: '440px', width: '100%', padding: '28px', textAlign: 'center', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(15, 23, 42, 0.9)' }}>
            <div style={{ display: 'inline-flex', padding: '14px', borderRadius: '14px', background: 'rgba(239, 68, 68, 0.15)', marginBottom: '16px' }}>
              <AlertTriangle size={36} color="#ef4444" />
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '8px', color: '#fff' }}>Something went wrong</h2>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '24px', lineHeight: 1.5 }}>
              The application encountered a temporary display issue. Tap below to reload or reset your session cleanly.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{ width: '100%', padding: '10px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <RefreshCw size={16} /> Reload Page
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                style={{ width: '100%', padding: '10px', background: 'transparent', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <LogOut size={16} /> Reset Session & Re-login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
