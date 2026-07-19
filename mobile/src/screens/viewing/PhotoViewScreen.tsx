import React, { useContext, useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, Platform, TouchableOpacity } from 'react-native';
import { ApiContext } from '../../context/ApiContext';
import { Chip, Text, Snackbar } from 'react-native-paper';
import { Icon } from '../../components/ui';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Image as ExpoImage } from 'expo-image';
import ImageView from 'react-native-image-viewing';
import TagEditModal from '../../components/TagEditModal';
import NoteEditModal from '../../components/NoteEditModal';
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
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [snack, setSnack] = useState({ visible: false, msg: '' });
  const [downloading, setDownloading] = useState(false);

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
    const targets = [index - 1, index + 1]
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
      {anyNegatives && (
        <TouchableOpacity
          style={styles.ctrlBtn}
          onPress={() => setViewMode((prev: any) => (prev === 'negative' ? 'positive' : 'negative'))}
        >
          <Icon name={viewMode === 'negative' ? 'palette' : 'contrast'} size={26} color="#fff" />
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
    </View>
  );

  return (
    <View style={styles.container}>
      <ImageView
        images={images}
        imageIndex={index}
        visible={true}
        onRequestClose={() => navigation.goBack()}
        onImageIndexChange={(i) => {
          if (typeof i === 'number' && photos[i]) {
            setIndex(i);
            setPhoto(photos[i]);
          }
        }}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        backgroundColor="black"
        HeaderComponent={header}
        FooterComponent={footer}
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
      <Snackbar
        visible={snack.visible}
        onDismiss={() => setSnack({ visible: false, msg: '' })}
        duration={3000}
      >{snack.msg}</Snackbar>
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
});
