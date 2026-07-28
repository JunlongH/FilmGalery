import React, { useContext, useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, Platform, TouchableOpacity, Alert } from 'react-native';
import { ApiContext } from '../../context/ApiContext';
import { Chip, Text, Snackbar } from 'react-native-paper';
import { Icon } from '../../components/ui';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';
import ImageView from 'react-native-image-viewing';
import TagEditModal from '../../components/TagEditModal';
import NoteEditModal from '../../components/NoteEditModal';
import AlbumPickerSheet, { type AlbumPickerAlbum } from '../../components/digital/AlbumPickerSheet';
import ExifSheet from '../../components/digital/ExifSheet';
import { api } from '../../api/client';
import { colors, spacing, radius } from '../../theme';
import { getPhotoUrl } from '../../utils/urls';
import { useQueryData } from '../../hooks/useApiQuery';
import { setQueryData, invalidateQueries } from '../../api/queryCache';
import { useT } from '../../i18n';

export default function PhotoViewScreen({ route, navigation }: any) {
  const { photo: initialPhoto, photoId, viewMode: initialViewMode = 'positive', photosKey, initialIndex = 0 } = route.params || {};
  const { baseUrl } = useContext(ApiContext);
  const t = useT();
  const cachedPhotos = useQueryData<any[]>(photosKey ?? null);
  const photos = useMemo(() => cachedPhotos ?? (initialPhoto ? [initialPhoto] : []), [cachedPhotos, initialPhoto]);
  const [photo, setPhoto] = useState(initialPhoto || photos[initialIndex] || null);
  const [loading, setLoading] = useState(!initialPhoto && !!photoId && !photosKey);
  const [index, setIndex] = useState(initialIndex);
  const [startIndex] = useState(initialIndex);
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [snack, setSnack] = useState({ visible: false, msg: '' });
  const [downloading, setDownloading] = useState(false);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [exifSheetVisible, setExifSheetVisible] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [albumsForPhoto, setAlbumsForPhoto] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef(photo);
  useEffect(() => { photoRef.current = photo; }, [photo]);

  const overlayRenderRef = useRef<{
    header: (() => React.ReactNode) | null;
    footer: (() => React.ReactNode) | null;
  }>({ header: null, footer: null });
  const HeaderComponent = useMemo(() => () => overlayRenderRef.current.header?.() ?? null, []);
  const FooterComponent = useMemo(() => () => overlayRenderRef.current.footer?.() ?? null, []);

  const isDigital = photo?.source_type === 'digital';

  // Fetch photo data if only photoId was provided
  useEffect(() => {
    if (!initialPhoto && !photosKey && photoId && baseUrl) {
      setLoading(true);
      api.http.get(`/api/photos/single/${photoId}`)
        .then((res) => setPhoto(res))
        .catch(() => setSnack({ visible: true, msg: t('photo.loadFailed') }))
        .finally(() => setLoading(false));
    }
  }, [initialPhoto, photosKey, photoId, baseUrl]);

  // Keep current photo in sync with the cached list (e.g. updated elsewhere)
  useEffect(() => {
    if (photos.length > 0 && photos[index] && photos[index].id !== photo?.id) {
      setPhoto(photos[index]);
    }
  }, [photos, index]);

  const fullUrlFor = (p: any) =>
    getPhotoUrl(baseUrl, p, viewMode === 'negative' && p.negative_rel_path ? 'negative' : 'full');

  // Prefetch adjacent full-resolution images for smoother swiping
  useEffect(() => {
    if (!baseUrl || photos.length < 2) return;
    const targets = [index - 2, index - 1, index + 1, index + 2]
      .filter((i) => i >= 0 && i < photos.length)
      .map((i) => fullUrlFor(photos[i]))
      .filter(Boolean) as string[];
    if (targets.length > 0) {
      ExpoImage.prefetch(targets).catch(() => {});
    }
  }, [index, photos, baseUrl, viewMode]);

  const images = useMemo(
    () =>
      photos.map((p: any) => ({
        uri: fullUrlFor(p) || '',
        thumbUri: getPhotoUrl(baseUrl, p, 'thumb') || undefined,
      })),
    [photos, baseUrl, viewMode],
  );

  const anyNegatives = useMemo(
    () => Array.isArray(photos) && photos.some((p: any) => p.negative_rel_path),
    [photos],
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 16, color: colors.textSecondary }}>{t('photo.loading')}</Text>
      </View>
    );
  }

  if (!photo) {
    return (
      <View style={[styles.container, styles.center]}>
        <Icon name="alert" size={48} color={colors.error} />
        <Text style={{ marginTop: 16, color: colors.textSecondary }}>{t('photo.notFound')}</Text>
      </View>
    );
  }

  const handleTagsSaved = (newTags: any) => {
    setPhoto({ ...photo, tags: newTags });
    if (photosKey && photos.length > 0) {
      setQueryData(photosKey, photos.map((p: any) => (p.id === photo.id ? { ...p, tags: newTags } : p)));
      invalidateQueries('tags@');
    }
  };

  const handleNoteSaved = async (newNote: any) => {
    try {
      await api.http.put(`/api/photos/${photo.id}`, { caption: newNote });
      setPhoto({ ...photo, caption: newNote });
      if (photosKey && photos.length > 0) {
        setQueryData(photosKey, photos.map((p: any) => (p.id === photo.id ? { ...p, caption: newNote } : p)));
      }
    } catch (e) {
      console.error('Failed saving note', (e as Error)?.message || e);
    }
  };

  const toggleLike = async () => {
    const next = photo?.rating === 1 ? 0 : 1;
    try {
      await api.http.put(`/api/photos/${photo.id}`, { rating: next });
      setPhoto((prev: any) => ({ ...prev, rating: next }));
      if (photosKey && photos.length > 0) {
        setQueryData(photosKey, photos.map((p: any) => (p.id === photo.id ? { ...p, rating: next } : p)));
      }
      invalidateQueries('favorites@');
    } catch (e) {
      console.error('Failed toggling like', (e as Error)?.message || e);
    }
  };

  const isLiked = photo?.rating === 1;

  // Digital: load albums containing this photo for the "所属相册" chips.
  useEffect(() => {
    if (!isDigital || !photo?.id) {
      setAlbumsForPhoto([]);
      return;
    }
    let cancelled = false;
    api.http.get('/api/albums', { photo_id: photo.id })
      .then((res: any) => {
        if (cancelled) return;
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        setAlbumsForPhoto(list);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [isDigital, photo?.id]);

  const handleAddToAlbum = () => setAlbumPickerVisible(true);

  const handlePickerSelect = async (albumId: number, album: AlbumPickerAlbum) => {
    const targetPhotoId = photo?.id;
    if (!targetPhotoId) return;
    setAlbumPickerVisible(false);
    setBusy(true);
    try {
      await api.http.post(`/api/albums/${albumId}/photos`, { photo_ids: [targetPhotoId] });
      invalidateQueries(`digitalAlbums@`);
      invalidateQueries(`digitalAlbumPhotos@${baseUrl}.${albumId}`);
      // Refresh chips so the newly-added album appears immediately — but only
      // if the user is still on the same photo (they may have swiped during
      // the POST).
      try {
        const res: any = await api.http.get('/api/albums', { photo_id: targetPhotoId });
        if (photoRef.current?.id === targetPhotoId) {
          const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
          setAlbumsForPhoto(list);
        }
      } catch { /* best-effort */ }
      setSnack({ visible: true, msg: t('digital.photoView.addedToAlbum', { name: album?.title ?? '' }) });
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePhoto = () => {
    if (!photo?.id) return;
    Alert.alert(
      t('digital.photoView.deleteConfirmTitle'),
      t('digital.photoView.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!photo?.id) return;
            setBusy(true);
            try {
              await api.photos.delete(photo.id);
              invalidateQueries(`digitalPhotos@`);
              invalidateQueries(`digitalPhotosAggregate@`);
              invalidateQueries(`digitalAlbumPhotos@`);
              invalidateQueries(`digitalAlbums@`);
              setSnack({ visible: true, msg: t('digital.photoView.movedToTrash') });
              setTimeout(() => navigation.goBack(), 1200);
            } catch {
              /* surfaced via ApiErrorSnackbar */
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const requestPermissionsIfNeeded = async () => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      const mediaPerm = await MediaLibrary.getPermissionsAsync();
      if (!mediaPerm.granted) {
        const req = await MediaLibrary.requestPermissionsAsync();
        if (!req.granted) throw new Error('MediaLibrary permission denied');
      }
    }
  };

  const downloadPhoto = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(`${baseUrl}/api/photos/${photo.id}/download-with-exif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const blob = await response.blob();
      const fileName = `film_${photo.frame_number || photo.id}_${Date.now()}.jpg`;

      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = ((reader.result as any) as string).split(',')[1];
          const targetUri = FileSystem.documentDirectory + fileName;
          await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: 'base64' });
          await requestPermissionsIfNeeded();
          await MediaLibrary.saveToLibraryAsync(targetUri);
          try {
            await FileSystem.deleteAsync(targetUri, { idempotent: true });
          } catch (_) {}
          setSnack({ visible: true, msg: t('photo.saved', { name: fileName }) });
        } catch (saveErr) {
          setSnack({ visible: true, msg: t('photo.saveFailed', { message: (saveErr as Error).message }) });
        } finally {
          setDownloading(false);
        }
      };
      reader.onerror = () => {
        setSnack({ visible: true, msg: t('photo.processFailed') });
        setDownloading(false);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      setSnack({ visible: true, msg: (e as Error).message || t('photo.downloadError') });
      setDownloading(false);
    }
  };

  const header = () => (
    <View style={styles.headerRow} pointerEvents="box-none">
      {anyNegatives && !isDigital && (
        <TouchableOpacity
          style={styles.ctrlBtn}
          onPress={() => setViewMode((prev: any) => (prev === 'negative' ? 'positive' : 'negative'))}
        >
          <Icon name={viewMode === 'negative' ? 'palette' : 'contrast'} size={26} color="#fff" />
        </TouchableOpacity>
      )}
      {isDigital && (
        <TouchableOpacity
          style={styles.ctrlBtn}
          onPress={handleAddToAlbum}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('digital.photoView.addToAlbum')}
        >
          <Icon name="folder-plus" size={26} color="#fff" />
        </TouchableOpacity>
      )}
      {isDigital && (
        <TouchableOpacity
          style={styles.ctrlBtn}
          onPress={handleDeletePhoto}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('digital.photoView.deletePhoto')}
        >
          <Icon name="trash-2" size={26} color="#ff9e9e" />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.ctrlBtn} onPress={downloadPhoto}>
        <Icon name={downloading ? 'loader' : 'download'} size={26} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.ctrlBtn} onPress={toggleLike}>
        <Icon
          name="heart"
          size={26}
          color={isLiked ? '#ff9e9e' : '#fff'}
          fill={isLiked ? '#ff9e9e' : 'transparent'}
        />
      </TouchableOpacity>
      <TouchableOpacity style={styles.ctrlBtn} onPress={() => setNoteModalVisible(true)}>
        <Icon name="file-text" size={26} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.ctrlBtn} onPress={() => setTagModalVisible(true)}>
        <Icon name="tags" size={26} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.ctrlBtn}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Icon name="x" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  const exifSummary = useMemo(() => {
    if (!photo) return '';
    const parts: string[] = [];
    if (photo.camera) parts.push(photo.camera);
    if (photo.lens) parts.push(photo.lens);
    if (photo.focal_length != null && photo.focal_length !== '') parts.push(`${photo.focal_length}mm`);
    if (photo.aperture != null && photo.aperture !== '') parts.push(`f/${photo.aperture}`);
    if (photo.shutter_speed) parts.push(`${photo.shutter_speed}s`);
    if (photo.iso != null && photo.iso !== '') parts.push(`ISO ${photo.iso}`);
    return parts.join(' · ');
  }, [photo]);

  const dateTakenText = useMemo(() => {
    if (!photo?.date_taken) return '';
    const d = new Date(photo.date_taken);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }, [photo?.date_taken]);

  const gpsText = useMemo(() => {
    if (photo?.latitude == null || photo?.longitude == null) return '';
    return `${Number(photo.latitude).toFixed(6)}, ${Number(photo.longitude).toFixed(6)}`;
  }, [photo?.latitude, photo?.longitude]);

  const footer = () => (
    <View style={styles.footerContainer} pointerEvents="box-none">
      {photo?.caption ? (
        <View style={styles.noteOverlayBg}>
          <View style={styles.noteOverlayInner}>
            <Text style={styles.noteText}>{photo.caption}</Text>
          </View>
        </View>
      ) : null}
      {photo?.tags && photo.tags.length > 0 ? (
        <View style={styles.tagsOverlayBg}>
          <View style={styles.tagsOverlayInner}>
            {photo.tags.map((tg: any, i: any) => (
              <Chip key={i} style={styles.tagChip} textStyle={{ fontSize: 11 }}>
                {typeof tg === 'object' ? tg.name : tg}
              </Chip>
            ))}
          </View>
        </View>
      ) : null}
      {isDigital && (
        <View style={styles.digitalInfoBg}>
          <TouchableOpacity
            style={styles.digitalInfoToggle}
            onPress={() => setInfoExpanded((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="info" size={16} color="#fff" />
            <Text style={styles.digitalInfoToggleLabel} numberOfLines={1}>
              {exifSummary || t('digital.exif.title')}
            </Text>
            <Icon name={infoExpanded ? 'chevron-down' : 'chevron-up'} size={18} color="#fff" />
          </TouchableOpacity>
          {infoExpanded && (
            <View style={styles.digitalInfoBody}>
              {exifSummary ? (
                <Text style={styles.digitalInfoLine}>{exifSummary}</Text>
              ) : null}
              {dateTakenText ? (
                <Text style={styles.digitalInfoLine}>{dateTakenText}</Text>
              ) : null}
              {gpsText ? (
                <Text style={styles.digitalInfoLine}>📍 {gpsText}</Text>
              ) : null}
              <TouchableOpacity
                style={styles.viewExifLink}
                onPress={() => setExifSheetVisible(true)}
                hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
              >
                <Text style={styles.viewExifLinkText}>
                  {t('digital.photoView.viewExif')}
                </Text>
                <Icon name="chevron-right" size={14} color="#9bd6ff" />
              </TouchableOpacity>
              {albumsForPhoto.length > 0 && (
                <View style={styles.albumChipsRow}>
                  <Text style={styles.albumChipsTitle}>
                    {t('digital.albumsInTitle')}
                  </Text>
                  <View style={styles.albumChipsInner}>
                    {albumsForPhoto.map((album) => (
                      <Chip
                        key={album.id}
                        style={styles.albumChip}
                        textStyle={styles.albumChipText}
                        onPress={() =>
                          navigation.navigate('DigitalAlbumDetail', {
                            id: album.id,
                            title: album.title,
                          })
                        }
                      >
                        {album.title}
                      </Chip>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );

  overlayRenderRef.current = { header, footer };

  return (
    <View style={styles.container}>
      <ImageView
        images={images}
        imageIndex={startIndex}
        visible={true}
        onRequestClose={() => navigation.goBack()}
        onImageIndexChange={(i) => {
          if (busy) return;
          if (typeof i === 'number' && photos[i]) {
            setIndex(i);
            setPhoto(photos[i]);
          }
        }}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        backgroundColor="black"
        HeaderComponent={HeaderComponent}
        FooterComponent={FooterComponent}
      />

      <TagEditModal
        visible={tagModalVisible}
        onDismiss={() => setTagModalVisible(false)}
        photo={photo}
        onSave={handleTagsSaved}
      />

      <NoteEditModal
        visible={noteModalVisible}
        initialValue={photo.caption || ''}
        onCancel={() => setNoteModalVisible(false)}
        onSave={(val) => { setNoteModalVisible(false); handleNoteSaved(val); }}
      />
      <AlbumPickerSheet
        visible={albumPickerVisible}
        onDismiss={() => setAlbumPickerVisible(false)}
        onSelect={handlePickerSelect}
      />
      <ExifSheet
        visible={exifSheetVisible}
        onDismiss={() => setExifSheetVisible(false)}
        photo={photo}
      />
      <Snackbar
        visible={snack.visible}
        onDismiss={() => setSnack({ visible: false, msg: '' })}
        duration={3000}
      >{snack.msg}</Snackbar>
      {busy && (
        <View style={styles.busyOverlay} pointerEvents="box-none">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRow: {
    position: 'absolute',
    top: 48,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  ctrlBtn: {
    marginHorizontal: 4,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
  },
  footerContainer: {
    width: '100%',
    paddingBottom: 24,
  },
  tagsOverlayBg: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 16,
    paddingTop: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tagsOverlayInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingBottom: 4,
  },
  tagChip: {
    margin: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  noteOverlayBg: {
    paddingHorizontal: spacing.md,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  noteOverlayInner: {
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    maxWidth: '90%',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  noteText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  digitalInfoBg: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 8,
  },
  digitalInfoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  digitalInfoToggleLabel: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  digitalInfoBody: {
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  },
  digitalInfoLine: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    lineHeight: 16,
  },
  viewExifLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  viewExifLinkText: {
    color: '#9bd6ff',
    fontSize: 13,
    fontWeight: '600',
  },
  albumChipsRow: {
    marginTop: 8,
  },
  albumChipsTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  albumChipsInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  albumChip: {
    margin: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  albumChipText: {
    color: '#fff',
    fontSize: 11,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
