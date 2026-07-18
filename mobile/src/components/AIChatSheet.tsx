import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Chip, IconButton, Text, useTheme } from 'react-native-paper';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import Markdown from 'react-native-markdown-display';
import { ApiContext } from '../context/ApiContext';
import { sendChatMessage } from '../api/aiApi';

const TOOL_COLLAPSE_THRESHOLD = 3;

// ─── Tool label map ───
const TOOL_LABELS = {
  search_photos:    '搜索照片',
  get_photo_detail: '查看照片详情',
  get_roll_photos:  '获取胶卷照片',
  list_rolls:       '列出胶卷',
  get_roll_detail:  '查看胶卷详情',
  get_stats:        '读取统计数据',
  search_equipment: '搜索器材',
  get_film_info:    '查询胶片信息',
  list_tags:        '列出标签',
};

// ─── Message bubble ───
function Bubble({ msg }: any) {
  const theme = useTheme();
  const isUser = msg.role === 'user';
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const toolCalls = (!isUser && msg.toolCalls) ? msg.toolCalls : [];
  const shouldCollapse = toolCalls.length > TOOL_COLLAPSE_THRESHOLD;
  const visibleTools = shouldCollapse && !toolsExpanded
    ? toolCalls.slice(0, TOOL_COLLAPSE_THRESHOLD) : toolCalls;
  const hiddenCount = toolCalls.length - TOOL_COLLAPSE_THRESHOLD;

  const mdStyles = useMemo(() => ({
    body: { color: theme.colors.onSurface, fontSize: 14, lineHeight: 20 },
    paragraph: { marginTop: 2, marginBottom: 2 },
    heading1: { fontSize: 18, fontWeight: '700' as const, marginTop: 6, marginBottom: 3 },
    heading2: { fontSize: 16, fontWeight: '600' as const, marginTop: 5, marginBottom: 3 },
    heading3: { fontSize: 15, fontWeight: '600' as const, marginTop: 4, marginBottom: 2 },
    code_inline: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      backgroundColor: theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 3,
    },
    fence: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      backgroundColor: theme.dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)',
      padding: 8,
      borderRadius: 8,
      marginVertical: 4,
    },
    code_block: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      backgroundColor: theme.dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)',
      padding: 8,
      borderRadius: 8,
      marginVertical: 4,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: theme.dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
      paddingLeft: 8,
      marginVertical: 4,
      opacity: 0.85,
    },
    table: { borderColor: theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
    th: {
      fontWeight: '600' as const,
      padding: 4,
      backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    td: { padding: 4 },
    link: { color: '#3b82f6', textDecorationLine: 'underline' as const },
    bullet_list: { marginVertical: 2 },
    ordered_list: { marginVertical: 2 },
    list_item: { marginVertical: 1 },
    hr: {
      marginVertical: 6,
      backgroundColor: theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    },
    strong: { fontWeight: '600' as const },
  }), [theme]);

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAsst]}>
      <View style={[
        styles.bubble,
        isUser
          ? [styles.bubbleUser, { backgroundColor: theme.colors.primary }]
          : [styles.bubbleAsst, { backgroundColor: theme.colors.surfaceVariant }],
      ]}>
        {/* Tool calls (collapsible) */}
        {visibleTools.map((tc: any) => (
          <Chip
            key={tc.id}
            compact
            icon={tc.status === 'running' ? 'loading' : tc.status === 'done' ? 'check-circle' : 'close-circle'}
            style={{ marginBottom: 4, alignSelf: 'flex-start' }}
          >
            {(TOOL_LABELS as any)[tc.name] || tc.name}
          </Chip>
        ))}
        {shouldCollapse && (
          <TouchableOpacity onPress={() => setToolsExpanded(v => !v)} style={{ marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: theme.colors.primary }}>
              {toolsExpanded ? '收起' : `还有 ${hiddenCount} 个工具调用`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Error */}
        {msg.error && (
          <Text style={{ color: theme.colors.error, fontSize: 12, marginBottom: 4 }}>{msg.error}</Text>
        )}

        {/* Text */}
        {(msg.content || msg.isStreaming) && (
          isUser ? (
            <Text style={{ color: '#fff', fontSize: 14, lineHeight: 20 }}>
              {msg.content}
              {msg.isStreaming && !msg.content && <ActivityIndicator size="small" />}
            </Text>
          ) : (
            <View>
              {msg.content ? (
                <Markdown style={mdStyles}>{msg.content}</Markdown>
              ) : null}
              {msg.isStreaming && !msg.content && <ActivityIndicator size="small" />}
            </View>
          )
        )}
      </View>
    </View>
  );
}

