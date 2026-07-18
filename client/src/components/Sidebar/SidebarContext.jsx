/**
 * Sidebar 上下文
 * 
 * 管理侧边栏的折叠状态和其他全局状态
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const SidebarContext = createContext({
  isCollapsed: false,
  toggleCollapsed: () => {},
  setCollapsed: () => {},
});

/**
 * 使用 Sidebar 上下文
 */
export function useSidebar() {
  return useContext(SidebarContext);
}

/**
 * Sidebar Provider
 */
export function SidebarProvider({ children, defaultCollapsed = false }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    // 从 localStorage 恢复状态
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved ? JSON.parse(saved) : defaultCollapsed;
  });

  const setCollapsed = useCallback((value) => {
    setIsCollapsed(value);
    localStorage.setItem('sidebar-collapsed', JSON.stringify(value));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!isCollapsed);
  }, [isCollapsed, setCollapsed]);

  const value = useMemo(
    () => ({ isCollapsed, toggleCollapsed, setCollapsed }),
    [isCollapsed, toggleCollapsed, setCollapsed]
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export default SidebarContext;
