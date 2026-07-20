import React from 'react';

/**
 * Global React Error Boundary
 * 
 * 防止未捕获的 React 渲染异常导致整棵组件树卸载（黑屏）。
 * 捕获子组件中的错误，显示可恢复的错误界面而非空白页面。
 * 
 * 使用方式：包裹在 <App /> 外层
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // 输出详细错误到控制台
    console.error('[ErrorBoundary] Uncaught error in React tree:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo?.componentStack);
    
    // 尝试写入 Electron 日志（如果 preload 暴露了日志接口）
    try {
      if (window.electronAPI?.log) {
        window.electronAPI.log(`[ErrorBoundary] ${error?.message || error}`);
      }
    } catch (_) { /* ignore */ }
  }

  handleReload = () => {
    // 完全重新加载页面
    window.location.reload();
  };

  handleDismiss = () => {
    // 尝试恢复 — 清除错误状态，让 React 重新渲染
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          background: 'rgba(10, 10, 10, 0.98)',
          color: '#eee',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: '40px',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            发生了意外错误 / An unexpected error occurred
          </h1>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 24, textAlign: 'center', maxWidth: 500 }}>
            应用遇到了一个问题，但您的数据是安全的。您可以尝试恢复或重新加载页面。
          </p>
          
          {/* 错误详情（可折叠） */}
          {this.state.error && (
            <details style={{
              marginBottom: 24,
              padding: '12px 16px',
              background: 'rgba(255,0,0,0.1)',
              border: '1px solid rgba(255,0,0,0.3)',
              borderRadius: 6,
              maxWidth: 600,
              width: '100%',
              fontSize: 12,
              color: '#f88',
              wordBreak: 'break-word',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 500, marginBottom: 8 }}>
                错误详情 / Error Details
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack && (
                  '\n\nComponent Stack:' + this.state.errorInfo.componentStack
                )}
              </pre>
            </details>
          )}
          
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={this.handleDismiss}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: '1px solid #555',
                background: '#333',
                color: '#eee',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              尝试恢复 / Try to Recover
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: '1px solid #1b5e20',
                background: '#2e7d32',
                color: 'white',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              重新加载 / Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
