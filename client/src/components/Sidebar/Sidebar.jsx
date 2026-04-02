/**
 * Sidebar 主组件
 * 
 * 现代化侧边栏导航，支持：
 * - 折叠/展开动画
 * - 主题切换
 * - 活跃状态追踪
 * - 响应式设计
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@heroui/react';
import { 
  Home, 
  Camera, 
  Film, 
  Calendar, 
  Map, 
  Heart, 
  Tag, 
  BarChart2, 
  Aperture, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Bot,
} from 'lucide-react';

import { SidebarItem, SidebarSubItem } from './SidebarItem';
import { SidebarSection } from './SidebarSection';
import { useSidebar } from './SidebarContext';
import { useTheme } from '../../providers';
import { useAIPanel } from '../AIPanel/AIPanelContext';

// 侧边栏宽度配置
const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;

// 快捷键映射
const SHORTCUTS = {
  '1': '/',
  '2': '/rolls',
  '3': '/films',
  '4': '/calendar',
  '5': '/map',
  '6': '/favorites',
  '7': '/themes',
  '8': '/stats',
  '9': '/equipment',
  ',': '/settings',
};

/**
 * Sidebar 组件
 * 
 * @param {Object} props
 * @param {Array} [props.tags] - 主题标签列表
 */
export function Sidebar({ tags = [] }) {
  const { isCollapsed, toggleCollapsed } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const { isOpen: aiPanelOpen, togglePanel: toggleAIPanel } = useAIPanel();
  const navigate = useNavigate();

  // 全局快捷键监听
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 检查是否按下 Cmd (Mac) 或 Ctrl (Windows)
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // 检查是否在输入框中
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const key = e.key;
      if (SHORTCUTS[key]) {
        e.preventDefault();
        navigate(SHORTCUTS[key]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
  
  return (
    <motion.nav
      className={`
        flex flex-col h-full flex-shrink-0
        bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100
        border-r border-zinc-200 dark:border-zinc-800
        overflow-hidden
      `}
      initial={false}
      animate={{
        width: isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
      }}
      transition={{
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      {/* Navigation - 直接开始，不需要 Header */}
      <div className="flex-1 overflow-y-auto pt-2 pb-4 px-3 space-y-6 custom-scrollbar">
        {/* 主导航 */}
        <SidebarSection>
          <SidebarItem
            to="/"
            icon={<Home className="w-5 h-5" />}
            label="Overview"
            exact
            shortcut="⌘1"
          />
          <SidebarItem
            to="/rolls"
            icon={<Camera className="w-5 h-5" />}
            label="Rolls"
            shortcut="⌘2"
          />
          <SidebarItem
            to="/films"
            icon={<Film className="w-5 h-5" />}
            label="Films"
            shortcut="⌘3"
          />
        </SidebarSection>
        
        {/* 浏览 */}
        <SidebarSection title="Browse" divider>
          <SidebarItem
            to="/calendar"
            icon={<Calendar className="w-5 h-5" />}
            label="Calendar"
            shortcut="⌘4"
          />
          <SidebarItem
            to="/map"
            icon={<Map className="w-5 h-5" />}
            label="Map"
            shortcut="⌘5"
          />
          <SidebarItem
            to="/favorites"
            icon={<Heart className="w-5 h-5" />}
            label="Favorites"
            shortcut="⌘6"
          />
          <SidebarItem
            to="/themes"
            icon={<Tag className="w-5 h-5" />}
            label="Themes"
            shortcut="⌘7"
          >
            {/* 子菜单：主题标签 */}
            {tags.map((tag) => (
              <SidebarSubItem
                key={tag.id}
                to={`/themes/${tag.id}`}
                label={tag.name}
              />
            ))}
          </SidebarItem>
        </SidebarSection>
        
        {/* 工具 */}
        <SidebarSection title="Tools" divider>
          <SidebarItem
            to="/stats"
            icon={<BarChart2 className="w-5 h-5" />}
            label="Statistics"
            shortcut="⌘8"
          />
          <SidebarItem
            to="/equipment"
            icon={<Aperture className="w-5 h-5" />}
            label="Equipment"
            shortcut="⌘9"
          />
          <SidebarItem
            to="/luts"
            icon={<Film className="w-5 h-5" />}
            label="LUT Library"
          />
          <SidebarItem
            to="/settings"
            icon={<Settings className="w-5 h-5" />}
            label="Settings"
            shortcut="⌘,"
          />
        </SidebarSection>
      </div>
      
      {/* Footer */}
      <div className={`
        p-3
        flex items-center gap-2
        ${isCollapsed ? 'flex-col' : ''}
      `}>
        {/* AI 面板切换 */}
        <Button
          isIconOnly
          variant={aiPanelOpen ? 'solid' : 'light'}
          color={aiPanelOpen ? 'primary' : 'default'}
          size="sm"
          radius="lg"
          onPress={toggleAIPanel}
          className={aiPanelOpen ? '' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}
          aria-label="AI 助手"
        >
          <Bot className="w-4 h-4" />
        </Button>

        {/* 主题切换 */}
        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="lg"
          onPress={toggleTheme}
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </Button>
        
        {/* 折叠按钮 */}
        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="lg"
          onPress={toggleCollapsed}
          className={`
            text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200
            ${!isCollapsed ? 'ml-auto' : ''}
          `}
          aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </Button>
      </div>
    </motion.nav>
  );
}

export default Sidebar;
