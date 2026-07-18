import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button, Input, Tooltip, Spinner, Chip, Popover, PopoverTrigger, PopoverContent } from '@heroui/react';
import {
  Bot, Send, Trash2, X, History, Plus, ArrowLeft, MessageSquare,
  Image as ImageIcon, ImageOff, Zap, ChevronDown, Cpu,
  Camera, Database, SlidersHorizontal,
} from 'lucide-react';
import { useAIPanel } from './AIPanelContext';
import { useAIContext } from '../../hooks/useAIContext';
import { useAIChat } from '../../hooks/useAIChat';
import {
  getConversations, getConversation, deleteConversation,
  getPromptShortcuts, getPromptTemplates, getConfiguredModels,
} from '../../api/ai';
import MessageBubble from './MessageBubble';

const TEMPLATE_ICONS = {
  bot: Bot,
  camera: Camera,
  database: Database,
  'sliders-horizontal': SlidersHorizontal,
};

export default function AIPanel() {
  const { isOpen, closePanel, panelWidth, setPanelWidth, conversationId, setConversationId, overlayContext } = useAIPanel();
  const routeContext = useAIContext();
  // Memoise so useCallback deps (handleSend, handleShortcut) don't change every
  // render. Spreading without memoisation produced a new object identity each
  // render and tripped react-hooks/exhaustive-deps in CI.
  const aiContext = useMemo(
    () => (overlayContext ? { ...routeContext, ...overlayContext } : routeContext),
    [routeContext, overlayContext]
  );
  const [inputText, setInputText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [attachPhoto, setAttachPhoto] = useState(false);
  const [shortcuts, setShortcuts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [configuredModels, setConfiguredModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const dragRef = useRef(null);

  // ─── 拖拽调整宽度 ───
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      const newWidth = Math.min(Math.max(startWidth + delta, 320), 800);
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth, setPanelWidth]);

  const { messages, isLoading, sendMessage, confirmAction, clearMessages, loadConversationMessages } = useAIChat({
    conversationId,
    onConversationCreated: setConversationId,
  });

  // 当前是否在查看照片
  const currentPhotoId = aiContext.entityType === 'photo' ? aiContext.entityId : null;
  const isInPhotoView = !!currentPhotoId;

  // 在 ImageViewer/FilmLab 中默认附带照片
  useEffect(() => {
    setAttachPhoto(isInPhotoView);
  }, [isInPhotoView]);

  // 加载快捷提示
  useEffect(() => {
    getPromptShortcuts()
      .then(list => setShortcuts(Array.isArray(list) ? list : []))
      .catch(() => setShortcuts([]));
  }, []);

  // 加载模板 + 模型列表
  const loadTemplatesAndModels = useCallback(() => {
    getPromptTemplates()
      .then(list => {
        const arr = Array.isArray(list) ? list : [];
        setTemplates(arr);
        setSelectedTemplate(prev => {
          if (prev) {
            // 用最新数据更新已选模板
            const refreshed = arr.find(t => t.id === prev.id);
            return refreshed || prev;
          }
          return arr.find(t => t.is_default) || null;
        });
      })
      .catch(() => setTemplates([]));

    getConfiguredModels()
      .then(list => {
        const arr = Array.isArray(list) ? list : [];
        setConfiguredModels(arr);
        setSelectedModel(prev => {
          if (prev) {
            const refreshed = arr.find(m => m.id === prev.id && m.enabled);
            return refreshed || null;
          }
          return arr.find(m => m.is_default_text && m.enabled) || null;
        });
      })
      .catch(() => setConfiguredModels([]));
  }, []);

  useEffect(() => {
    loadTemplatesAndModels();
  }, [loadTemplatesAndModels]);

  // 监听 Settings 的数据变更事件，实时刷新
  useEffect(() => {
    const handler = () => loadTemplatesAndModels();
    window.addEventListener('ai-panel-data-changed', handler);
    return () => window.removeEventListener('ai-panel-data-changed', handler);
  }, [loadTemplatesAndModels]);

  // 按当前场景过滤快捷提示
  const visibleShortcuts = useMemo(() => {
    const scope = aiContext.viewMode === 'filmlab' ? 'filmlab'
      : aiContext.entityType === 'photo' ? 'photo'
      : 'general';
    return shortcuts.filter(s => s.scope === scope || s.scope === 'general');
  }, [shortcuts, aiContext.viewMode, aiContext.entityType]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      });
    }
  }, [messages]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSend = useCallback((overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : inputText).trim();
    if (!text || isLoading) return;
    if (typeof overrideText !== 'string') setInputText('');

    const attachments = (attachPhoto && currentPhotoId)
      ? [{ type: 'photo', photo_id: Number(currentPhotoId) }]
      : undefined;

    sendMessage({
      message: text, context: aiContext, attachments,
      templateId: selectedTemplate?.id,
      modelId: selectedModel?.id,
    });
  }, [inputText, isLoading, sendMessage, aiContext, attachPhoto, currentPhotoId, selectedTemplate, selectedModel]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleShortcut = useCallback((shortcut) => {
    if (isLoading) return;
    // 快捷提示：scope='photo' 时自动附带照片
    const shouldAttach = shortcut.scope === 'photo' || shortcut.scope === 'filmlab';
    const attachments = (shouldAttach && currentPhotoId)
      ? [{ type: 'photo', photo_id: Number(currentPhotoId) }]
      : undefined;
    sendMessage({
      message: shortcut.prompt, context: aiContext, attachments,
      templateId: selectedTemplate?.id,
      modelId: selectedModel?.id,
    });
  }, [isLoading, sendMessage, aiContext, currentPhotoId, selectedTemplate, selectedModel]);

  const handleNewChat = useCallback(() => {
    clearMessages();
    setConversationId(null);
    setShowHistory(false);
  }, [clearMessages, setConversationId]);

  // ─── 历史记录 ───

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const list = await getConversations();
      setHistoryList(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[AIPanel] 加载历史失败:', err);
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleToggleHistory = useCallback(() => {
    if (!showHistory) loadHistory();
    setShowHistory(v => !v);
  }, [showHistory, loadHistory]);

  const handleSelectConversation = useCallback(async (conv) => {
    setConversationId(conv.id);
    setShowHistory(false);
    try {
      const data = await getConversation(conv.id);
      if (data?.messages?.length) {
        loadConversationMessages(data.messages);
      }
    } catch (err) {
      console.error('[AIPanel] 加载对话详情失败:', err);
    }
  }, [setConversationId, loadConversationMessages]);

  const handleDeleteConversation = useCallback(async (e, convId) => {
    if (e?.stopPropagation) e.stopPropagation();
    try {
      await deleteConversation(convId);
      setHistoryList(prev => prev.filter(c => c.id !== convId));
      if (conversationId === convId) {
        clearMessages();
        setConversationId(null);
      }
    } catch (err) {
      console.error('[AIPanel] 删除对话失败:', err);
    }
  }, [conversationId, clearMessages, setConversationId]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="ai-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: panelWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="flex flex-row h-full flex-shrink-0 overflow-hidden"
        >
          {/* 左侧拖拽手柄 */}
          <div
            ref={dragRef}
            onMouseDown={handleDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-primary-400/40 active:bg-primary-500/50 transition-colors bg-transparent border-l border-zinc-200 dark:border-zinc-800"
          />

          {/* 面板主体 */}
          <div className="flex flex-col flex-1 min-w-0 bg-white dark:bg-zinc-900 overflow-hidden">
          {/* 标题栏 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
            {showHistory ? (
              <>
                <Button isIconOnly variant="light" size="sm" radius="lg"
                  onPress={() => setShowHistory(false)}
                  className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  aria-label="返回聊天"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <span className="font-semibold text-sm flex-1">历史对话</span>
              </>
            ) : (
              <>
                <Bot className="w-5 h-5 text-primary flex-shrink-0" />
                <span className="font-semibold text-sm flex-1 truncate">AI 助手</span>
              </>
            )}

            {!showHistory && (
              <>
                <Tooltip content="历史对话" size="sm">
                  <Button isIconOnly variant="light" size="sm" radius="lg"
                    onPress={handleToggleHistory}
                    className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    aria-label="历史对话"
                  >
                    <History className="w-4 h-4" />
                  </Button>
                </Tooltip>
                <Tooltip content="新对话" size="sm">
                  <Button isIconOnly variant="light" size="sm" radius="lg"
                    onPress={handleNewChat}
                    className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    aria-label="新对话"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </Tooltip>
              </>
            )}

            <Tooltip content="关闭" size="sm">
              <Button isIconOnly variant="light" size="sm" radius="lg"
                onPress={closePanel}
                className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                aria-label="关闭面板"
              >
                <X className="w-4 h-4" />
              </Button>
            </Tooltip>
          </div>

          {/* 模板 + 模型选择器（非历史模式时显示） */}
          {!showHistory && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/50 flex-shrink-0">
              {/* 模板选择器 */}
              <Popover placement="bottom-start">
                <PopoverTrigger>
                  <Button size="sm" variant="flat" radius="lg"
                    className="text-xs h-7 min-w-0 gap-1 px-2"
                    startContent={(() => {
                      const Icon = TEMPLATE_ICONS[selectedTemplate?.icon] || Bot;
                      return <Icon className="w-3.5 h-3.5" />;
                    })()}
                    endContent={<ChevronDown className="w-3 h-3" />}
                  >
                    {selectedTemplate?.name || '通用助手'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 overflow-hidden min-w-[220px]">
                  <div className="py-1 w-full">
                    {templates.map(t => {
                      const Icon = TEMPLATE_ICONS[t.icon] || Bot;
                      const isActive = selectedTemplate?.id === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTemplate(t)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                            hover:bg-zinc-100 dark:hover:bg-zinc-800
                            ${isActive ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-600' : 'text-zinc-400'}`} />
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium truncate ${isActive ? 'text-primary-600' : ''}`}>{t.name}</p>
                            <p className="text-xs text-zinc-400 truncate">{t.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              {/* 模型选择器，始终显示 */}
              <Popover placement="bottom-start">
                <PopoverTrigger>
                  <Button size="sm" variant="flat" radius="lg"
                    className="text-xs h-7 min-w-0 gap-1 px-2"
                    startContent={<Cpu className="w-3.5 h-3.5" />}
                    endContent={<ChevronDown className="w-3 h-3" />}
                  >
                    {selectedModel?.name || '默认模型'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 overflow-hidden min-w-[220px]">
                  <div className="py-1 w-full">
                    {/* 默认（使用全局配置）选项 */}
                    <button
                      type="button"
                      onClick={() => setSelectedModel(null)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                        hover:bg-zinc-100 dark:hover:bg-zinc-800
                        ${!selectedModel ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                    >
                      <Cpu className={`w-4 h-4 flex-shrink-0 ${!selectedModel ? 'text-primary-600' : 'text-zinc-400'}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${!selectedModel ? 'text-primary-600' : ''}`}>默认模型</p>
                        <p className="text-xs text-zinc-400">使用设置中的全局模型</p>
                      </div>
                    </button>
                    {configuredModels.filter(m => m.enabled).map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedModel(m)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                          hover:bg-zinc-100 dark:hover:bg-zinc-800
                          ${selectedModel?.id === m.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                      >
                        <Cpu className={`w-4 h-4 flex-shrink-0 ${selectedModel?.id === m.id ? 'text-primary-600' : 'text-zinc-400'}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${selectedModel?.id === m.id ? 'text-primary-600' : ''}`}>{m.name}</p>
                          <p className="text-xs text-zinc-400 truncate">{m.model_id}</p>
                        </div>
                        {(m.capabilities || '').includes('vision') && (
                          <Chip size="sm" variant="flat" color="secondary" className="text-[10px] h-4 px-1 flex-shrink-0">视觉</Chip>
                        )}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* 历史对话列表 */}
          {showHistory ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {historyLoading ? (
                <div className="flex items-center justify-center h-32"><Spinner size="sm" /></div>
              ) : historyList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-sm text-zinc-400">暂无历史对话</div>
              ) : (
                <div className="py-1">
                  {historyList.map(conv => (
                    <div key={conv.id} onClick={() => handleSelectConversation(conv)}
                      className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer group hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${conversationId === conv.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                    >
                      <MessageSquare className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate text-zinc-700 dark:text-zinc-300">{conv.title || '未命名对话'}</p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          {conv.message_count || 0} 条消息 · {new Date(conv.updated_at).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      <Button isIconOnly variant="light" size="sm" radius="lg"
                        onPress={(e) => handleDeleteConversation(e, conv.id)}
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-danger transition-opacity"
                        aria-label="删除对话"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 消息列表 */}
              <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                    {(() => {
                      const Icon = TEMPLATE_ICONS[selectedTemplate?.icon] || Bot;
                      return <Icon className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />;
                    })()}
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      {selectedTemplate?.starter_prompt || '你好！我可以帮你搜索照片、查询胶卷、分析统计数据。'}
                    </p>
                    {/* 空状态快捷提示 */}
                    {visibleShortcuts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                        {visibleShortcuts.slice(0, 4).map(s => (
                          <Chip key={s.id} size="sm" variant="flat" className="cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                            startContent={<Zap className="w-3 h-3" />}
                            onClick={() => handleShortcut(s)}
                          >
                            {s.label}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} onConfirm={confirmAction} />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* 快捷提示条（有消息时） */}
              {messages.length > 0 && visibleShortcuts.length > 0 && !isLoading && (
                <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800/50 flex-shrink-0 overflow-x-auto">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    {visibleShortcuts.slice(0, 5).map(s => (
                      <Chip key={s.id} size="sm" variant="flat" className="cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors flex-shrink-0"
                        onClick={() => handleShortcut(s)}
                      >
                        {s.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {/* 输入区 */}
              <div className="px-3 py-3 border-t border-zinc-200 dark:border-zinc-800 flex-shrink-0">
                {/* 附件指示 */}
                {isInPhotoView && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <Chip
                      size="sm"
                      variant={attachPhoto ? 'flat' : 'bordered'}
                      color={attachPhoto ? 'primary' : 'default'}
                      className="cursor-pointer"
                      startContent={attachPhoto
                        ? <ImageIcon className="w-3 h-3" />
                        : <ImageOff className="w-3 h-3" />
                      }
                      onClick={() => setAttachPhoto(v => !v)}
                    >
                      {attachPhoto ? '将发送当前照片' : '不发送照片'}
                    </Chip>
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <Input
                    ref={inputRef}
                    value={inputText}
                    onValueChange={setInputText}
                    onKeyDown={handleKeyDown}
                    placeholder="发送消息…"
                    size="sm"
                    radius="lg"
                    variant="bordered"
                    isDisabled={isLoading}
                    classNames={{ base: 'flex-1', input: 'text-sm' }}
                  />
                  <Button isIconOnly color="primary" size="sm" radius="lg"
                    isDisabled={!inputText.trim() || isLoading}
                    onPress={handleSend}
                    aria-label="发送"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
          </div>{/* 面板主体 end */}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
