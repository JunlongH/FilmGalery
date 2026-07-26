import React, { useContext, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { useTheme, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import TagCard from '../../components/TagCard';
import SkeletonBox from '../../components/SkeletonBox';
import { spacing, radius } from '../../theme';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const cardWidth = (screenWidth - 32 - 12) / numColumns;

export default function CollectionsAlbumsScreen() {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<any>();
  const { baseUrl } = useContext(ApiContext);

  const tagsKey = baseUrl ? `tags@${baseUrl}#film` : null;
  const { data, loading, refreshing, refresh } = useApiQuery<any[]>(
    tagsKey,
    async () => {
      const res = await api.http.get('/api/tags', { mode: 'film' });
      return Array.isArray(res) ? res.filter((tg: any) => tg.photos_count > 0) : [];
    },
  );
  const tags = useMemo(() => data ?? [], [data]);

  const renderItem = ({ item }: any) => {
    let coverUri: string | null = null;
    if (item.cover_thumb) coverUri = `${baseUrl}/uploads/${item.cover_thumb}`;
    else if (item.cover_full) coverUri = `${baseUrl}/uploads/${item.cover_full}`;
    return (
      <TagCard
        coverUri={coverUri}
        title={item.name}
        subtitle={t('collections.photosCount', { count: item.photos_count })}
        style={styles.cardContainer}
        onPress={() =>
          navigation.navigate('TagDetail', {
            tagId: item.id,
            tagName: item.name,
            mode: 'film',
          })
        }
      />
    );
  };

  if (loading && tags.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.list}>
          <View style={styles.columnWrapper}>
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
          </View>
          <View style={[styles.columnWrapper, { marginTop: spacing.md }]}>
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: radius.lg }} />
          </View>
        </View>
      </View>
    );
  }

  if (tags.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.emptyContainer}>
          <Icon name="tags" size={64} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
            {t('collections.emptyTitle')}
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
            {t('collections.emptySubtitle')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.countBar}>
        <Text style={[styles.countText, { color: theme.colors.onSurfaceVariant }]}>
          {t('collections.count', { count: tags.length })}
        </Text>
      </View>
      <FlatList
        data={tags}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        numColumns={numColumns}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[theme.colors.primary]} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.md, paddingBottom: 100 },
  columnWrapper: { justifyContent: 'space-between' },
  cardContainer: { width: cardWidth, marginBottom: spacing.md },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 18, fontWeight: '600' as const, marginTop: 16 },
  emptySubtext: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  countBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  countText: { fontSize: 13 },
});
