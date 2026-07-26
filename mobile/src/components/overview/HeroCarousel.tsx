import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  FlatList,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { AppMode } from '../../context/AppModeContext';
import { ApiContext } from '../../context/ApiContext';
import { getPhotoUrl } from '../../utils/urls';
import { useT } from '../../i18n';
import CachedImage from '../CachedImage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH * 0.62);
const AUTOPLAY_MS = 4000;
// After the user manually swipes / taps, autoplay resumes once this much time
// has elapsed without further interaction.
const AUTOPLAY_RESUME_MS = 8000;

export interface HeroCarouselProps {
  photos: any[];
  loading: boolean;
  active: boolean;
  mode: AppMode;
  photosKey?: string | null;
}

export default function HeroCarousel({ photos, loading, active, mode, photosKey }: HeroCarouselProps) {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<any>();
  const { baseUrl } = useContext(ApiContext);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const flatListRef = useRef<FlatList<any>>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const items = useMemo(() => (Array.isArray(photos) ? photos.slice(0, 8) : []), [photos]);

  useEffect(() => {
    if (index > items.length - 1) setIndex(0);
  }, [items.length, index]);

  useEffect(() => {
    if (!active || paused || items.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % items.length;
        flatListRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [active, paused, items.length]);

  // Pause autoplay on user interaction, then auto-resume after a short idle
  // window. Re-invoking pause resets the recovery timer so continued swipes
  // keep autoplay paused.
  const pauseAutoplay = useCallback(() => {
    setPaused(true);
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      setPaused(false);
      resumeTimerRef.current = null;
    }, AUTOPLAY_RESUME_MS);
  }, []);

  // Clear any pending resume timer on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      if (newIndex !== index) setIndex(newIndex);
      pauseAutoplay();
    },
    [index, pauseAutoplay],
  );

  const onPhotoPress = useCallback(
    (photo: any, i: number) => {
      pauseAutoplay();
      navigation.navigate('PhotoView', {
        photo,
        photosKey: photosKey ?? undefined,
        initialIndex: i,
        viewMode: 'positive',
      });
    },
    [navigation, pauseAutoplay, photosKey],
  );

  if (loading && items.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.surfaceVariant }]}>
        <ActivityIndicator animating size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (items.length === 0) return null;

  const renderInfo = (photo: any) => {
    const isDigital = mode === 'digital' || photo.source_type === 'digital' || photo.roll_id == null;
    const title = isDigital
      ? photo.caption || photo.original_filename || ''
      : photo.roll_title || photo.caption || '';
    const dateStr = photo.date_taken || photo.date || photo.taken_at || photo.created_at;
    const dateLabel = dateStr
      ? new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const metaParts = [dateLabel, photo.camera_name || photo.camera, photo.city, photo.film_name].filter(Boolean);
    return { title, meta: metaParts.join(' · ') };
  };

  return (
    <View style={styles.wrapper}>
      <FlatList
        ref={flatListRef as any}
        data={items}
        keyExtractor={(item, i) => String(item.id ?? i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index: i }) => {
          const { title, meta } = renderInfo(item);
          const uri = getPhotoUrl(baseUrl, item, 'full') ?? getPhotoUrl(baseUrl, item, 'thumb');
          return (
            <TouchableOpacity
              style={styles.slide}
              activeOpacity={0.92}
              onPress={() => onPhotoPress(item, i)}
              accessibilityLabel={`hero-photo-${i}`}
            >
              {uri ? (
                <CachedImage uri={uri} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.surfaceVariant }]} />
              )}
              <LinearGradient
                colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)']}
                locations={[0.45, 0.75, 1]}
                style={styles.gradient}
              >
                <View style={styles.captionBox}>
                  {title ? (
                    <Text style={styles.title} numberOfLines={2}>
                      {title}
                    </Text>
                  ) : null}
                  {meta ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
              </LinearGradient>
            </TouchableOpacity>
          );
        }}
      />
      {items.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {items.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index ? styles.dotActive : null]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    backgroundColor: '#000',
  },
  placeholder: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slide: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    position: 'relative',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'flex-end',
  },
  captionBox: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 24,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700' as const,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginBottom: 4,
  },
  meta: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  dots: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
    marginHorizontal: 3,
  },
  dotActive: {
    width: 18,
    backgroundColor: '#fff',
  },
});
