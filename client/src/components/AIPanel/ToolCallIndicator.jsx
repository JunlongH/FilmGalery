import React, { useState } from 'react';
import { Button, Chip, Spinner } from '@heroui/react';
import { Search, CheckCircle2, XCircle, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';

const TOOL_LABELS = {
  search_photos:       '搜索照片',
  get_photo_detail:    '查看照片详情',
  get_roll_photos:     '获取胶卷照片',
  list_rolls:          '列出胶卷',
  get_roll_detail:     '查看胶卷详情',
  get_stats:           '读取统计数据',
  search_equipment:    '搜索器材',
  get_film_info:       '查询胶片信息',
  list_tags:           '列出标签',
  update_shot_log:     '更新拍摄记录',
  update_photo_metadata: '更新照片信息',
  manage_tags:         '管理标签',
  update_roll_info:    '更新胶卷信息',
};

/**
 * 显示单个工具调用的状态 Chip + 确认 UI
 *
 * @param {{ toolCall: Object, onConfirm?: (confirmationId: string, decision: string) => void }} props
 */
export default function ToolCallIndicator({ toolCall, onConfirm }) {
  const label = TOOL_LABELS[toolCall.name] || toolCall.name;
  const [showArgs, setShowArgs] = useState(false);

  // 等待用户确认
  if (toolCall.status === 'waiting' && toolCall.confirmation) {
    const { confirmationId, args } = toolCall.confirmation;
    return (
      <div className="flex flex-col gap-1.5 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-warning-600 flex-shrink-0" />
          <span className="text-xs font-medium text-warning-700 dark:text-warning-300">
            AI 请求执行写入操作
          </span>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{label}</p>
        {args && Object.keys(args).length > 0 && (
          <>
            <button
              onClick={() => setShowArgs(v => !v)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
            >
              {showArgs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showArgs ? '收起参数' : '查看参数'}
            </button>
            {showArgs && (
              <pre className="text-[11px] bg-zinc-100 dark:bg-zinc-800 rounded px-2 py-1 overflow-x-auto max-h-24 text-zinc-600 dark:text-zinc-400">
                {JSON.stringify(args, null, 2)}
              </pre>
            )}
          </>
        )}
        <div className="flex gap-2 mt-0.5">
          <Button size="sm" color="success" variant="flat" radius="lg"
            className="text-xs h-7 px-3"
            onPress={() => onConfirm?.(confirmationId, 'confirmed')}
          >
            ✓ 允许
          </Button>
          <Button size="sm" color="danger" variant="flat" radius="lg"
            className="text-xs h-7 px-3"
            onPress={() => onConfirm?.(confirmationId, 'rejected')}
          >
            ✕ 拒绝
          </Button>
        </div>
      </div>
    );
  }

  // 已确认执行
  if (toolCall.status === 'confirmed') {
    return (
      <Chip size="sm" variant="flat" color="success"
        startContent={<CheckCircle2 className="w-3 h-3" />}
        className="text-xs h-5"
      >
        {label}（已确认）
      </Chip>
    );
  }

  // 已拒绝
  if (toolCall.status === 'rejected') {
    return (
      <Chip size="sm" variant="flat" color="warning"
        startContent={<XCircle className="w-3 h-3" />}
        className="text-xs h-5"
      >
        {label}（已拒绝）
      </Chip>
    );
  }

  if (toolCall.status === 'running') {
    return (
      <Chip
        size="sm"
        variant="flat"
        color="primary"
        startContent={<Spinner size="sm" color="primary" className="w-3 h-3" />}
        className="text-xs h-5"
      >
        {label}
      </Chip>
    );
  }

  if (toolCall.status === 'done') {
    return (
      <Chip
        size="sm"
        variant="flat"
        color="success"
        startContent={<CheckCircle2 className="w-3 h-3" />}
        className="text-xs h-5"
      >
        {label}
      </Chip>
    );
  }

  if (toolCall.status === 'error') {
    return (
      <Chip
        size="sm"
        variant="flat"
        color="danger"
        startContent={<XCircle className="w-3 h-3" />}
        className="text-xs h-5"
      >
        {label}
      </Chip>
    );
  }

  return (
    <Chip size="sm" variant="flat" startContent={<Search className="w-3 h-3" />} className="text-xs h-5">
      {label}
    </Chip>
  );
}
