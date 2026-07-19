/**
 * SettingsTabs - 设置页面 Tabs 组件
 * 
 * 使用 HeroUI Tabs 展示设置分类
 */

import React from 'react';
import { Tabs, Tab } from '@heroui/react';
import { Settings, Server, Database, MapPin, Bot, ShieldCheck } from 'lucide-react';

// Settings tabs configuration
const SETTINGS_TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'server', label: 'Server', icon: Server },
  { key: 'storage', label: 'Storage', icon: Database },
  { key: 'map', label: '地图', icon: MapPin },
  { key: 'ai', label: 'AI 助手', icon: Bot },
  { key: 'security', label: '安全', icon: ShieldCheck },
];

export default function SettingsTabs({
  activeTab = 'general',
  onTabChange,
  showServerTab = false // Only show server tab in Electron mode
}) {
  const visibleTabs = SETTINGS_TABS.filter(tab => {
    if (tab.key === 'server' && !showServerTab) return false;
    return true;
  });

  return (
    <Tabs
      aria-label="Settings sections"
      selectedKey={activeTab}
      onSelectionChange={onTabChange}
      color="primary"
      variant="underlined"
      classNames={{
        base: 'w-full border-b border-zinc-200 dark:border-zinc-700',
        tabList: 'gap-6 w-full relative rounded-none p-0',
        cursor: 'w-full bg-primary',
        tab: 'max-w-fit px-0 h-12',
        tabContent: 'group-data-[selected=true]:text-primary font-medium'
      }}
    >
      {visibleTabs.map(tab => {
        const Icon = tab.icon;
        return (
          <Tab
            key={tab.key}
            title={
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </div>
            }
          />
        );
      })}
    </Tabs>
  );
}

export { SETTINGS_TABS };
