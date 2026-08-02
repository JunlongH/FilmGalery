import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Modal, TextInput, Button, useTheme } from 'react-native-paper';
import { api } from '../../api/client';
import { invalidateQueries } from '../../api/queryCache';
import { useT } from '../../i18n';
import { computeDepth, computeDescendantIds } from './parentTree';
import { ParentChoiceRow, type AlbumRow } from './CreateAlbumModal';

export interface EditAlbumModalProps {
  visible: boolean;
  album: AlbumRow | null;
  albums: AlbumRow[];
  onDismiss: () => void;
  onSaved: () => void;
}

export default function EditAlbumModal({
  visible,
  album,
  albums,
  onDismiss,
  onSaved,
}: EditAlbumModalProps) {
  const theme = useTheme();
  const t = useT();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [initialParentId, setInitialParentId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && album) {
      setTitle(album.title ?? '');
      setDescription(album.description ?? '');
      const initial = album.parent_id ?? null;
      setParentId(initial);
      setInitialParentId(initial);
      setError(null);
    }
  }, [visible, album]);

  const candidates = useMemo(() => {
    if (!album) return [];
    const excluded = computeDescendantIds(albums, album.id);
    excluded.add(album.id);
    return albums.filter((a) => !excluded.has(a.id));
  }, [albums, album]);

  const handleSave = async () => {
    if (!album) return;
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: {
        title: string;
        description: string;
        parent_id?: number | null;
      } = {
        title: trimmed,
        description: description.trim(),
      };
      const norm = (v: number | null | undefined): number | null =>
        v == null ? null : Number(v);
      if (norm(parentId) !== norm(initialParentId)) {
        body.parent_id = parentId;
      }
      await api.http.put(`/api/albums/${album.id}`, body);
      invalidateQueries(`digitalAlbums@`);
      onSaved();
      onDismiss();
    } catch (e) {
      setError((e as Error)?.message || t('digital.editAlbumFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
    >
      <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>
        {t('digital.editAlbumTitle')}
      </Text>
      <TextInput
        mode="outlined"
        label={t('digital.albumName')}
        placeholder={t('digital.albumNamePlaceholder')}
        value={title}
        onChangeText={setTitle}
        autoFocus
        style={styles.modalInput}
      />
      <TextInput
        mode="outlined"
        label={t('digital.albumDescription')}
        placeholder={t('digital.albumDescriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        style={styles.modalInput}
        multiline
      />
      <Text style={[styles.parentLabel, { color: theme.colors.onSurfaceVariant }]}>
        {t('digital.parentAlbumOptional')}
      </Text>
      <View style={[styles.parentList, { borderColor: theme.colors.outline }]}>
        <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
          <ParentChoiceRow
            label={t('digital.noParent')}
            depth={0}
            selected={parentId == null}
            onSelect={() => setParentId(null)}
          />
          {candidates.map((a) => {
            const depth = computeDepth(a, albums);
            return (
              <ParentChoiceRow
                key={a.id}
                label={a.title}
                depth={depth}
                selected={parentId === a.id}
                onSelect={() => setParentId(a.id)}
              />
            );
          })}
        </ScrollView>
      </View>
      {error ? (
        <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
      ) : null}
      <View style={styles.modalActions}>
        <Button onPress={onDismiss} textColor={theme.colors.onSurfaceVariant}>
          {t('common.cancel')}
        </Button>
        <Button
          mode="contained"
          onPress={handleSave}
          loading={submitting}
          disabled={!title.trim() || submitting}
        >
          {t('common.save')}
        </Button>
      </View>
    </Modal>
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
  errorText: {
    fontSize: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
