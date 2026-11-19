import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI boundary caught error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="view">
        <div className="panel" role="alert" style={{ padding: '20px', display: 'grid', gap: '10px', justifyItems: 'start' }}>
          <h2 className="group-title" style={{ margin: 0 }}>{t('shell.error.title')}</h2>
          <p className="error-text" style={{ margin: 0 }}>{this.state.error.message || String(this.state.error)}</p>
          <button
            type="button"
            className="btn"
            onClick={() => this.setState({ error: null })}
          >
            {t('shell.error.retry')}
          </button>
        </div>
      </section>
    );
  }
}
