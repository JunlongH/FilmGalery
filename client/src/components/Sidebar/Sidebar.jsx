/**
 * Sidebar 主组件 — 工作区切换模式
 *
 * 胶片模式：main 分支原样导航（Overview/Rolls/Films + Browse + Tools）
 * 数码模式：数码专属导航（Library/Albums/Import + 浏览 + Tools）
 * 顶部切换按钮在两种模式间切换
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
  Images,
  BookMarked,
  FolderPlus,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Bot,
  Repeat,
} from 'lucide-react';

import { SidebarItem, SidebarSubItem } from './SidebarItem';
import { SidebarSection } from './SidebarSection';
import { useSidebar } from './SidebarContext';
import { useTheme } from '../../providers';
import { useAIPanel } from '../AIPanel/AIPanelContext';

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;

const FILM_SHORTCUTS = {
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

const DIGITAL_SHORTCUTS = {
  '1': '/',
  '2': '/library',
  '3': '/albums',
  '4': '/digital-import',
  '5': '/calendar',
  '6': '/map',
  '7': '/favorites',
  '8': '/themes',
  '9': '/stats',
  '0': '/equipment',
  ',': '/settings',
};

export function Sidebar({ tags = [], mode = 'film', onToggleMode }) {
  const { isCollapsed, toggleCollapsed } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const { isOpen: aiPanelOpen, togglePanel: toggleAIPanel } = useAIPanel();
  const navigate = useNavigate();

  const shortcuts = mode === 'film' ? FILM_SHORTCUTS : DIGITAL_SHORTCUTS;

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      const key = e.key;
      if (shortcuts[key]) {
        e.preventDefault();
        navigate(shortcuts[key]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, shortcuts]);

  return (
    <motion.nav
      className={`
        flex flex-col h-full flex-shrink-0
        bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100
        border-r border-zinc-200 dark:border-zinc-800
        overflow-hidden
      `}
      initial={false}
      animate={{ width: isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* 模式切换按钮 */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={onToggleMode}
          className={`
            w-full flex items-center gap-2 px-3 py-2 rounded-lg
            transition-colors text-sm font-medium
            ${mode === 'film'
              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60'
              : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/60'
            }
          `}
          title={mode === 'film' ? 'Switch to Digital mode' : 'Switch to Film mode'}
        >
          {mode === 'film' ? (
            <Film className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Images className="w-4 h-4 flex-shrink-0" />
          )}
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">
                {mode === 'film' ? 'Film' : 'Digital'}
              </span>
              <Repeat className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            </>
          )}
        </button>
      </div>

      {/* 导航 */}
      <div className="flex-1 overflow-y-auto pt-2 pb-4 px-3 space-y-6 custom-scrollbar">
        {mode === 'film' ? (
          <>
            <SidebarSection>
              <SidebarItem to="/" icon={<Home className="w-5 h-5" />} label="Overview" exact shortcut="⌘1" />
              <SidebarItem to="/rolls" icon={<Camera className="w-5 h-5" />} label="Rolls" shortcut="⌘2" />
              <SidebarItem to="/films" icon={<Film className="w-5 h-5" />} label="Films" shortcut="⌘3" />
            </SidebarSection>

            <SidebarSection title="Browse" divider>
              <SidebarItem to="/calendar" icon={<Calendar className="w-5 h-5" />} label="Calendar" shortcut="⌘4" />
              <SidebarItem to="/map" icon={<Map className="w-5 h-5" />} label="Map" shortcut="⌘5" />
              <SidebarItem to="/favorites" icon={<Heart className="w-5 h-5" />} label="Favorites" shortcut="⌘6" />
              <SidebarItem to="/themes" icon={<Tag className="w-5 h-5" />} label="Themes" shortcut="⌘7">
                {tags.map((tag) => (
                  <SidebarSubItem key={tag.id} to={`/themes/${tag.id}`} label={tag.name} />
                ))}
              </SidebarItem>
            </SidebarSection>

            <SidebarSection title="Tools" divider>
              <SidebarItem to="/stats" icon={<BarChart2 className="w-5 h-5" />} label="Statistics" shortcut="⌘8" />
              <SidebarItem to="/equipment" icon={<Aperture className="w-5 h-5" />} label="Equipment" shortcut="⌘9" />
              <SidebarItem to="/luts" icon={<Film className="w-5 h-5" />} label="LUT Library" />
              <SidebarItem to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" shortcut="⌘," />
            </SidebarSection>
          </>
        ) : (
          <>
            <SidebarSection>
              <SidebarItem to="/" icon={<Home className="w-5 h-5" />} label="Overview" exact shortcut="⌘1" />
              <SidebarItem to="/library" icon={<Images className="w-5 h-5" />} label="Library" shortcut="⌘2" />
            </SidebarSection>

            <SidebarSection title="Organize" divider>
              <SidebarItem to="/albums" icon={<BookMarked className="w-5 h-5" />} label="Albums" shortcut="⌘3" />
              <SidebarItem to="/digital-import" icon={<FolderPlus className="w-5 h-5" />} label="Import" shortcut="⌘4" />
            </SidebarSection>

            <SidebarSection title="Browse" divider>
              <SidebarItem to="/calendar" icon={<Calendar className="w-5 h-5" />} label="Calendar" shortcut="⌘5" />
              <SidebarItem to="/map" icon={<Map className="w-5 h-5" />} label="Map" shortcut="⌘6" />
              <SidebarItem to="/favorites" icon={<Heart className="w-5 h-5" />} label="Favorites" shortcut="⌘7" />
              <SidebarItem to="/themes" icon={<Tag className="w-5 h-5" />} label="Themes" shortcut="⌘8">
                {tags.map((tag) => (
                  <SidebarSubItem key={tag.id} to={`/themes/${tag.id}`} label={tag.name} />
                ))}
              </SidebarItem>
            </SidebarSection>

            <SidebarSection title="Tools" divider>
              <SidebarItem to="/stats" icon={<BarChart2 className="w-5 h-5" />} label="Statistics" shortcut="⌘9" />
              <SidebarItem to="/equipment" icon={<Aperture className="w-5 h-5" />} label="Equipment" shortcut="⌘0" />
              <SidebarItem to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" shortcut="⌘," />
            </SidebarSection>
          </>
        )}
      </div>

      {/* Footer */}
      <div className={`p-3 flex items-center gap-2 ${isCollapsed ? 'flex-col' : ''}`}>
        <Button
          isIconOnly
          variant={aiPanelOpen ? 'solid' : 'light'}
          color={aiPanelOpen ? 'primary' : 'default'}
          size="sm"
          radius="lg"
          onPress={toggleAIPanel}
          className={aiPanelOpen ? '' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}
          aria-label="AI Assistant"
        >
          <Bot className="w-4 h-4" />
        </Button>

        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="lg"
          onPress={toggleTheme}
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="lg"
          onPress={toggleCollapsed}
          className={`text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 ${!isCollapsed ? 'ml-auto' : ''}`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>
    </motion.nav>
  );
}

export default Sidebar;
