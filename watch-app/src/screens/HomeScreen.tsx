import React, { useEffect, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, State } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../services/api';
import { Photo } from '../types';
import type { RootStackParamList } from '../types/navigation';
import { imageCache } from '../utils/imageCache';

const { width, height } = Dimensions.get('window');

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageState, setImageState] = useState<'thumb' | 'full'>('thumb');
  const [fullImageLoaded, setFullImageLoaded] = useState(false);

  const fetchRandomPhotos = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.getRandomPhotos(5);
      if (result.length > 0) {
        setPhotos(result);
        setCurrentIndex(0);
        setImageState('thumb');
        setFullImageLoaded(false);
        
        // 预加载所有缩略图
        const thumbUrls = result
          .map(p => api.getImageURL(p.thumb_rel_path || p.full_rel_path))
          .filter(url => url !== null) as string[];
        await imageCache.preloadBatch(thumbUrls);

        // 只预加载当前照片的原图
        const currentFullUrl = api.getImageURL(result[0].full_rel_path);
        if (currentFullUrl && !imageCache.has(currentFullUrl)) {
          imageCache.preload(currentFullUrl).catch(err =>
            console.warn('Background full image preload failed:', err)
          );
        }
      } else {
        setError('No photos available');
      }
    } catch (err: any) {
      console.error('Failed to fetch photo:', err);
      setError(err.message || 'Failed to load photo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRandomPhotos();
  }, []);

  // 当切换照片时，重置图片加载状态并预加载下一张
  useEffect(() => {
    if (photos.length === 0) return;

    setImageState('thumb');
    setFullImageLoaded(false);

    // 只预加载下一张的原图
    const nextIndex = (currentIndex + 1) % photos.length;
    const nextPhoto = photos[nextIndex];
    const nextUrl = api.getImageURL(nextPhoto?.full_rel_path);

    if (nextUrl && !imageCache.has(nextUrl)) {
      imageCache.preload(nextUrl).catch(err =>
        console.warn('Failed to preload next image:', err)
      );
    }
  }, [currentIndex, photos]);

  const onGestureEvent = (event: any) => {
    const { state, translationY, translationX } = event.nativeEvent;

    if (state === State.END) {
      const isHorizontal = Math.abs(translationX) > Math.abs(translationY);

      // Horizontal swipe: cycle photos left/right
      if (isHorizontal && Math.abs(translationX) > 40 && photos.length > 0) {
        setCurrentIndex((prev) => {
          const next = translationX < 0 ? prev + 1 : prev - 1;
          const total = photos.length;
          return ((next % total) + total) % total; // wrap around
        });
        return;
      }

      // Vertical swipe: refresh or open menu
      if (translationY > 50) {
        fetchRandomPhotos();
      } else if (translationY < -50) {
        navigation.navigate('MainMenu');
      }
    }
  };

  // 获取当前照片的缩略图和原图URL
  const currentPhoto = photos[currentIndex];
  const thumbUrl = currentPhoto 
    ? api.getImageURL(currentPhoto.thumb_rel_path || currentPhoto.full_rel_path)
    : null;
  const fullUrl = currentPhoto
    ? api.getImageURL(currentPhoto.full_rel_path)
    : null;

  // 根据当前状态决定显示哪张图
  const displayUrl = imageState === 'full' && fullImageLoaded ? fullUrl : thumbUrl;

  return (
    <GestureHandlerRootView style={styles.container}>
      <PanGestureHandler onHandlerStateChange={onGestureEvent}>
        <View style={styles.content}>
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          )}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={fetchRandomPhotos} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {!loading && !error && displayUrl && (
            <>
              {/* 显示缩略图或原图 */}
              <Image
                source={{ uri: displayUrl }}
                style={styles.image}
                resizeMode="cover"
              />
              {/* 在后台加载原图 */}
              {fullUrl && fullUrl !== displayUrl && (
                <Image
                  source={{ uri: fullUrl }}
                  style={styles.hiddenImage}
                  resizeMode="cover"
                  onLoad={() => {
                    setFullImageLoaded(true);
                    setImageState('full');
                  }}
                  onError={(error) => {
                    console.warn('Failed to load full image:', error.nativeEvent.error);
                  }}
                />
              )}
              {/* 显示加载指示器当原图还在加载时 */}
              {imageState === 'thumb' && !fullImageLoaded && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              )}
            </>
          )}
          <View style={styles.hint}>
            <Text style={styles.hintText}>←/→ Photo  ↓ Refresh  ↑ Menu</Text>
          </View>
        </View>
      </PanGestureHandler>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: width,
    height: height,
    position: 'absolute',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  hint: {
    position: 'absolute',
    bottom: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  hintText: {
    color: '#fff',
    fontSize: 12,
  },
  hiddenImage: {
    width: 0,
    height: 0,
    position: 'absolute',
    opacity: 0,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 20,
  },
});

export default HomeScreen;
