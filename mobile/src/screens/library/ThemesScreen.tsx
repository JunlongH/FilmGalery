import React, { useContext, useCallback, useRef, useMemo } from 'react';
import { View, FlatList, StyleSheet, Dimensions, TouchableOpacity, Animated } from 'react-native';
import { useTheme, Text } from 'react-native-paper';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import TagCard from '../../components/TagCard';
import SkeletonBox from '../../components/SkeletonBox';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../../components/ui';
import { spacing, radius } from '../../theme';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const cardWidth = (screenWidth - 32 - 12) / numColumns; // 32 padding, 12 gap

export default function ThemesScreen({ navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);

  const { data, loading, refresh } = useApiQuery<any[]>(
    baseUrl ? `tags@${baseUrl}` : null,
    async () => {
      const res = await api.http.get('/api/tags');
      return res.filter((t: any) => t.photos_count > 0);
    },
  );
  const tags = useMemo(() => data ?? [], [data]);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

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
          subtitle={t('collections.photosCount', { count: item.photos_count })}
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
            {t('collections.emptyTitle')}
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
            {t('collections.emptySubtitle')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.countBar}>
            <Text style={[styles.countText, { color: theme.colors.onSurfaceVariant }]}>
              {t('collections.count', { count: tags.length })}
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
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  countText: {
    fontSize: 13,
  },
});
