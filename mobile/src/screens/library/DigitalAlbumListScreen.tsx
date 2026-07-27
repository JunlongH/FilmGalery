import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {
  useTheme,
  Modal,
  TextInput,
  Button,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { invalidateQueries } from '../../api/queryCache';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import CachedImage from '../../components/CachedImage';

interface AlbumRow {
  id: number;
  title: string;
  description?: string | null;
  parent_id?: number | null;
  cover_photo_id?: number | null;
  cover_thumb?: string | null;
  photo_count?: number;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

interface FlatAlbumNode {
  album: AlbumRow;
  depth: number;
}

export default function DigitalAlbumListScreen() {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const albumsKey = baseUrl ? `digitalAlbums@${baseUrl}` : null;

  const albumsQuery = useApiQuery<AlbumRow[]>(
    albumsKey,
    () => api.http.get('/api/albums', { include_deleted: false }),
  );
  const refreshAlbums = albumsQuery.refresh;

  const albums = useMemo(() => albumsQuery.data ?? [], [albumsQuery.data]);

  const flatTree = useMemo<FlatAlbumNode[]>(() => {
    const ids = new Set(albums.map((a) => a.id));
    const childrenByParent = new Map<number, AlbumRow[]>();
    const roots: AlbumRow[] = [];
    for (const a of albums) {
      if (a.parent_id != null && ids.has(a.parent_id)) {
        const list = childrenByParent.get(a.parent_id) ?? [];
        list.push(a);
        childrenByParent.set(a.parent_id, list);
      } else {
        roots.push(a);
      }
    }
    const out: FlatAlbumNode[] = [];
    const walk = (album: AlbumRow, depth: number) => {
      out.push({ album, depth });
      const children = childrenByParent.get(album.id) ?? [];
      for (const c of children) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [albums]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newParentId, setNewParentId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    try {
      const payload: { title: string; parent_id?: number } = { title };
      if (newParentId != null) payload.parent_id = newParentId;
      await api.http.post('/api/albums', payload);
      invalidateQueries(`digitalAlbums@`);
      refreshAlbums();
      setCreateOpen(false);
      setNewTitle('');
      setNewParentId(null);
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, submitting, newParentId, refreshAlbums]);

  const onRefresh = useCallback(() => {
    refreshAlbums();
  }, [refreshAlbums]);

  const openAlbum = useCallback(
    (album: AlbumRow) => {
      navigation.navigate('DigitalAlbumDetail', { id: album.id, title: album.title });
    },
    [navigation],
  );

  const coverUrl = useCallback(
    (album: AlbumRow): string | null => {
      if (!baseUrl || !album.cover_thumb) return null;
      return `${baseUrl}/uploads/${album.cover_thumb}`;
    },
    [baseUrl],
  );

  const renderItem = ({ item }: { item: FlatAlbumNode }) => {
    const { album, depth } = item;
    const cover = coverUrl(album);
    return (
      <TouchableOpacity
        onPress={() => openAlbum(album)}
        activeOpacity={0.85}
        style={[styles.row, { paddingLeft: 16 + depth * 20, backgroundColor: theme.colors.surface }]}
      >
        <View style={[styles.cover, { backgroundColor: theme.colors.surfaceVariant }]}>
          {cover ? (
            <CachedImage uri={cover} style={styles.coverImg} contentFit="cover" />
          ) : (
            <View style={[styles.coverImg, styles.coverPlaceholder]}>
              <Icon name="folder" size={22} color={theme.colors.onSurfaceVariant} />
            </View>
          )}
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {album.title}
          </Text>
          <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {typeof album.photo_count === 'number'
              ? t('digital.albumPhotosCount', { count: album.photo_count })
              : ''}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
      </TouchableOpacity>
    );
  };

  const loading = albumsQuery.loading && albums.length === 0;
  const error = albumsQuery.error && albums.length === 0 ? albumsQuery.error : undefined;

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Icon name="alert" size={40} color={theme.colors.onSurfaceVariant} />
        <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant, marginTop: 12 }]}>
          {t('digital.albumsLoadFailed')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={flatTree}
        keyExtractor={(item) => String(item.album.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={albumsQuery.refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="folder" size={40} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
              {t('digital.albumsEmptyTitle')}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              {t('digital.albumsEmptyBody')}
            </Text>
          </View>
        }
        ListHeaderComponent={
          <>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setCreateOpen(true)}
              style={[styles.createEntry, { backgroundColor: theme.colors.surface }]}
            >
              <View
                style={[styles.createEntryIcon, { backgroundColor: theme.colors.secondaryContainer }]}
              >
                <Icon name="plus" size={24} color={theme.colors.secondary} />
              </View>
              <View style={styles.createEntryBody}>
                <Text style={[styles.createEntryTitle, { color: theme.colors.onSurface }]}>
                  {t('digital.createAlbum')}
                </Text>
                <Text style={[styles.createEntryHint, { color: theme.colors.onSurfaceVariant }]}>
                  {t('digital.albumsEmptyBody')}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
            </TouchableOpacity>

            {albums.length > 0 ? (
              <Text style={[styles.headerCount, { color: theme.colors.onSurfaceVariant }]}>
                {t('digital.albumsCount', { count: albums.length })}
              </Text>
            ) : null}
          </>
        }
      />

      <CreateAlbumModal
        visible={createOpen}
        onDismiss={() => {
          setCreateOpen(false);
          setNewTitle('');
          setNewParentId(null);
        }}
        albums={albums}
        title={newTitle}
        onTitleChange={setNewTitle}
        parentId={newParentId}
        onParentChange={setNewParentId}
        submitting={submitting}
        onSubmit={handleCreate}
      />
    </View>
  );
}

interface CreateAlbumModalProps {
  visible: boolean;
  onDismiss: () => void;
  albums: AlbumRow[];
  title: string;
  onTitleChange: (v: string) => void;
  parentId: number | null;
  onParentChange: (v: number | null) => void;
  submitting: boolean;
  onSubmit: () => void;
}

function CreateAlbumModal({
  visible,
  onDismiss,
  albums,
  title,
  onTitleChange,
  parentId,
  onParentChange,
  submitting,
  onSubmit,
}: CreateAlbumModalProps) {
  const theme = useTheme();
  const t = useT();

  const candidates = useMemo(
    () => albums.filter((a) => a.id !== parentId),
    [albums, parentId],
  );

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
            {candidates.map((album) => {
              const depth = computeParentDepth(album, albums);
              return (
                <ParentChoiceRow
                  key={album.id}
                  label={album.title}
                  depth={depth}
                  selected={parentId === album.id}
                  onSelect={() => onParentChange(album.id)}
                />
              );
            })}
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

interface ParentChoiceRowProps {
  label: string;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}

function ParentChoiceRow({ label, depth, selected, onSelect }: ParentChoiceRowProps) {
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

function computeParentDepth(album: AlbumRow, albums: AlbumRow[]): number {
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
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24 },
  headerCount: {
    fontSize: 12,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingRight: 12,
    borderRadius: 12,
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  coverImg: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyBody: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
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
  createEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 16,
  },
  createEntryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createEntryBody: {
    flex: 1,
  },
  createEntryTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  createEntryHint: {
    fontSize: 12,
    marginTop: 2,
  },
});
