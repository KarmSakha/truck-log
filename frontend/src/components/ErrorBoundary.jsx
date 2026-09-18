import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="recovery-screen" role="alert"><div className="eyebrow">HOS DESK</div><h1>Let’s get you back on the road.</h1><p>This page could not be displayed. Reload to reopen your saved trip.</p><button className="cta" onClick={() => window.location.reload()}>Reload trip</button><a href="/">Plan a new trip</a></div>;
  }
}
