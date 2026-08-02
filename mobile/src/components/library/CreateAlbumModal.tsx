import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Modal, TextInput, Button, useTheme } from 'react-native-paper';
import { useT } from '../../i18n';
import { Icon } from '../ui';
import { buildParentOptions, type AlbumTreeNode } from './parentTree';

export interface AlbumRow extends AlbumTreeNode {
  id: number;
  title: string;
  description?: string | null;
  parent_id?: number | null;
  cover_photo_id?: number | null;
  cover_thumb?: string | null;
  photo_count?: number;
  total_photo_count?: number;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAlbumModalProps {
  visible: boolean;
  onDismiss: () => void;
  albums: AlbumRow[];
  title: string;
  onTitleChange: (v: string) => void;
  parentId: number | null;
  onParentChange: (v: number | null) => void;
  submitting: boolean;
  onSubmit: () => void;
  initialParentId?: number | null;
}

export default function CreateAlbumModal({
  visible,
  onDismiss,
  albums,
  title,
  onTitleChange,
  parentId,
  onParentChange,
  submitting,
  onSubmit,
  initialParentId,
}: CreateAlbumModalProps) {
  const theme = useTheme();
  const t = useT();

  useEffect(() => {
    if (visible) {
      onParentChange(initialParentId ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const candidates = useMemo(
    () => albums.filter((a) => a.id !== parentId),
    [albums, parentId],
  );

  const parentOptions = useMemo(() => buildParentOptions(candidates), [candidates]);

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
    >
      <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>
        {t('digital.createAlbumTitle')}
      </Text>
      <TextInput
        mode="outlined"
        label={t('digital.albumName')}
        placeholder={t('digital.albumNamePlaceholder')}
        value={title}
        onChangeText={onTitleChange}
        autoFocus
        style={styles.modalInput}
        onSubmitEditing={onSubmit}
      />
      <Text style={[styles.parentLabel, { color: theme.colors.onSurfaceVariant }]}>
        {t('digital.parentAlbumOptional')}
      </Text>
      <View style={[styles.parentList, { borderColor: theme.colors.outline }]}>
        <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
          <ParentChoiceRow
            label={t('digital.parentNone')}
            depth={0}
            selected={parentId == null}
            onSelect={() => onParentChange(null)}
          />
          {parentOptions.map(({ album, depth }) => (
            <ParentChoiceRow
              key={album.id}
              label={album.title}
              depth={depth}
              selected={parentId === album.id}
              onSelect={() => onParentChange(album.id)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.modalActions}>
        <Button onPress={onDismiss} textColor={theme.colors.onSurfaceVariant}>
          {t('common.cancel')}
        </Button>
        <Button
          mode="contained"
          onPress={onSubmit}
          loading={submitting}
          disabled={!title.trim() || submitting}
        >
          {t('digital.create')}
        </Button>
      </View>
    </Modal>
  );
}

export interface ParentChoiceRowProps {
  label: string;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}

export function ParentChoiceRow({ label, depth, selected, onSelect }: ParentChoiceRowProps) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      onPress={onSelect}
      style={[
        styles.parentRow,
        { paddingLeft: 12 + depth * 16, backgroundColor: selected ? theme.colors.primaryContainer : 'transparent' },
      ]}
    >
      <Icon
        name={selected ? 'check' : 'folder'}
        size={16}
        color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant}
      />
      <Text
        style={[
          styles.parentRowText,
          { color: selected ? theme.colors.primary : theme.colors.onSurface },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    borderRadius: 14,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: 'transparent',
    marginBottom: 8,
  },
  parentLabel: {
    fontSize: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  parentList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    marginBottom: 12,
  },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingRight: 12,
  },
  parentRowText: {
    fontSize: 14,
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
