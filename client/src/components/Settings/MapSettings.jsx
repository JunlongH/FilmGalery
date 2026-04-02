/**
 * MapSettings - 地图和地理编码服务设置
 *
 * 支持切换开源地图 (OSM/CartoDB + Photon) 和高德地图，
 * 高德模式需填写 Web 服务 API Key。
 * 设置持久化在 localStorage，map-settings-changed 事件通知其他组件更新。
 */

import React, { useState } from 'react';
import { Card, CardBody, Button, Input } from '@heroui/react';
import { MapPin } from 'lucide-react';

export const MAP_PROVIDER_KEY = 'map_provider';
export const AMAP_WEB_KEY_STORAGE = 'amap_web_key';

const Section = ({ title, icon: Icon, children }) => (
  <Card className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700" shadow="sm">
    <CardBody className="p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-3">
        {Icon && (
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
        {title}
      </h3>
      {children}
    </CardBody>
  </Card>
);

export default function MapSettings() {
  const [provider, setProvider] = useState(
    () => localStorage.getItem(MAP_PROVIDER_KEY) || 'osm'
  );
  const [amapWebKey, setAmapWebKey] = useState(
    () => localStorage.getItem(AMAP_WEB_KEY_STORAGE) || ''
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(MAP_PROVIDER_KEY, provider);
    if (provider === 'amap') {
      localStorage.setItem(AMAP_WEB_KEY_STORAGE, amapWebKey.trim());
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // 通知地图组件刷新图层
    window.dispatchEvent(new Event('map-settings-changed'));
  };

  return (
    <div className="space-y-6">
      <Section title="地图服务商" icon={MapPin}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            选择地图底图和地理编码服务。保存后切换到地图页面即可生效。
          </p>

          {/* 服务商选择 */}
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="mapProvider"
                value="osm"
                checked={provider === 'osm'}
                onChange={() => setProvider('osm')}
                className="mt-1 accent-primary"
              />
              <div>
                <div className="font-medium text-zinc-800 dark:text-zinc-100">
                  开源地图（OpenStreetMap）
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  底图使用 CartoDB，地址搜索使用 Photon / Nominatim，无需 API Key，全球覆盖
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="mapProvider"
                value="amap"
                checked={provider === 'amap'}
                onChange={() => setProvider('amap')}
                className="mt-1 accent-primary"
              />
              <div>
                <div className="font-medium text-zinc-800 dark:text-zinc-100">
                  高德地图（Amap）
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  底图和地址搜索均使用高德，中国地区覆盖更精准，需要填写 Web 服务 API Key
                </div>
              </div>
            </label>
          </div>

          {/* 高德 Key 输入区域 */}
          {provider === 'amap' && (
            <div className="mt-2 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  高德 Web 服务 API Key
                </label>
                <Input
                  type="text"
                  placeholder="请输入高德 Web 服务 Key（32位字符）"
                  value={amapWebKey}
                  onValueChange={setAmapWebKey}
                  variant="bordered"
                  size="sm"
                  classNames={{
                    input: 'font-mono text-sm'
                  }}
                />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                在{' '}
                <a
                  href="https://lbs.amap.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  高德开放平台
                </a>
                {' '}创建应用，选择「Web 服务」类型获取 Key。用于地址搜索（地理编码）和底图瓦片。
              </p>
            </div>
          )}

          <Button
            color="primary"
            size="sm"
            onPress={handleSave}
            className="mt-2"
          >
            {saved ? '已保存 ✓' : '保存设置'}
          </Button>
        </div>
      </Section>
    </div>
  );
}
