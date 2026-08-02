import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  useTheme,
  Modal,
  Searchbar,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { invalidateQueries } from '../../api/queryCache';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import CachedImage from '../../components/CachedImage';
import CreateAlbumModal, {
  type AlbumRow,
} from '../../components/library/CreateAlbumModal';
import EditAlbumModal from '../../components/library/EditAlbumModal';
import { computeDepth } from '../../components/library/parentTree';

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

  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [actionTarget, setActionTarget] = useState<AlbumRow | null>(null);
  const [editTarget, setEditTarget] = useState<AlbumRow | null>(null);

  const searching = searchQuery.trim().length > 0;
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const toggleCollapse = useCallback((id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { flatTree, childCountByAlbum } = useMemo<{
    flatTree: FlatAlbumNode[];
    childCountByAlbum: Map<number, number>;
  }>(() => {
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
    const childCountByAlbum = new Map<number, number>();
    for (const [parentId, list] of childrenByParent.entries()) {
      childCountByAlbum.set(parentId, list.length);
    }
    if (searching) {
      const matched = albums.filter((a) =>
        (a.title ?? '').toLowerCase().includes(normalizedSearch),
      );
      const out: FlatAlbumNode[] = matched.map((album) => ({
        album,
        depth: computeDepth(album, albums),
      }));
      return { flatTree: out, childCountByAlbum };
    }
    const out: FlatAlbumNode[] = [];
    const walk = (album: AlbumRow, depth: number) => {
      out.push({ album, depth });
      if (collapsedIds.has(album.id)) return;
      const children = childrenByParent.get(album.id) ?? [];
      for (const c of children) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return { flatTree: out, childCountByAlbum };
  }, [albums, collapsedIds, searching, normalizedSearch]);

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

  const handleRowLongPress = useCallback((album: AlbumRow) => {
    setActionTarget(album);
  }, []);

  const closeActionSheet = useCallback(() => setActionTarget(null), []);

  const openEditor = useCallback(() => {
    if (!actionTarget) return;
    setEditTarget(actionTarget);
    setActionTarget(null);
  }, [actionTarget]);

  const handleDelete = useCallback(() => {
    const target = actionTarget;
    if (!target) return;
    setActionTarget(null);
    Alert.alert(t('digital.deleteAlbum'), t('digital.deleteAlbumConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.http.delete(`/api/albums/${target.id}`);
            invalidateQueries(`digitalAlbums@`);
            refreshAlbums();
          } catch {
            /* surfaced via ApiErrorSnackbar */
          }
        },
      },
    ]);
  }, [actionTarget, refreshAlbums, t]);

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
    const childCount = childCountByAlbum.get(album.id) ?? 0;
    const isChild = depth > 0;
    const isCollapsed = collapsedIds.has(album.id);
    const showChildren = !searching && childCount > 0;
    return (
      <TouchableOpacity
        onPress={() => openAlbum(album)}
        onLongPress={() => handleRowLongPress(album)}
        activeOpacity={0.85}
        style={[
          styles.row,
          {
            paddingLeft: 16 + depth * 20,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        {isChild ? (
          <View
            pointerEvents="none"
            style={[
              styles.guide,
              {
                left: 16 + (depth - 1) * 20 + 9,
                backgroundColor: theme.colors.outlineVariant,
              },
            ]}
          />
        ) : null}
        <View style={styles.coverWrap}>
          <View
            style={[
              styles.cover,
              { backgroundColor: theme.colors.surfaceVariant },
              isChild && styles.coverChild,
            ]}
          >
            {cover ? (
              <CachedImage uri={cover} style={styles.coverImg} contentFit="cover" />
            ) : (
              <View style={[styles.coverImg, styles.coverPlaceholder]}>
                <Icon name="folder" size={isChild ? 18 : 22} color={theme.colors.onSurfaceVariant} />
              </View>
            )}
          </View>
          {showChildren ? (
            <View
              style={[styles.childBadge, { backgroundColor: theme.colors.primaryContainer }]}
            >
              <Text
                style={[styles.childBadgeText, { color: theme.colors.onPrimaryContainer }]}
              >
                {childCount}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.body}>
          <Text
            style={[
              styles.title,
              { color: theme.colors.onSurface },
              isChild && styles.titleChild,
            ]}
            numberOfLines={1}
          >
            {album.title}
          </Text>
          <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {typeof album.photo_count === 'number'
              ? t('digital.albumPhotosCount', { count: album.photo_count })
              : ''}
          </Text>
        </View>
        {showChildren ? (
          <TouchableOpacity
            onPress={() => toggleCollapse(album.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.toggle}
            activeOpacity={0.6}
          >
            <Icon
              name={isCollapsed ? 'chevron-right' : 'chevron-down'}
              size={20}
              color={theme.colors.onSurfaceVariant}
            />
          </TouchableOpacity>
        ) : (
          <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
        )}
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
            <Searchbar
              placeholder={t('digital.searchAlbums')}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
              inputStyle={{ color: theme.colors.onSurface }}
            />

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

      <EditAlbumModal
        visible={!!editTarget}
        album={editTarget}
        albums={albums}
        onDismiss={() => setEditTarget(null)}
        onSaved={() => refreshAlbums()}
      />

      <Modal
        visible={!!actionTarget}
        onDismiss={closeActionSheet}
        contentContainerStyle={[styles.actionSheet, { backgroundColor: theme.colors.surface }]}
      >
        <Text style={[styles.actionTitle, { color: theme.colors.onSurfaceVariant }]}>
          {actionTarget?.title ?? ''}
        </Text>
        <ActionButton
          label={t('digital.editAlbum')}
          icon="edit"
          iconColor={theme.colors.onSurface}
          onPress={openEditor}
        />
        <ActionButton
          label={t('digital.deleteAlbum')}
          icon="trash-2"
          iconColor={theme.colors.error}
          textColor={theme.colors.error}
          onPress={handleDelete}
        />
        <View style={[styles.actionDivider, { backgroundColor: theme.colors.outline }]} />
        <ActionButton label={t('common.cancel')} onPress={closeActionSheet} />
      </Modal>
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  icon?: string;
  iconColor?: string;
  textColor?: string;
  onPress: () => void;
}

function ActionButton({ label, icon, iconColor, textColor, onPress }: ActionButtonProps) {
  const theme = useTheme();
  const color = textColor ?? theme.colors.onSurface;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.actionBtn, { borderBottomColor: theme.colors.outline + '20' }]}
    >
      {icon ? (
        <Icon name={icon} size={20} color={iconColor ?? color} />
      ) : (
        <View style={{ width: 20 }} />
      )}
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24 },
  searchbar: {
    marginHorizontal: 4,
    marginBottom: 12,
    borderRadius: 12,
  },
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
  guide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  coverWrap: {
    position: 'relative',
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  coverChild: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  coverImg: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  childBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    height: 16,
    minWidth: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  toggle: {
    padding: 8,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  titleChild: {
    fontSize: 14,
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
  actionSheet: {
    margin: 24,
    borderRadius: 14,
    paddingVertical: 8,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '500',
  },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
