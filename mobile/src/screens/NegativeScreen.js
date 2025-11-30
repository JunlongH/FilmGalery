import React, { useContext, useEffect, useState, useCallback } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Dimensions } from 'react-native';
import { ApiContext } from '../context/ApiContext';
import { Text, Chip, useTheme } from 'react-native-paper';
import TouchScale from '../components/TouchScale';
import CachedImage from '../components/CachedImage';
import axios from 'axios';
import { colors, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');
const ITEM_SIZE = Math.floor((width - spacing.lg * 2 - spacing.sm * 3) / 4); // 4 columns

export default function NegativeScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedFilm, setSelectedFilm] = useState(null); // film filter

  const fetchNegatives = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${baseUrl}/api/photos/negatives`);
      setPhotos(Array.isArray(res.data) ? res.data : []);
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
    photos.forEach(p => {
      const filmName = p.film_name || p.film_type || 'Unknown';
      map.set(filmName, (map.get(filmName) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a,b)=> b[1]-a[1]);
  }, [photos]);

  const filtered = selectedFilm ? photos.filter(p => (p.film_name || p.film_type || 'Unknown') === selectedFilm) : photos;

  const renderItem = ({ item }) => {
    const basePath = item.negative_rel_path || item.full_rel_path || item.thumb_rel_path;
    const imgUrl = basePath ? `${baseUrl}/uploads/${basePath}` : null;
    return (
      <TouchScale onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id })}>
        <View style={styles.gridItem}>
          <CachedImage uri={imgUrl} style={styles.image} contentFit="cover" />
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
