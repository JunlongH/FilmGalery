import React, { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, Dimensions, TouchableOpacity, Animated } from 'react-native';
import { ActivityIndicator, useTheme, Text } from 'react-native-paper';
import { ApiContext } from '../context/ApiContext';
import { api } from '../api/client';
import TagCard from '../components/TagCard';
import SkeletonBox from '../components/SkeletonBox';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../components/ui';
import { spacing, radius } from '../theme';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const cardWidth = (screenWidth - 32 - 12) / numColumns; // 32 padding, 12 gap

export default function ThemesScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fetchTags = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await api.http.get('/api/tags');
      // Filter out tags with 0 photos
      setTags(res.filter((t: any) => t.photos_count > 0));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, [baseUrl]);

  // Animate on focus
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

  // Header refresh button with new Icon
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity 
          onPress={async () => { 
            const { clearImageCache } = await import('../components/CachedImage'); 
            await clearImageCache(); 
            fetchTags(); 
          }}
          style={{ marginRight: 16, padding: 8 }}
        >
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      )
    });
  }, [navigation, baseUrl, theme]);

  const renderItem = ({ item }: any) => {
    let coverUrl = null;
    if (item.cover_thumb) {
      coverUrl = `${baseUrl}/uploads/${item.cover_thumb}`;
    } else if (item.cover_full) {
      coverUrl = `${baseUrl}/uploads/${item.cover_full}`;
    }
    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <TagCard
          coverUri={coverUrl}
          title={item.name}
          subtitle={`${item.photos_count} photos`}
          style={styles.cardContainer}
          onPress={() => navigation.navigate('TagDetail', { tagId: item.id, tagName: item.name })}
        />
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {loading && tags.length === 0 ? (
        <View style={styles.list}>
          <View style={styles.columnWrapper}>
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
          </View>
          <View style={[styles.columnWrapper, { marginTop: 12 }]}>
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
          </View>
        </View>
      ) : tags.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="tags" size={64} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
            No collections yet
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
            Create tags to organize your photos
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.countBar}>
            <Text style={[styles.countText, { color: theme.colors.onSurfaceVariant }]}>
              {tags.length} {tags.length === 1 ? 'collection' : 'collections'}
            </Text>
          </View>
          <FlatList
            data={tags}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            numColumns={numColumns}
            contentContainerStyle={styles.list}
            columnWrapperStyle={styles.columnWrapper}
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
  list: { 
    padding: spacing.md,
    paddingBottom: 100,
  },
  columnWrapper: { 
    justifyContent: 'space-between',
  },
  cardContainer: { 
    width: cardWidth, 
    marginBottom: spacing.md,
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
});
