import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 24,
          color: 'var(--red, #e05c5c)',
          fontSize: 12,
        }}>
          <strong>{this.props.label ?? 'Panel'} crashed</strong>
          <code style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', maxWidth: 400 }}>
            {this.state.error.message}
          </code>
        </div>
      );
    }
    return this.props.children;
  }
}
