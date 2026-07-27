// DigitalAlbumDetailScreen — photos in a digital album.
//
// NOTE: server-side GET /api/albums/:id/photos ignores pagination params (the
// prepared statement doesn't read req.query), so it returns ALL photos of the
// album in one shot. We therefore fetch once into `digitalAlbumPhotos@...` and
// let the FlatList windowize rendering (initialNumToRender / maxToRenderPerBatch
// / windowSize are set inside DigitalPhotoGrid).

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  useTheme,
  Modal,
  Snackbar,
  IconButton,
} from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { getQueryData, invalidateQueries, setQueryData } from '../../api/queryCache';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import DigitalPhotoGrid, { type DigitalPhoto } from '../../components/digital/DigitalPhotoGrid';
import AlbumPickerSheet, { type AlbumPickerAlbum } from '../../components/digital/AlbumPickerSheet';

interface AlbumMeta {
  id: number;
  title: string;
  description?: string | null;
  parent_id?: number | null;
  cover_photo_id?: number | null;
}

type ActionKind = 'add' | 'remove' | 'cover' | null;

export default function DigitalAlbumDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const albumId: number = route.params?.id;
  const routeTitle: string | undefined = route.params?.title;

  const photosKey = baseUrl ? `digitalAlbumPhotos@${baseUrl}.${albumId}` : null;
  const albumKey = baseUrl ? `digitalAlbum@${baseUrl}.${albumId}` : null;

  const photosQuery = useApiQuery<DigitalPhoto[]>(
    photosKey,
    () => api.http.get(`/api/albums/${albumId}/photos`),
  );
  const albumQuery = useApiQuery<AlbumMeta>(
    albumKey,
    () => api.http.get(`/api/albums/${albumId}`),
  );

  const photos = useMemo(() => photosQuery.data ?? [], [photosQuery.data]);

  const [activePhoto, setActivePhoto] = useState<DigitalPhoto | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const headerTitle = albumQuery.data?.title || routeTitle || t('digital.albumDetailTitle');
  const photoCount = photos.length;

  useEffect(() => {
    navigation.setOptions({
      title: headerTitle,
      headerRight: () => (
        <IconButton
          icon="upload"
          iconColor={theme.colors.primary}
          size={22}
          accessibilityLabel={t('digital.import.title')}
          onPress={() =>
            navigation.navigate('DigitalImport', {
              albumId,
              albumTitle: headerTitle,
            })
          }
        />
      ),
    });
  }, [navigation, headerTitle, theme, albumId, t]);

  const onPhotoPress = useCallback(
    (photo: DigitalPhoto, index: number) => {
      navigation.navigate('PhotoView', {
        photo,
        photosKey,
        initialIndex: index,
        viewMode: 'positive',
        source_type: 'digital',
      });
    },
    [navigation, photosKey],
  );

  const onPhotoLongPress = useCallback((photo: DigitalPhoto) => {
    setActivePhoto(photo);
  }, []);

  const closeAction = useCallback(() => setActivePhoto(null), []);

  const handleAddToAlbum = useCallback(() => {
    setPickerVisible(true);
  }, []);

  const handlePickerSelect = useCallback(
    async (targetId: number) => {
      const photo = activePhoto;
      if (!photo) return;
      setPickerVisible(false);
      setBusy(true);
      try {
        await api.http.post(`/api/albums/${targetId}/photos`, { photo_ids: [photo.id] });
        invalidateQueries(`digitalAlbums@`);
        if (targetId !== albumId) {
          invalidateQueries(`digitalAlbumPhotos@${baseUrl}.${targetId}`);
        }
        setSnack(t('digital.addedToAlbum'));
      } catch {
        /* surfaced via ApiErrorSnackbar */
      } finally {
        setBusy(false);
        setActivePhoto(null);
      }
    },
    [activePhoto, albumId, baseUrl, t],
  );

  const handleRemoveFromAlbum = useCallback(async () => {
    const photo = activePhoto;
    if (!photo) return;
    setActivePhoto(null);
    setBusy(true);
    try {
      await api.http.delete(`/api/albums/${albumId}/photos/${photo.id}`);
      if (photosKey) {
        const current = getQueryData<DigitalPhoto[]>(photosKey) ?? [];
        setQueryData<DigitalPhoto[]>(
          photosKey,
          current.filter((p) => p.id !== photo.id),
        );
      }
      invalidateQueries(`digitalAlbums@`);
      setSnack(t('digital.removedFromAlbum'));
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setBusy(false);
    }
  }, [activePhoto, albumId, photosKey, t]);

  const handleSetCover = useCallback(async () => {
    const photo = activePhoto;
    if (!photo) return;
    setActivePhoto(null);
    setBusy(true);
    try {
      await api.http.post(`/api/albums/${albumId}/cover`, { photo_id: photo.id });
      invalidateQueries(`digitalAlbums@`);
      invalidateQueries(`digitalAlbum@${baseUrl}.${albumId}`);
      setSnack(t('digital.coverSet'));
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setBusy(false);
    }
  }, [activePhoto, albumId, baseUrl, t]);

  const header = (
    <View style={styles.header}>
      <Text style={[styles.albumTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
        {headerTitle}
      </Text>
      <Text style={[styles.albumMeta, { color: theme.colors.onSurfaceVariant }]}>
        {t('digital.albumPhotosCount', { count: photoCount })}
      </Text>
    </View>
  );

  const empty = (
    <View style={styles.empty}>
      <Icon name="image" size={40} color={theme.colors.onSurfaceVariant} />
      <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
        {t('digital.albumsEmptyTitle')}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
        {t('digital.albumsEmptyBody')}
      </Text>
    </View>
  );

  const loading = photosQuery.loading && photos.length === 0;

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <DigitalPhotoGrid
        photos={photos}
        baseUrl={baseUrl}
        onPhotoPress={onPhotoPress}
        onPhotoLongPress={onPhotoLongPress}
        refreshing={photosQuery.refreshing}
        onRefresh={() => photosQuery.refresh()}
        ListHeaderComponent={photos.length > 0 ? header : null}
        ListEmptyComponent={empty}
      />

      <Modal
        visible={!!activePhoto}
        onDismiss={closeAction}
        contentContainerStyle={[styles.actionSheet, { backgroundColor: theme.colors.surface }]}
      >
        <Text style={[styles.actionTitle, { color: theme.colors.onSurface }]}>
          {t('digital.photoActions')}
        </Text>
        <ActionButton
          label={t('digital.addToAlbum')}
          icon="folder-plus"
          onPress={handleAddToAlbum}
        />
        <ActionButton
          label={t('digital.setCover')}
          icon="image"
          onPress={handleSetCover}
        />
        <ActionButton
          label={t('digital.removeFromAlbum')}
          icon="trash-2"
          destructive
          onPress={handleRemoveFromAlbum}
        />
        <View style={[styles.actionDivider, { backgroundColor: theme.colors.outline }]} />
        <ActionButton label={t('common.cancel')} onPress={closeAction} />
      </Modal>

      <AlbumPickerSheet
        visible={pickerVisible}
        onDismiss={() => {
          setPickerVisible(false);
          setActivePhoto(null);
        }}
        onSelect={handlePickerSelect}
        excludeAlbumId={albumId}
      />

      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack(null)}
        duration={2000}
        style={{ backgroundColor: theme.colors.secondaryContainer }}
      >
        {snack ?? ''}
      </Snackbar>

      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
}

function ActionButton({ label, icon, onPress, destructive }: ActionButtonProps) {
  const theme = useTheme();
  const color = destructive ? theme.colors.error : theme.colors.onSurface;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.actionBtn, { borderBottomColor: theme.colors.outline + '20' }]}
    >
      {icon ? <Icon name={icon} size={20} color={color} /> : <View style={{ width: 20 }} />}
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 12,
  },
  albumTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  albumMeta: {
    fontSize: 13,
    marginTop: 4,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
