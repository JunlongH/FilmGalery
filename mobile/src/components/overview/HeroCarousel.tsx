import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { parseLocalDate } from '../../utils/date';
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
  const indexRef = useRef(0);

  const items = useMemo(() => (Array.isArray(photos) ? photos.slice(0, 8) : []), [photos]);

  // Pad one clone on each end so autoplay forward past the last slide (and a
  // backward swipe past the first) snap back invisibly — a seamless loop
  // instead of a jarring full backward scroll.
  const loopData = useMemo(() => {
    if (items.length <= 1) return items;
    return [items[items.length - 1], ...items, items[0]];
  }, [items]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    if (index > items.length - 1) setIndex(0);
  }, [items.length, index]);

  // Anchor the FlatList at the real current item whenever the data set
  // (re)loads. `index+1` accounts for the leading pad clone.
  useLayoutEffect(() => {
    if (items.length > 1) {
      const pos = Math.min(indexRef.current + 1, loopData.length - 1);
      flatListRef.current?.scrollToIndex({ index: pos, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => {
    if (!active || paused || items.length <= 1) return;
    const timer = setInterval(() => {
      const next = (indexRef.current + 1) % items.length;
      setIndex(next);
      indexRef.current = next;
      flatListRef.current?.scrollToIndex({ index: next + 1, animated: true });
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
      if (items.length <= 1) return;
      const pos = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      if (pos === 0) {
        // Landed on the leading clone (copy of the last real item).
        flatListRef.current?.scrollToIndex({ index: items.length, animated: false });
        setIndex(items.length - 1);
        indexRef.current = items.length - 1;
      } else if (pos === loopData.length - 1) {
        // Landed on the trailing clone (copy of the first real item).
        flatListRef.current?.scrollToIndex({ index: 1, animated: false });
        setIndex(0);
        indexRef.current = 0;
      } else {
        setIndex(pos - 1);
        indexRef.current = pos - 1;
      }
      pauseAutoplay();
    },
    [items, loopData.length, pauseAutoplay],
  );

  const onPhotoPress = useCallback(
    (photo: any, loopIdx: number) => {
      pauseAutoplay();
      const realIdx = items.length > 1 ? Math.max(0, Math.min(loopIdx - 1, items.length - 1)) : 0;
      navigation.navigate('PhotoView', {
        photo,
        photosKey: photosKey ?? undefined,
        initialIndex: realIdx,
        viewMode: 'positive',
      });
    },
    [navigation, pauseAutoplay, photosKey, items.length],
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
      ? photo.caption || ''
      : photo.roll_title ||
        photo.caption ||
        (photo.original_filename && photo.original_filename.replace(/\.[^.]+$/, '')) ||
        '';
    const dateStr = photo.date_taken || photo.date || photo.taken_at || photo.created_at;
    const parsedDate = dateStr ? parseLocalDate(dateStr) : null;
    const dateLabel = parsedDate
      ? parsedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const metaParts = [
      dateLabel,
      photo.city,
      photo.album_names,
      photo.camera_name,
      photo.lens_name,
      photo.film_name,
    ].filter(Boolean);
    const aperture = photo.aperture;
    const shutter = photo.shutter_speed;
    const iso = photo.iso || photo.roll_iso || photo.film_iso;
    const exposureParts: string[] = [];
    if (aperture) exposureParts.push(`ƒ/${aperture}`);
    if (shutter) exposureParts.push(shutter);
    if (iso) exposureParts.push(`ISO ${iso}`);
    const exposure = aperture || shutter ? exposureParts.join(' · ') : '';
    return { title, meta: metaParts.join(' · '), exposure };
  };

  return (
    <View style={styles.wrapper}>
      <FlatList
        ref={flatListRef as any}
        data={loopData}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        initialScrollIndex={items.length > 1 ? 1 : 0}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index: i }) => {
          const { title, meta, exposure } = renderInfo(item);
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
                  {exposure ? (
                    <Text style={styles.exposure} numberOfLines={1}>
                      {exposure}
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
  exposure: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 2,
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
