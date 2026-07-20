import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
// Original styles (preserved for legacy components)
import './styles.css';
import './styles/variables.css';
// Tailwind + HeroUI styles (for new modern components)
import './styles/tailwind.css';

// ============================================================================
// Global Error Handlers — 捕获所有未被 React ErrorBoundary 拦截的异常
// 防止静默失败，确保错误可被追溯
// ============================================================================
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[Global] Uncaught error:', message, '\n  at', source, `(${lineno}:${colno})`, error);
  // 不阻止默认行为，让 DevTools 也能看到
  return false;
};

window.onunhandledrejection = (event) => {
  console.error('[Global] Unhandled promise rejection:', event.reason);
};

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);