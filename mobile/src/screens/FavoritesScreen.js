import React, { useContext, useEffect, useState, useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import CachedImage from '../components/CachedImage';
import BadgeOverlay from '../components/BadgeOverlay';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { ApiContext } from '../context/ApiContext';
import axios from 'axios';
import { useFocusEffect } from '@react-navigation/native';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
// compute tile size accounting for horizontal padding and small gaps so items don't touch the right edge
const tileSize = Math.floor((screenWidth - (spacing.md * 2) - (numColumns * 2)) / numColumns);

export default function FavoritesScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFavorites = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await axios.get(`${baseUrl}/api/photos/favorites`);
      setPhotos(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFavorites();
  }, [baseUrl]);

  // Add header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <MaterialCommunityIcons name="refresh" size={24} color={colors.primary} onPress={async () => { const { clearImageCache } = await import('../components/CachedImage'); await clearImageCache(); fetchFavorites(); }} />
      )
    });
  }, [navigation, baseUrl]);

  useFocusEffect(
    useCallback(() => {
      fetchFavorites();
    }, [baseUrl])
  );

  const renderItem = ({ item, index }) => {
    let thumbUrl;
    if (item.thumb_rel_path) {
      thumbUrl = `${baseUrl}/uploads/${item.thumb_rel_path}`;
    } else {
      thumbUrl = `${baseUrl}/uploads/rolls/${item.roll_id}/thumb/${item.filename}`;
    }
    
    const showHeart = item.rating === 1;
    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id, photos, initialIndex: index, viewMode: 'positive' })}
        style={styles.thumbWrapper}
      >
          <BadgeOverlay style={{}} icon={showHeart ? 'heart' : null} text={showHeart ? null : ''} color={showHeart ? 'transparent' : undefined} textColor={showHeart ? colors.accent : undefined}>
            <View style={[styles.thumbInner, { width: tileSize, height: tileSize }] }>
              <CachedImage
                uri={thumbUrl}
                style={styles.thumbImage}
                contentFit="cover"
              />
            </View>
          </BadgeOverlay>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {loading ? (
        <ActivityIndicator animating={true} size="large" style={styles.loader} color="#5a4632" />
      ) : (
        <FlatList
          data={photos}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          numColumns={numColumns}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loader: { marginTop: 50 },
  listContent: { paddingBottom: spacing.lg, paddingHorizontal: spacing.md },
  thumbWrapper: { margin: 1 },
  thumbInner: { position: 'relative', borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceVariant },
  thumbImage: { width: '100%', height: '100%' },
  badge: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  badgeText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
});
