import React, { useContext, useState } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, Platform } from 'react-native';
import { ApiContext } from '../context/ApiContext';
import { IconButton, Chip, Text, Snackbar } from 'react-native-paper';
// Removed direct legacy FileSystem usage (downloadAsync deprecated).
// Use unified helper built on new File/Directory API.
import { downloadImageAsync } from '../utils/fileSystem';
import * as MediaLibrary from 'expo-media-library';
import TagEditModal from '../components/TagEditModal';
import NoteEditModal from '../components/NoteEditModal';
import axios from 'axios';
import ImageViewer from 'react-native-image-zoom-viewer';
import CachedImage from '../components/CachedImage';
import { colors, spacing, radius } from '../theme';
import { getPhotoUrl } from '../utils/urls';

const { width, height } = Dimensions.get('window');

export default function PhotoViewScreen({ route, navigation }) {
  const { photo: initialPhoto, rollId, viewMode: initialViewMode = 'positive', photos = [], initialIndex = 0 } = route.params;
  const { baseUrl } = useContext(ApiContext);
  const [photo, setPhoto] = useState(initialPhoto);
  const [index, setIndex] = useState(initialIndex);
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [snack, setSnack] = useState({ visible:false, msg:'' });
  const [downloading, setDownloading] = useState(false);

  const fullUrl = getPhotoUrl(baseUrl, photo, viewMode === 'negative' ? 'negative' : 'full');

  const handleTagsSaved = (newTags) => {
    setPhoto({ ...photo, tags: newTags });
  };

  const handleNoteSaved = async (newNote) => {
    try {
      await axios.put(`${baseUrl}/api/photos/${photo.id}`, { caption: newNote });
      setPhoto({ ...photo, caption: newNote });
    } catch (e) {
      console.error('Failed saving note', e?.message || e);
    }
  };

  const toggleLike = async () => {
    const next = photo?.rating === 1 ? 0 : 1;
    try {
      await axios.put(`${baseUrl}/api/photos/${photo.id}`, { rating: next });
      setPhoto(prev => ({ ...prev, rating: next }));
    } catch (e) {
      console.error('Failed toggling like', e?.message || e);
    }
  };

  const isLiked = photo?.rating === 1;

  const images = (photos && photos.length > 0)
    ? photos.map(p => ({ url: getPhotoUrl(baseUrl, p, viewMode === 'negative' && p.negative_rel_path ? 'negative' : 'full') }))
    : [{ url: fullUrl }];

  const anyNegatives = Array.isArray(photos) && photos.some(p => p.negative_rel_path);

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
    if (!fullUrl || downloading) return;
    setDownloading(true);
    try {
      const fileName = `film_${photo.id || Date.now()}.jpg`;
      const localUri = await downloadImageAsync(fullUrl, { fileName, saveToLibrary: true });
      setSnack({ visible:true, msg:`Saved: ${fileName}` });
    } catch (e) {
      setSnack({ visible:true, msg: e.message || 'Download error' });
    } finally {
      setDownloading(false);
    }
  };

  const renderFooter = (currentIndex) => (
    <View style={styles.footerContainer} pointerEvents="box-none">
      {/* Note Overlay */}
      {photo.caption ? (
        <View style={styles.noteOverlayBg}>
          <View style={styles.noteOverlayInner}>
            <Text style={styles.noteText}>{photo.caption}</Text>
          </View>
        </View>
      ) : null}

      {/* Tags Overlay */}
      {photo.tags && photo.tags.length > 0 ? (
        <View style={styles.tagsOverlayBg}>
          <View style={styles.tagsOverlayInner}>
            {photo.tags.map((t, i) => (
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
        renderIndicator={() => null}
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
          <IconButton
            icon={viewMode === 'negative' ? 'invert-colors' : 'invert-colors-off'}
            iconColor="#fff"
            size={28}
            style={styles.modeBtn}
            onPress={() => setViewMode(prev => (prev === 'negative' ? 'positive' : 'negative'))}
          />
        )}
        <IconButton
          icon={isLiked ? 'heart' : 'heart-outline'}
          iconColor={isLiked ? '#ff9e9e' : '#fff'}
          size={28}
          style={styles.likeBtn}
          onPress={toggleLike}
        />

        <IconButton
          icon="note-text"
          iconColor="#fff"
          size={28}
          style={styles.noteBtn}
          onPress={() => setNoteModalVisible(true)}
        />

        <IconButton
          icon="tag-multiple"
          iconColor="#fff"
          size={30}
          style={styles.tagBtn}
          onPress={() => setTagModalVisible(true)}
        />

        <IconButton
          icon={downloading ? 'progress-download' : 'download'}
          iconColor="#fff"
          size={30}
          style={styles.downloadBtn}
          onPress={downloadPhoto}
        />

        <IconButton
          icon="close"
          iconColor="#fff"
          size={30}
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
        />
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
    paddingBottom: 32,
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

