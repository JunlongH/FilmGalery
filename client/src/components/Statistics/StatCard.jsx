/**
 * StatCard - 统计卡片组件
 *
 * 使用 HeroUI Card 展示关键指标
 * 支持趋势指示、副标题、图标
 *
 * 配色由 stat-card.css 的 CSS 变量驱动（.stat-card-<color> 双主题），
 * 不再使用 JS 色表与命令式 DOM 覆写。
 */

import React from 'react';
import { Card, CardBody } from '@heroui/react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import './stat-card.css';

const formatStat = (val) => {
  const num = Number(val);
  if (isNaN(num)) return '0';
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
};

export default function StatCard({
  title,
  value,
  sub,
  trend,
  icon: Icon,
  color = 'default',
  prefix = '',
  suffix = ''
}) {
  const trendColor = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#a1a1aa';
  const TrendIcon = trend > 0 ? TrendingUp : TrendingDown;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="h-full"
    >
      <Card
        className={`stat-card stat-card-${color} overflow-hidden border border-zinc-200/50 dark:border-zinc-700/50 hover:shadow-lg transition-shadow duration-300 h-full`}
      >
        <CardBody className="p-5 gap-2 flex flex-col justify-between h-full">
          <div className="flex items-start justify-between">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
              {title}
            </p>
            {Icon && (
              <div className="stat-icon w-8 h-8 rounded-lg flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </div>
            )}
          </div>

          <div className="flex items-baseline gap-1">
            {prefix && <span className="text-xl text-zinc-600 dark:text-zinc-300">{prefix}</span>}
            <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {typeof value === 'number' ? formatStat(value) : value}
            </span>
            {suffix && <span className="text-lg text-zinc-600 dark:text-zinc-300">{suffix}</span>}
          </div>

          <div className="flex items-center justify-between mt-auto">
            {sub ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{sub}</p>
            ) : (
              <span className="text-xs text-transparent select-none">&nbsp;</span>
            )}
            {trend !== undefined && trend !== 0 && (
              <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: trendColor }}>
                <TrendIcon className="w-3 h-3" />
                <span>{formatStat(Math.abs(trend))}%</span>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
