import React, { useContext, useState, useEffect } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, Platform, TouchableOpacity } from 'react-native';
import { ApiContext } from '../context/ApiContext';
import { Chip, Text, Snackbar } from 'react-native-paper';
import { Icon } from '../components/ui';
// Removed direct legacy FileSystem usage (downloadAsync deprecated).
// Use unified helper built on new File/Directory API.
import { downloadImageAsync } from '../utils/fileSystem';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import TagEditModal from '../components/TagEditModal';
import NoteEditModal from '../components/NoteEditModal';
import { api } from '../api/client';
import ImageViewer from 'react-native-image-zoom-viewer';
import CachedImage from '../components/CachedImage';
import { colors, spacing, radius } from '../theme';
import { getPhotoUrl } from '../utils/urls';

const { width, height } = Dimensions.get('window');

export default function PhotoViewScreen({ route, navigation }: any) {
  const { photo: initialPhoto, photoId, rollId, viewMode: initialViewMode = 'positive', photos = [], initialIndex = 0 } = route.params || {};
  const { baseUrl } = useContext(ApiContext);
  const [photo, setPhoto] = useState(initialPhoto || null);
  const [loading, setLoading] = useState(!initialPhoto && !!photoId);
  const [index, setIndex] = useState(initialIndex);
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [snack, setSnack] = useState({ visible:false, msg:'' });
  const [downloading, setDownloading] = useState(false);

  // Fetch photo data if only photoId was provided
  useEffect(() => {
    if (!initialPhoto && photoId && baseUrl) {
      setLoading(true);
      api.http.get(`/api/photos/single/${photoId}`)
        .then(res => {
          setPhoto(res);
        })
        .catch(err => {
          console.error('Failed to fetch photo:', (err as Error).message);
          setSnack({ visible: true, msg: 'Failed to load photo' });
        })
        .finally(() => setLoading(false));
    }
  }, [initialPhoto, photoId, baseUrl]);

  // Show loading if fetching photo
  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 16, color: colors.textSecondary }}>Loading photo...</Text>
      </View>
    );
  }

  // Show error if no photo
  if (!photo) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Icon name="alert" size={48} color={colors.error} />
        <Text style={{ marginTop: 16, color: colors.textSecondary }}>Photo not found</Text>
      </View>
    );
  }

  const fullUrl = getPhotoUrl(baseUrl, photo, viewMode === 'negative' ? 'negative' : 'full');

  const handleTagsSaved = (newTags: any) => {
    setPhoto({ ...photo, tags: newTags });
  };

  const handleNoteSaved = async (newNote: any) => {
    try {
      await api.http.put(`/api/photos/${photo.id}`, { caption: newNote });
      setPhoto({ ...photo, caption: newNote });
    } catch (e) {
      console.error('Failed saving note', (e as Error)?.message || e);
    }
  };

  const toggleLike = async () => {
    const next = photo?.rating === 1 ? 0 : 1;
    try {
      await api.http.put(`/api/photos/${photo.id}`, { rating: next });
      setPhoto((prev: any) => ({ ...prev, rating: next }));
    } catch (e) {
      console.error('Failed toggling like', (e as Error)?.message || e);
    }
  };

  const isLiked = photo?.rating === 1;

  const images = (photos && photos.length > 0)
    ? photos.map((p: any) => ({ url: getPhotoUrl(baseUrl, p, viewMode === 'negative' && p.negative_rel_path ? 'negative' : 'full') }))
    : [{ url: fullUrl }];

  const anyNegatives = Array.isArray(photos) && photos.some((p: any) => p.negative_rel_path);

  const requestPermissionsIfNeeded = async () => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      // On Android 13+, avoid requesting AUDIO by using image-only save API and checking permissions
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
      // Call server endpoint that returns JPEG with embedded EXIF metadata
      const response = await fetch(`${baseUrl}/api/photos/${photo.id}/download-with-exif`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      const blob = await response.blob();
      const fileName = `film_${photo.frame_number || photo.id}_${Date.now()}.jpg`;
      
      // Convert blob to base64 for FileSystem
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = ((reader.result as any) as string).split(',')[1];
          const targetUri = FileSystem.documentDirectory + fileName;
          
          await FileSystem.writeAsStringAsync(targetUri, base64, {
            encoding: 'base64',
          });
          
          // Request permissions and save to photo library
          await requestPermissionsIfNeeded();
          await MediaLibrary.saveToLibraryAsync(targetUri);
          
          // Cleanup temp file
          try {
            await FileSystem.deleteAsync(targetUri, { idempotent: true });
          } catch (_) {}
          
          setSnack({ visible: true, msg: `Saved with metadata: ${fileName}` });
        } catch (saveErr) {
          setSnack({ visible: true, msg: `Save failed: ${(saveErr as Error).message}` });
        } finally {
          setDownloading(false);
        }
      };
      reader.onerror = () => {
        setSnack({ visible: true, msg: 'Failed to process image' });
        setDownloading(false);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      setSnack({ visible: true, msg: (e as Error).message || 'Download error' });
      setDownloading(false);
    }
  };

  const renderFooter = (currentIndex: any) => (
    <View style={styles.footerContainer} pointerEvents="box-none">
      {/* Note Overlay */}
      {photo?.caption ? (
        <View style={styles.noteOverlayBg}>
          <View style={styles.noteOverlayInner}>
            <Text style={styles.noteText}>{photo.caption}</Text>
          </View>
        </View>
      ) : null}

      {/* Tags Overlay */}
      {photo?.tags && photo.tags.length > 0 ? (
        <View style={styles.tagsOverlayBg}>
          <View style={styles.tagsOverlayInner}>
            {photo.tags.map((t: any, i: any) => (
              <Chip key={i} style={styles.tagChip} textStyle={{ fontSize: 11 }}>
                {typeof t === 'object' ? t.name : t}
              </Chip>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <ImageViewer
        imageUrls={images}
        index={index}
        onChange={(i) => {
          if (typeof i === 'number' && photos[i]) {
            setIndex(i);
            setPhoto(photos[i]);
          }
        }}
        renderIndicator={() => null as any}
        enableSwipeDown={true}
        onSwipeDown={() => navigation.goBack()}
        renderFooter={renderFooter}
        footerContainerStyle={{ bottom: 8, position: 'absolute', width: '100%', zIndex: 1 }}
        loadingRender={() => <ActivityIndicator size="large" color="#fff" />}
        saveToLocalByLongPress={false}
        backgroundColor="black"
        renderImage={(props) => (
          <CachedImage
            uri={props.source?.uri}
            style={props.style}
            contentFit="contain"
            transition={200}
          />
        )}
      />

      {/* Controls Layer - Absolute positioned on top of viewer */}
      <View style={styles.controlsLayer} pointerEvents="box-none">
        {anyNegatives && (
          <TouchableOpacity
            style={styles.modeBtn}
            onPress={() => setViewMode((prev: any) => (prev === 'negative' ? 'positive' : 'negative'))}
          >
            <Icon 
              name={viewMode === 'negative' ? 'palette' : 'contrast'} 
              size={28} 
              color="#fff" 
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.likeBtn}
          onPress={toggleLike}
        >
          <Icon 
            name={isLiked ? 'heart' : 'heart'} 
            size={28} 
            color={isLiked ? '#ff9e9e' : '#fff'} 
            fill={isLiked ? '#ff9e9e' : 'transparent'}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.noteBtn}
          onPress={() => setNoteModalVisible(true)}
        >
          <Icon name="file-text" size={28} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tagBtn}
          onPress={() => setTagModalVisible(true)}
        >
          <Icon name="tags" size={30} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.downloadBtn}
          onPress={downloadPhoto}
        >
          <Icon name={downloading ? 'loader' : 'download'} size={30} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
        >
          <Icon name="x" size={30} color="#fff" />
        </TouchableOpacity>
      </View>

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
        onDismiss={() => setSnack({ visible:false, msg:'' })}
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
  footerContainer: {
    width: '100%',
    paddingBottom: 24,
  },
  controlsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 100,
    zIndex: 999,
  },
  modeBtn: {
    position: 'absolute',
    top: 40,
    right: 270,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
  },
  closeBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
  },
  tagBtn: {
    position: 'absolute',
    top: 40,
    right: 70,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
  },
  noteBtn: {
    position: 'absolute',
    top: 40,
    right: 120,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
  },
  likeBtn: {
    position: 'absolute',
    top: 40,
    right: 170,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
  },
  downloadBtn: {
    position: 'absolute',
    top: 40,
    right: 220,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.sm,
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

