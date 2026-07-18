/**
 * ChartCard - 图表容器卡片
 *
 * 使用 HeroUI Card 包装 Recharts 图表
 * 统一样式，支持标题、副标题
 */

import React from 'react';
import { Card, CardHeader, CardBody, Divider, Skeleton } from '@heroui/react';
import './stat-card.css';

export default function ChartCard({
  title,
  subtitle,
  children,
  height = 320,
  isLoading = false,
  action,
  className = ''
}) {
  return (
    <Card
      className={`chart-card overflow-hidden border border-zinc-200/50 dark:border-zinc-700/50 min-w-0 ${className}`}
    >
      <CardHeader className="flex justify-between items-start pb-0">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {action && <div>{action}</div>}
      </CardHeader>

      <Divider className="my-3" />

      <CardBody className="pt-0 min-w-0">
        {isLoading ? (
          <Skeleton className="w-full rounded-lg" style={{ height }} />
        ) : (
          <div style={{ height, width: '100%', minWidth: 0 }}>
            {children}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
