import React, { useContext, useMemo, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, Dimensions, Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { Text, Chip, useTheme } from 'react-native-paper';
import TouchScale from '../../components/TouchScale';
import CachedImage from '../../components/CachedImage';
import SkeletonBox from '../../components/SkeletonBox';
import { api } from '../../api/client';
import { spacing, radius } from '../../theme';
import { useApiQuery } from '../../hooks/useApiQuery';

const { width } = Dimensions.get('window');
const ITEM_SIZE = Math.floor((width - spacing.lg * 2 - spacing.sm * 3) / 4); // 4 columns
const numColumns = 4;
const ROW_HEIGHT = ITEM_SIZE + spacing.sm;

export default function NegativeScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [selectedFilm, setSelectedFilm] = React.useState<any>(null); // film filter

  const photosKey = baseUrl ? `negatives@${baseUrl}` : null;
  const { data, error: queryError, loading, refreshing, refresh } = useApiQuery<any[]>(
    photosKey,
    async () => {
      const res = await api.http.get('/api/photos/negatives');
      return Array.isArray(res) ? res : [];
    },
  );
  const photos = useMemo(() => data ?? [], [data]);
  const error = photos.length === 0 && queryError ? 'Failed to load negatives' : null;

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );

  // Derive film list for filter chips
  const filmList = useMemo(() => {
    const map = new Map();
    photos.forEach((p: any) => {
      const filmName = p.film_name || p.film_type || 'Unknown';
      map.set(filmName, (map.get(filmName) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a,b)=> b[1]-a[1]);
  }, [photos]);

  const filtered = selectedFilm ? photos.filter((p: any) => (p.film_name || p.film_type || 'Unknown') === selectedFilm) : photos;

  const renderItem = ({ item, index }: any) => {
    // Prefer small thumbnails in the 4-column grid; negative/full are multi-MB scans
    const basePath = item.thumb_rel_path || item.positive_thumb_rel_path || item.negative_rel_path || item.full_rel_path;
    const imgUrl = basePath ? `${baseUrl}/uploads/${basePath}` : null;
    return (
      <TouchScale onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id, photosKey, initialIndex: index, viewMode: 'negative' })}>
        <View style={styles.gridItem}>
          <CachedImage uri={imgUrl || ""} style={styles.image} contentFit="cover" />
          <View style={styles.metaOverlay}>
            <Text numberOfLines={1} style={styles.metaText}>{item.frame_number || item.id}</Text>
          </View>
        </View>
      </TouchScale>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {error && <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text>}
      <View style={styles.filterBar}>
        <Chip selected={!selectedFilm} onPress={() => setSelectedFilm(null)} style={styles.chip}>All</Chip>
        {filmList.map(([film, count]) => (
          <Chip key={film} selected={selectedFilm === film} onPress={() => setSelectedFilm(film)} style={styles.chip}>{film}</Chip>
        ))}
      </View>
      {loading && photos.length === 0 ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 16 }).map((_, i) => (
            <SkeletonBox key={i} width={ITEM_SIZE} height={ITEM_SIZE} style={styles.skeletonTile} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id.toString()}
          numColumns={numColumns}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[theme.colors.primary]} />}
          initialNumToRender={16}
          windowSize={7}
          maxToRenderPerBatch={16}
          removeClippedSubviews={true}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * Math.floor(index / numColumns),
            index,
          })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  error: { padding: spacing.md, textAlign: 'center' },
  filterBar: { flexDirection: 'row', flexWrap:'wrap', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  chip: { marginRight: spacing.xs, marginBottom: spacing.xs },
  grid: { padding: spacing.md },
  gridItem: { width: ITEM_SIZE, height: ITEM_SIZE, margin: spacing.sm/2, borderRadius: radius.sm, overflow:'hidden', backgroundColor: '#111' },
  image: { width: '100%', height: '100%' },
  metaOverlay: { position:'absolute', left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.35)', paddingVertical:2 },
  metaText: { color:'#fff', fontSize:10, textAlign:'center' },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.md },
  skeletonTile: { margin: spacing.sm/2, borderRadius: radius.sm },
});
