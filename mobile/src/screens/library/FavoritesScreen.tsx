import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions, Animated } from 'react-native';
import CachedImage from '../../components/CachedImage';
import SkeletonBox from '../../components/SkeletonBox';
import { spacing, radius } from '../../theme';
import { Text, useTheme } from 'react-native-paper';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useFocusEffect } from '@react-navigation/native';
import { getPhotoUrl } from '../../utils/urls';
import { Icon } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
// compute tile size accounting for horizontal padding and small gaps so items don't touch the right edge
const tileSize = Math.floor((screenWidth - (spacing.md * 2) - (numColumns * 4)) / numColumns);
const ROW_HEIGHT = tileSize + 4; // tile + 2*margin(2)

export default function FavoritesScreen({ navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);

  const photosKey = baseUrl ? `favorites@${baseUrl}` : null;
  const { data, loading, refresh } = useApiQuery<any[]>(
    photosKey,
    () => api.http.get('/api/photos/favorites'),
  );
  const photos = useMemo(() => data ?? [], [data]);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Animate on focus (data stays warm in the query cache; no refetch needed)
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, [])
  );

  // Header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={refresh}
          style={{ marginRight: 16, padding: 8 }}
        >
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      )
    });
  }, [navigation, theme, refresh]);

  const renderItem = ({ item, index }: any) => {
    const thumbUrl = getPhotoUrl(baseUrl, item, 'thumb');

    const showHeart = item.rating === 1;
    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <TouchableOpacity
          onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id, photosKey, initialIndex: index, viewMode: 'positive' })}
          style={styles.thumbWrapper}
          activeOpacity={0.8}
        >
          <View style={[styles.thumbInner, { width: tileSize, height: tileSize, backgroundColor: theme.colors.surfaceVariant }]}>
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
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonBox key={i} width={tileSize} height={tileSize} style={styles.skeletonTile} />
          ))}
        </View>
      ) : photos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="heart" size={64} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
            暂无收藏
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
            将照片加入收藏后会显示在这里
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.countBar, { borderBottomColor: theme.colors.outlineVariant }]}>
            <Text style={[styles.countText, { color: theme.colors.onSurfaceVariant }]}>
              {photos.length} 张收藏
            </Text>
          </View>
          <FlatList
            data={photos}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            numColumns={numColumns}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
            windowSize={7}
            maxToRenderPerBatch={12}
            removeClippedSubviews={true}
            getItemLayout={(_, index) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * Math.floor(index / numColumns),
              index,
            })}
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
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  skeletonTile: {
    margin: 2,
    borderRadius: radius.md,
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
