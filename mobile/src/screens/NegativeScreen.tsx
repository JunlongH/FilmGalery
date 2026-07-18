import React, { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Dimensions, Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ApiContext } from '../context/ApiContext';
import { Text, Chip, useTheme } from 'react-native-paper';
import { Icon } from '../components/ui';
import TouchScale from '../components/TouchScale';
import CachedImage from '../components/CachedImage';
import { api } from '../api/client';
import { colors, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');
const ITEM_SIZE = Math.floor((width - spacing.lg * 2 - spacing.sm * 3) / 4); // 4 columns

export default function NegativeScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [selectedFilm, setSelectedFilm] = useState<any>(null); // film filter
  
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

  const fetchNegatives = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.http.get('/api/photos/negatives');
      setPhotos(Array.isArray(res) ? res : []);
    } catch (e) {
      setError('Failed to load negatives');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => { fetchNegatives(); }, [fetchNegatives]);

  // Derive film list for filter chips
  const filmList = React.useMemo(() => {
    const map = new Map();
    photos.forEach((p: any) => {
      const filmName = p.film_name || p.film_type || 'Unknown';
      map.set(filmName, (map.get(filmName) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a,b)=> b[1]-a[1]);
  }, [photos]);

  const filtered = selectedFilm ? photos.filter((p: any) => (p.film_name || p.film_type || 'Unknown') === selectedFilm) : photos;

  const renderItem = ({ item }: any) => {
    const basePath = item.negative_rel_path || item.full_rel_path || item.thumb_rel_path;
    const imgUrl = basePath ? `${baseUrl}/uploads/${basePath}` : null;
    return (
      <TouchScale onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id })}>
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
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.filterBar}>
        <Chip selected={!selectedFilm} onPress={() => setSelectedFilm(null)} style={styles.chip}>All</Chip>
        {filmList.map(([film, count]) => (
          <Chip key={film} selected={selectedFilm === film} onPress={() => setSelectedFilm(film)} style={styles.chip}>{film}</Chip>
        ))}
      </View>
      {loading && photos.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id.toString()}
          numColumns={4}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchNegatives} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  error: { padding: spacing.md, textAlign: 'center', color: '#c62828' },
  filterBar: { flexDirection: 'row', flexWrap:'wrap', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  chip: { marginRight: spacing.xs, marginBottom: spacing.xs },
  grid: { padding: spacing.md },
  gridItem: { width: ITEM_SIZE, height: ITEM_SIZE, margin: spacing.sm/2, borderRadius: radius.sm, overflow:'hidden', backgroundColor: '#111' },
  image: { width: '100%', height: '100%' },
  metaOverlay: { position:'absolute', left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.35)', paddingVertical:2 },
  metaText: { color:'#fff', fontSize:10, textAlign:'center' }
});
