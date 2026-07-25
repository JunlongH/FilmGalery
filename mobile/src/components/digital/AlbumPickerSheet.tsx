import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Modal, TextInput, Button, RadioButton, useTheme } from 'react-native-paper';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { invalidateQueries } from '../../api/queryCache';
import { t as translate, useT } from '../../i18n';
import { Icon } from '../ui';

export interface AlbumPickerAlbum {
  id: number;
  title: string;
  parent_id?: number | null;
  photo_count?: number;
  [key: string]: any;
}

export interface AlbumPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (albumId: number, album: AlbumPickerAlbum) => void;
  excludeAlbumId?: number | null;
}

export default function AlbumPickerSheet({
  visible,
  onDismiss,
  onSelect,
  excludeAlbumId,
}: AlbumPickerSheetProps) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);
  const albumsKey = baseUrl ? `digitalAlbums@${baseUrl}` : null;

  const albumsQuery = useApiQuery<AlbumPickerAlbum[]>(
    albumsKey,
    () => api.http.get('/api/albums', { include_deleted: false }),
  );
  const albums = useMemo(() => albumsQuery.data ?? [], [albumsQuery.data]);

  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(null);
      setCreating(false);
      setNewTitle('');
    }
  }, [visible]);

  const visibleAlbums = useMemo(
    () => albums.filter((a) => a.id !== excludeAlbumId),
    [albums, excludeAlbumId],
  );

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    try {
      const created: AlbumPickerAlbum = await api.http.post('/api/albums', { title });
      invalidateQueries(`digitalAlbums@`);
      albumsQuery.refresh();
      setCreating(false);
      setNewTitle('');
      onSelect(created.id, created);
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, submitting, albumsQuery, onSelect]);

  const handlePickRow = useCallback(
    (album: AlbumPickerAlbum) => {
      setSelected(album.id);
      onSelect(album.id, album);
    },
    [onSelect],
  );

  const loading = albumsQuery.loading && albums.length === 0;

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
    >
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>
            {t('digital.chooseAlbum')}
          </Text>
          <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
            <Icon name="x" size={22} color={theme.colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.createRow, { borderColor: theme.colors.outline }]}
          onPress={() => setCreating((v) => !v)}
        >
          <View style={[styles.createIcon, { backgroundColor: theme.colors.secondaryContainer }]}>
            <Icon name="plus" size={20} color={theme.colors.secondary} />
          </View>
          <Text style={[styles.createText, { color: theme.colors.secondary }]}>
            {t('digital.newAlbumQuick')}
          </Text>
        </TouchableOpacity>

        {creating && (
          <View style={styles.createForm}>
            <TextInput
              mode="outlined"
              label={t('digital.albumName')}
              placeholder={t('digital.albumNamePlaceholder')}
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
              style={styles.createInput}
              onSubmitEditing={handleCreate}
            />
            <Button
              mode="contained"
              onPress={handleCreate}
              loading={submitting}
              disabled={!newTitle.trim() || submitting}
            >
              {t('digital.create')}
            </Button>
          </View>
        )}

        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : visibleAlbums.length === 0 ? (
            <View style={styles.stateWrap}>
              <Text style={[styles.stateText, { color: theme.colors.onSurfaceVariant }]}>
                {t('digital.noAlbumsToPick')}
              </Text>
            </View>
          ) : (
            visibleAlbums.map((album) => (
              <AlbumPickerRow
                key={album.id}
                album={album}
                albums={visibleAlbums}
                selected={selected === album.id}
                onSelect={handlePickRow}
              />
            ))
          )}
        </ScrollView>
    </Modal>
  );
}

interface AlbumPickerRowProps {
  album: AlbumPickerAlbum;
  albums: AlbumPickerAlbum[];
  selected: boolean;
  onSelect: (album: AlbumPickerAlbum) => void;
}

function AlbumPickerRow({ album, albums, selected, onSelect }: AlbumPickerRowProps) {
  const theme = useTheme();
  const depth = useMemo(() => computeDepth(album, albums), [album, albums]);
  return (
    <TouchableOpacity
      onPress={() => onSelect(album)}
      style={[
        styles.row,
        { paddingLeft: 16 + depth * 16, backgroundColor: selected ? theme.colors.secondaryContainer : 'transparent' },
      ]}
    >
      <RadioButton.Android
        value={String(album.id)}
        status={selected ? 'checked' : 'unchecked'}
        onPress={() => onSelect(album)}
        color={theme.colors.secondary}
      />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {album.title}
        </Text>
        {typeof album.photo_count === 'number' && (
          <Text style={[styles.rowMeta, { color: theme.colors.onSurfaceVariant }]}>
            {translate('digital.albumPhotosCount', { count: album.photo_count })}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function computeDepth(album: AlbumPickerAlbum, albums: AlbumPickerAlbum[]): number {
  const ids = new Set(albums.map((a) => a.id));
  let depth = 0;
  let cur: number | null | undefined = album.parent_id;
  const seen = new Set<number>();
  while (cur != null && ids.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    if (depth > 16) break;
    const parent = albums.find((a) => a.id === cur);
    cur = parent?.parent_id;
  }
  return depth;
}

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    borderRadius: 14,
    paddingVertical: 12,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  createIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: {
    fontSize: 14,
    fontWeight: '600',
  },
  createForm: {
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  createInput: {
    backgroundColor: 'transparent',
  },
  list: {
    maxHeight: 360,
  },
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  stateText: {
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    paddingVertical: 10,
    gap: 4,
  },
  rowBody: {
    flex: 1,
    marginLeft: 4,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  rowMeta: {
    fontSize: 11,
    marginTop: 1,
  },
});
