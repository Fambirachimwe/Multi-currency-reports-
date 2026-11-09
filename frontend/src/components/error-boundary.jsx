import { Component } from 'react';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Catches render errors below it and shows a recoverable fallback instead of
 * a blank screen. Error details go to the console only, never to the user.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error', error, info?.componentStack);
  }

  reset() {
    this.setState({ hasError: false });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback onRetry={this.reset} />;
  }
}
