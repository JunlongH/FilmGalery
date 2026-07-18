import React from 'react';
import ReactDOM from 'react-dom';
import useIsDarkMode from '../hooks/useIsDarkMode';

const ModalDialog = ({ isOpen, type = 'alert', title, message, onConfirm, onCancel, confirmText = 'OK', cancelText = 'Cancel' }) => {
  const isDark = useIsDarkMode();

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 11000
    }}>
      <div style={{
        backgroundColor: isDark ? '#18181b' : '#ffffff',
        border: isDark ? '1px solid #27272a' : '1px solid #e4e4e7',
        borderRadius: 8,
        padding: 24,
        minWidth: 300,
        maxWidth: 400,
        boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
        color: isDark ? '#ECEDEE' : '#11181C'
      }}>
        {title && <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 18, color: isDark ? '#ECEDEE' : '#11181C' }}>{title}</h3>}
        <div style={{ marginBottom: 24, fontSize: 14, lineHeight: 1.5, color: isDark ? '#a1a1aa' : '#71717a' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          {type === 'confirm' && (
            <button 
              onClick={onCancel}
              style={{
                background: 'transparent',
                border: isDark ? '1px solid #3f3f46' : '1px solid #e4e4e7',
                color: isDark ? '#a1a1aa' : '#71717a',
                padding: '6px 16px',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              {cancelText}
            </button>
          )}
          <button 
            onClick={onConfirm}
            style={{
              background: '#007acc',
              border: 'none',
              color: '#fff',
              padding: '6px 16px',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalDialog;
