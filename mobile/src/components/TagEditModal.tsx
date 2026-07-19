import React, { useState, useEffect, useContext } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, TextInput, Chip, Button, useTheme } from 'react-native-paper';
import { api } from '../api/client';
import { ApiContext } from '../context/ApiContext';
import { Icon } from './ui';
import { useT } from '../i18n';

export interface TagEditModalPhoto {
  id: number | string;
  tags?: Array<{ id: number; name: string } | string>;
}

export interface TagEditModalProps {
  visible: boolean;
  onDismiss: () => void;
  photo?: TagEditModalPhoto | null;
  onSave?: (tags: string[]) => void;
}

interface TagOption {
  id: number;
  name: string;
}

export default function TagEditModal({ visible, onDismiss, photo, onSave }: TagEditModalProps) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);
  const [input, setInput] = useState<string>('');
  const [currentTags, setCurrentTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [suggestions, setSuggestions] = useState<TagOption[]>([]);

  useEffect(() => {
    if (visible && photo) {
      const tags = photo.tags ? photo.tags.map((t) => (typeof t === 'object' ? t.name : t)) : [];
      setCurrentTags(tags);
      fetchTags();
    }
  }, [visible, photo]);

  const fetchTags = async () => {
    if (!baseUrl) return;
    try {
      const res: any = await api.http.get('/api/tags');
      setAllTags(res);
    } catch (err) {
      console.error('Failed to fetch tags', err);
    }
  };

  useEffect(() => {
    const lower = input.toLowerCase().trim();
    let filtered = allTags.filter((t) => !currentTags.includes(t.name));
    if (lower) filtered = filtered.filter((t: any) => t.name.toLowerCase().includes(lower));
    setSuggestions(filtered);
  }, [input, allTags, currentTags]);

  const addTag = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (currentTags.includes(trimmed)) return;
    setCurrentTags([...currentTags, trimmed]);
    setInput('');
  };

  const removeTag = (name: string) => {
    setCurrentTags(currentTags.filter((t) => t !== name));
  };

  const handleSave = async () => {
    if (!baseUrl || !photo) return;

    const finalTags = [...currentTags];
    if (input.trim() && !finalTags.includes(input.trim())) {
      finalTags.push(input.trim());
    }

    console.log('[TagEditModal] Saving tags:', finalTags, 'for photo:', photo.id);

    try {
      const response = await api.http.put(`/api/photos/${photo.id}`, { tags: finalTags });
      console.log('[TagEditModal] Save response:', response);
      onSave?.(finalTags);
      onDismiss();
    } catch (err: any) {
      console.error('[TagEditModal] Failed to save tags:', err);
      console.error('[TagEditModal] Error details:', err.response?.data || (err as Error).message);
      alert(`保存标签失败：${err.response?.data?.error || (err as Error).message}`);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>编辑标签</Text>

        <View style={styles.tagContainer}>
          {currentTags.map((tag) => (
            <Chip
              key={tag}
              onClose={() => removeTag(tag)}
              style={styles.chip}
              textStyle={{ color: '#2e7d32' }}
              closeIcon="close"
            >
              {tag}
            </Chip>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            mode="outlined"
            label="添加标签..."
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => addTag(input)}
            style={[styles.input, { flex: 1 }]}
          />
          <TouchableOpacity
            onPress={() => addTag(input)}
            style={{
              marginLeft: 8,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.colors.primary,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Icon name="plus" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>从现有标签中选择</Text>
        <ScrollView style={styles.suggestions} keyboardShouldPersistTaps="handled">
          {suggestions.length === 0 ? (
            <View style={styles.emptyBox}><Text style={{ color: '#888' }}>没有匹配的标签</Text></View>
          ) : (
            suggestions.map((s) => (
              <TouchableOpacity key={s.id} onPress={() => addTag(s.name)} style={styles.suggestionItem}>
                <Text>{s.name}</Text>
                <Text style={{ color: '#2e7d32', fontWeight: 'bold' as const }}>+</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Button onPress={onDismiss}>取消</Button>
          <Button mode="contained" onPress={handleSave}>保存</Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: { padding: 20, margin: 20, borderRadius: 8 },
  title: { fontSize: 20, fontWeight: 'bold' as const, marginBottom: 16 },
  tagContainer: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  chip: { margin: 4, backgroundColor: '#eef8ee' },
  input: { marginBottom: 8 },
  suggestions: { maxHeight: 150, marginBottom: 16, borderWidth: 1, borderColor: '#eee', borderRadius: 4 },
  sectionTitle: { marginTop: 8, marginBottom: 6, color: '#666', fontSize: 12, textTransform: 'uppercase' as const },
  suggestionItem: { padding: 12, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eee' },
  emptyBox: { padding: 12, alignItems: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
});
