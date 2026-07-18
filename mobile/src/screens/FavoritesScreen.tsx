import React, { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions, Animated } from 'react-native';
import CachedImage from '../components/CachedImage';
import { colors, spacing, radius } from '../theme';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { ApiContext } from '../context/ApiContext';
import { api } from '../api/client';
import { useFocusEffect } from '@react-navigation/native';
import { getPhotoUrl } from '../utils/urls';
import { Icon } from '../components/ui';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
// compute tile size accounting for horizontal padding and small gaps so items don't touch the right edge
const tileSize = Math.floor((screenWidth - (spacing.md * 2) - (numColumns * 4)) / numColumns);

export default function FavoritesScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fetchFavorites = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await api.http.get('/api/photos/favorites');
      setPhotos(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFavorites();
  }, [baseUrl]);

  // Animate on focus
  useFocusEffect(
    useCallback(() => {
      fetchFavorites();
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, [baseUrl])
  );

  // Header refresh button with new Icon
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity 
          onPress={async () => { 
            const { clearImageCache } = await import('../components/CachedImage'); 
            await clearImageCache(); 
            fetchFavorites(); 
          }}
          style={{ marginRight: 16, padding: 8 }}
        >
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      )
    });
  }, [navigation, baseUrl, theme]);

  const renderItem = ({ item, index }: any) => {
    const thumbUrl = getPhotoUrl(baseUrl, item, 'thumb');
    
    const showHeart = item.rating === 1;
    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <TouchableOpacity
          onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id, photos, initialIndex: index, viewMode: 'positive' })}
          style={styles.thumbWrapper}
          activeOpacity={0.8}
        >
          <View style={[styles.thumbInner, { width: tileSize, height: tileSize }]}>
            <CachedImage
              uri={thumbUrl || ""}
              style={styles.thumbImage}
              contentFit="cover"
            />
            {showHeart && (
              <View style={styles.heartBadge}>
                <Icon name="heart" size={14} color="#E53935" />
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {loading && photos.length === 0 ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator animating={true} size="large" color={theme.colors.primary} />
          <Text style={[styles.loaderText, { color: theme.colors.onSurfaceVariant }]}>
            Loading favorites...
          </Text>
        </View>
      ) : photos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="heart" size={64} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
            No favorites yet
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
            Add photos to your favorites to see them here
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.countBar}>
            <Text style={[styles.countText, { color: theme.colors.onSurfaceVariant }]}>
              {photos.length} {photos.length === 1 ? 'favorite' : 'favorites'}
            </Text>
          </View>
          <FlatList
            data={photos}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            numColumns={numColumns}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600' as const,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  countBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  countText: {
    fontSize: 13,
  },
  listContent: { 
    paddingBottom: spacing.lg, 
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  thumbWrapper: { 
    margin: 2,
  },
  thumbInner: { 
    position: 'relative', 
    borderRadius: radius.md, 
    overflow: 'hidden', 
    backgroundColor: colors.surfaceVariant,
  },
  thumbImage: { 
    width: '100%', 
    height: '100%',
  },
  heartBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
