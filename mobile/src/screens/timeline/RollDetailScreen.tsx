import React, { useContext, useMemo, useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import CachedImage from '../../components/CachedImage';
import SkeletonBox from '../../components/SkeletonBox';
import { spacing, radius } from '../../theme';
import { Text, Surface, Divider, useTheme, Switch } from 'react-native-paper';
import { Icon } from '../../components/ui';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { format } from 'date-fns';
import { parseLocalDate } from '../../utils/date';
import { getPhotoUrl } from '../../utils/urls';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
const tileSize = Math.floor((screenWidth - (spacing.sm * 2) - (numColumns * 2)) / numColumns);

export default function RollDetailScreen({ route, navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { rollId } = route.params;
  const { baseUrl } = useContext(ApiContext);
  const [expanded, setExpanded] = React.useState(false);
  const [showNegatives, setShowNegatives] = React.useState(false);

  const rollKey = baseUrl ? `roll:${rollId}@${baseUrl}` : null;
  const photosKey = baseUrl ? `rollPhotos:${rollId}@${baseUrl}` : null;

  const rollQuery = useApiQuery<any>(
    rollKey,
    () => api.http.get(`/api/rolls/${rollId}`),
  );
  const photosQuery = useApiQuery<any[]>(
    photosKey,
    () => api.http.get(`/api/rolls/${rollId}/photos`),
  );
  const roll = rollQuery.data ?? null;
  const photos = useMemo(() => photosQuery.data ?? [], [photosQuery.data]);
  const loading = rollQuery.loading && photosQuery.loading;

  const refresh = useCallback(() => {
    rollQuery.refresh();
    photosQuery.refresh();
  }, [rollQuery.refresh, photosQuery.refresh]);

  // Header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={{ marginRight: 16, padding: 4 }}
          onPress={refresh}
        >
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, theme, refresh]);

  const hasNegatives = useMemo(() => photos.some((p: any) => p.negative_rel_path), [photos]);

  const visiblePhotos = useMemo(
    () => (showNegatives ? photos.filter((p: any) => p.negative_rel_path) : photos),
    [photos, showNegatives],
  );

  const renderHeader = () => {
    if (!roll) return null;
    return (
      <Surface style={[styles.headerSurface, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <View style={styles.headerContent}>
          <View style={styles.headerTopRow}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>{roll.title || t('home.rollFallback', { id: roll.id })}</Text>
            <View style={styles.headerActions}>
                {hasNegatives && (
                    <View style={styles.toggleRow}>
                        <Text style={[styles.toggleLabel, { color: theme.colors.onSurfaceVariant }]}>{t('roll.negatives')}</Text>
                        <Switch
                            value={showNegatives}
                            onValueChange={setShowNegatives}
                            color={theme.colors.primary}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                    </View>
                )}
                <TouchableOpacity
                  style={{ padding: 8 }}
                  onPress={() => setExpanded(prev => !prev)}
                  accessibilityLabel={expanded ? t('roll.collapse') : t('roll.expand')}
                >
                  <Icon
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color={theme.colors.onSurfaceVariant}
                  />
                </TouchableOpacity>
            </View>
          </View>

          <Text style={[styles.date, { color: theme.colors.onSurfaceVariant }]}>
            {roll.start_date ? format(parseLocalDate(roll.start_date)!, 'MMMM d, yyyy') : t('common.noDate')}
            {roll.end_date ? ` - ${format(parseLocalDate(roll.end_date)!, 'MMMM d, yyyy')}` : ''}
          </Text>

          {expanded && (
            <>
              <Divider style={styles.divider} />

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>{t('roll.camera')}</Text>
                  <Text style={[styles.metaValue, { color: theme.colors.onSurface }]}>{roll.display_camera || '-'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>{t('roll.lens')}</Text>
                  <Text style={[styles.metaValue, { color: theme.colors.onSurface }]}>{roll.display_lens || '-'}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>{t('roll.filmStock')}</Text>
                  <Text style={[styles.metaValue, { color: theme.colors.onSurface }]}>{roll.film_name_joined || roll.film_type || '-'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>ISO</Text>
                  <Text style={[styles.metaValue, { color: theme.colors.onSurface }]}>{roll.film_iso_joined || roll.iso || '-'}</Text>
                </View>
              </View>

              {roll.notes ? (
                <View style={styles.notesContainer}>
                  <Text style={[styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>{t('roll.notes')}</Text>
                  <Text style={[styles.notesText, { color: theme.colors.onSurface }]}>{roll.notes}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </Surface>
    );
  };

  const renderItem = ({ item, index }: any) => {
    let uri;
    if (showNegatives && item.negative_rel_path) {
        uri = getPhotoUrl(baseUrl, item, 'negative');
    } else {
        uri = getPhotoUrl(baseUrl, item, 'thumb');
    }

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('PhotoView', {
            photo: item,
            rollId: rollId,
            viewMode: showNegatives ? 'negative' : 'positive',
            photosKey,
            initialIndex: index,
        })}
        activeOpacity={0.8}
      >
        <CachedImage
          uri={uri || ""}
          style={styles.thumbnail}
          contentFit="cover"
        />
        {item.rating === 1 && (
          <View style={styles.favoriteBadge}>
            <Icon name="heart" size={12} color="#fff" fill="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonBox key={i} width={tileSize} height={tileSize} style={styles.skeletonTile} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={visiblePhotos}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        numColumns={numColumns}
        contentContainerStyle={styles.list}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={styles.columnWrapper}
        initialNumToRender={12}
        windowSize={7}
        maxToRenderPerBatch={12}
        removeClippedSubviews={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  columnWrapper: {
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  headerSurface: {
    marginBottom: spacing.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  headerContent: {
    padding: spacing.lg,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
  toggleLabel: {
    fontSize: 12,
    marginRight: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    flex: 1,
    marginRight: spacing.md,
  },
  date: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  divider: {
    marginVertical: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 15,
    fontWeight: '500' as const,
  },
  notesContainer: {
    marginTop: spacing.sm,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
  },
  thumbnail: {
    width: tileSize,
    height: tileSize,
    borderRadius: radius.sm,
  },
  favoriteBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 10,
    padding: 2,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
  },
  skeletonTile: {
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    borderRadius: radius.sm,
  },
});
