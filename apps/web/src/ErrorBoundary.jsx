import React from 'react';

/**
 * A thrown render error otherwise leaves a white page with no way back — the worst thing a
 * product can show, because it looks like the account is gone. This keeps the screen, says
 * what little it honestly knows, and offers the two moves that usually work.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    // No reporting service is wired up; the console is where a developer will look.
    console.error('Render failed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>تعطّلت الصفحة</h2>
          <p className="muted">
            حسابك وبياناتك سليمة — العطل في العرض وحده. أعد التحميل، وإن تكرّر فاخرج وادخل من جديد.
          </p>
          <p className="faint" dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
            {String(this.state.error?.message || this.state.error).slice(0, 200)}
          </p>
          <button className="btn btn-go" onClick={() => location.reload()}>أعد التحميل</button>
          <button className="btn" onClick={() => { location.hash = ''; location.reload(); }}>ابدأ من الأول</button>
        </div>
      </div>
    );
  }
}