// ─── Main component ───
/**
 * AI Chat bottom sheet
 * 
 * @param {Object}   props
 * @param {boolean}  props.visible
 * @param {Function} props.onClose
 * @param {Object}   [props.context]   — { route, entityType, entityId }
 */
export default function AIChatSheet({ visible, onClose, context }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const sheetRef = useRef(null);
  const flatRef = useRef(null);
  const abortRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState<any>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Open / close sheet
  useEffect(() => {
    if (visible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  // ─── Helpers ───

  const upsertMessage = useCallback((id: any, updater: any) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = updater(next[idx]);
      return next;
    });
  }, []);

  const upsertToolCall = useCallback((msgId: any, toolCallId: any, updater: any) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx === -1) return prev;
      const msg = prev[idx];
      const tcIdx = msg.toolCalls.findIndex((tc: any) => tc.id === toolCallId);
      const newToolCalls = [...msg.toolCalls];
      if (tcIdx === -1) newToolCalls.push(updater(null));
      else newToolCalls[tcIdx] = updater(newToolCalls[tcIdx]);
      const next = [...prev];
      next[idx] = { ...msg, toolCalls: newToolCalls };
      return next;
    });
  }, []);

  // ─── Send ───

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;
    setInputText('');

    const userMsgId = `u-${Date.now()}`;
    const asstMsgId = `a-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, toolCalls: [], isStreaming: false },
      { id: asstMsgId, role: 'assistant', content: '', toolCalls: [], isStreaming: true },
    ]);
    setIsLoading(true);

    abortRef.current = new AbortController();

    try {
      await sendChatMessage(
        baseUrl,
        { message: text, conversationId, context },
        (event) => {
          switch (event.type) {
            case 'conversation_id':
              if (event.id) setConversationId(event.id);
              break;
            case 'tool_call':
              upsertToolCall(asstMsgId, event.tool_call_id, () => ({
                id: event.tool_call_id, name: event.tool_name, status: 'running', result: null as any,
              }));
              break;
            case 'tool_result':
              upsertToolCall(asstMsgId, event.tool_call_id, (tc: any) => ({
                ...(tc || { id: event.tool_call_id, name: event.tool_name }),
                status: event.error ? 'error' : 'done',
              }));
              break;
            case 'text_delta':
              upsertMessage(asstMsgId, (msg: any) => ({ ...msg, content: msg.content + (event.delta || '') }));
              break;
            case 'done':
              upsertMessage(asstMsgId, (msg: any) => ({ ...msg, isStreaming: false }));
              setIsLoading(false);
              break;
            case 'error':
              upsertMessage(asstMsgId, (msg: any) => ({ ...msg, isStreaming: false, error: event.message || '未知错误' }));
              setIsLoading(false);
              break;
          }
        },
        abortRef.current,
      );
    } catch (err) {
      if (err?.name !== 'AbortError') {
        upsertMessage(asstMsgId, (msg: any) => ({ ...msg, isStreaming: false, error: err.message || '请求失败' }));
        setIsLoading(false);
      }
    }
  }, [inputText, isLoading, baseUrl, conversationId, context, upsertMessage, upsertToolCall]);

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setIsLoading(false);
  }, []);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['75%']}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={{ backgroundColor: theme.colors.surface }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.onSurfaceVariant }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.colors.outline + '30' }]}>
          <Text style={{ fontWeight: '600' as const, color: theme.colors.primary, flex: 1 }}>AI 助手</Text>
          <IconButton icon="refresh" size={18} onPress={handleNewChat} />
          <IconButton icon="close" size={18} onPress={onClose} />
        </View>

        {/* Messages */}
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item }) => <Bubble msg={item} />}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 }}>
                你好！我可以帮你搜索照片、查询胶卷、分析统计数据。{'\n'}试试问我「最近拍了什么？」
              </Text>
            </View>
          }
          contentContainerStyle={{ padding: 12, flexGrow: 1 }}
        />

        {/* Input */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.inputRow, { borderTopColor: theme.colors.outline + '30', backgroundColor: theme.colors.surface }]}>
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="发送消息…"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              style={[styles.textInput, { color: theme.colors.onSurface }]}
              multiline
              onSubmitEditing={handleSend}
              returnKeyType="send"
              blurOnSubmit
              editable={!isLoading}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!inputText.trim() || isLoading}
              style={[styles.sendBtn, { backgroundColor: theme.colors.primary, opacity: (!inputText.trim() || isLoading) ? 0.4 : 1 }]}
            >
              <Text style={{ color: '#fff', fontSize: 16 }}>↑</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  bubbleRow: {
    marginBottom: 10,
    flexDirection: 'row',
  },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAsst: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    padding: 10,
    borderRadius: 16,
  },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAsst: { borderBottomLeftRadius: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
