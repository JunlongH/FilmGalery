import React, { useState, useMemo } from 'react';
import { Chip, Spinner } from '@heroui/react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCallIndicator from './ToolCallIndicator';

const TOOL_COLLAPSE_THRESHOLD = 3;

/**
 * 单条聊天气泡
 * 
 * @param {{ message: { role, content, toolCalls, isStreaming, error } }} props
 */
export default function MessageBubble({ message, onConfirm }) {
  const isUser = message.role === 'user';
  const [toolsExpanded, setToolsExpanded] = useState(false);

  // 工具调用折叠逻辑
  const toolCalls = (!isUser && message.toolCalls) ? message.toolCalls : [];
  const shouldCollapse = toolCalls.length > TOOL_COLLAPSE_THRESHOLD;
  const visibleTools = shouldCollapse && !toolsExpanded
    ? toolCalls.slice(0, TOOL_COLLAPSE_THRESHOLD)
    : toolCalls;
  const hiddenCount = toolCalls.length - TOOL_COLLAPSE_THRESHOLD;

  return (
    <div className={`flex gap-2 mb-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像 */}
      <div className={`
        flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
        ${isUser
          ? 'bg-primary-600 text-white'
          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
        }
      `}>
        {isUser ? 'U' : 'AI'}
      </div>

      {/* 内容气泡 */}
      <div className={`flex flex-col gap-1 max-w-[calc(100%-2.5rem)] min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>

        {/* 工具调用列表（仅 assistant，可折叠） */}
        {toolCalls.length > 0 && (
          <div className="flex flex-col gap-1 w-full">
            {visibleTools.map(tc => (
              <ToolCallIndicator key={tc.id} toolCall={tc} onConfirm={onConfirm} />
            ))}
            {shouldCollapse && (
              <button
                onClick={() => setToolsExpanded(v => !v)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 px-1 py-0.5 cursor-pointer"
              >
                {toolsExpanded
                  ? <><ChevronUp className="w-3 h-3" /> 收起</>
                  : <><ChevronDown className="w-3 h-3" /> 还有 {hiddenCount} 个工具调用</>
                }
              </button>
            )}
          </div>
        )}

        {/* 错误提示 */}
        {message.error && (
          <div className="flex items-center gap-1 text-xs text-danger bg-danger-50 dark:bg-danger-900/20 px-2 py-1 rounded-lg">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span>{message.error}</span>
          </div>
        )}

        {/* 文本内容 */}
        {(message.content || message.isStreaming) && (
          <div className={`
            text-sm px-3 py-2 rounded-2xl leading-relaxed break-words overflow-hidden
            ${isUser
              ? 'bg-primary-600 text-white rounded-tr-sm whitespace-pre-wrap'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-tl-sm'
            }
          `}>
            {isUser ? message.content : (
              <div className="ai-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content || ''}
                </ReactMarkdown>
              </div>
            )}
            {message.isStreaming && !message.content && (
              <Spinner size="sm" color={isUser ? 'white' : 'default'} />
            )}
            {message.isStreaming && message.content && (
              <span className="inline-block w-1 h-3 ml-0.5 align-middle bg-current opacity-70 animate-pulse rounded-sm" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
