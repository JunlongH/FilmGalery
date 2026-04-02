import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

const AIPanelContext = createContext(null);

export function AIPanelProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(400);
  const [conversationId, setConversationId] = useState(null);
  const [overlayContext, setOverlayContextState] = useState(null);
  const overlayStackRef = useRef([]);

  const togglePanel = useCallback(() => setIsOpen(v => !v), []);
  const openPanel   = useCallback(() => setIsOpen(true), []);
  const closePanel  = useCallback(() => setIsOpen(false), []);

  // 叠加层上下文管理（支持嵌套：ImageViewer → FilmLab）
  const pushOverlayContext = useCallback((ctx) => {
    overlayStackRef.current = [...overlayStackRef.current, ctx];
    setOverlayContextState(ctx);
  }, []);

  const popOverlayContext = useCallback(() => {
    const stack = overlayStackRef.current;
    stack.pop();
    overlayStackRef.current = stack;
    setOverlayContextState(stack.length > 0 ? stack[stack.length - 1] : null);
  }, []);

  const updateOverlayContext = useCallback((updater) => {
    setOverlayContextState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const stack = overlayStackRef.current;
      if (stack.length > 0) stack[stack.length - 1] = next;
      return next;
    });
  }, []);

  return (
    <AIPanelContext.Provider value={{
      isOpen, togglePanel, openPanel, closePanel,
      panelWidth, setPanelWidth,
      conversationId, setConversationId,
      overlayContext, pushOverlayContext, popOverlayContext, updateOverlayContext,
    }}>
      {children}
    </AIPanelContext.Provider>
  );
}

export function useAIPanel() {
  const ctx = useContext(AIPanelContext);
  if (!ctx) throw new Error('useAIPanel must be used inside AIPanelProvider');
  return ctx;
}
