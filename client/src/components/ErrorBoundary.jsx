import React from 'react';

/**
 * Global React Error Boundary
 * 
 * 防止未捕获的 React 渲染异常导致整棵组件树卸载（黑屏）。
 * 捕获子组件中的错误，显示可恢复的错误界面而非空白页面。
 * 
 * 使用方式：包裹在 <App /> 外层（全局）或子树外层（局部恢复）
 * 
 * Z.2 (P1-3): `name` prop labels the subsystem so the fallback UI can tell
 * the user which part crashed (e.g. "FilmLab" vs a global crash). A subtree
 * boundary lets users recover from a single-photo OOM/WebGL crash without
 * losing the rest of the app (gallery, navigation, etc.).
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
    const label = this.props.name || 'React tree';
    // 输出详细错误到控制台
    console.error(`[ErrorBoundary:${label}] Uncaught error:`, error);
    console.error(`[ErrorBoundary:${label}] Component stack:`, errorInfo?.componentStack);
    
    // 尝试写入 Electron 日志（如果 preload 暴露了日志接口）
    try {
      if (window.electronAPI?.log) {
        window.electronAPI.log(`[ErrorBoundary:${label}] ${error?.message || error}`);
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
      const label = this.props.name || '应用';
      // Z.2: subtree boundaries use a compact overlay (not full-screen)
      // so the rest of the app remains usable.
      const isSubtree = Boolean(this.props.name);
      const overlayStyle = isSubtree ? {
        position: 'relative',
        minHeight: 300,
        background: 'rgba(20, 10, 10, 0.95)',
        color: '#eee',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        borderRadius: 8,
      } : {
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
      };
      return (
        <div style={overlayStyle}>
          <div style={{ fontSize: isSubtree ? 32 : 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: isSubtree ? 14 : 20, fontWeight: 600, marginBottom: 8 }}>
            {label} 遇到了问题
          </h1>
          <p style={{ fontSize: 12, color: '#999', marginBottom: 20, textAlign: 'center', maxWidth: 400 }}>
            {isSubtree
              ? '此功能暂时不可用。您的数据是安全的，可以尝试恢复或关闭后重试。'
              : '应用遇到了一个问题，但您的数据是安全的。您可以尝试恢复或重新加载页面。'
            }
          </p>
          
          {/* 错误详情（可折叠） */}
          {this.state.error && (
            <details style={{
              marginBottom: 20,
              padding: '10px 14px',
              background: 'rgba(255,0,0,0.1)',
              border: '1px solid rgba(255,0,0,0.3)',
              borderRadius: 6,
              maxWidth: isSubtree ? 400 : 600,
              width: '100%',
              fontSize: 11,
              color: '#f88',
              wordBreak: 'break-word',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 500, marginBottom: 6 }}>
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
          
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={this.handleDismiss}
              style={{
                padding: isSubtree ? '6px 16px' : '8px 20px',
                borderRadius: 6,
                border: '1px solid #555',
                background: '#333',
                color: '#eee',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              尝试恢复 / Retry
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: isSubtree ? '6px 16px' : '8px 20px',
                borderRadius: 6,
                border: '1px solid #1b5e20',
                background: '#2e7d32',
                color: 'white',
                cursor: 'pointer',
                fontSize: 12,
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
