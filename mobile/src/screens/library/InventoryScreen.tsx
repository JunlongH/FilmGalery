import React, { useContext, useMemo, useRef } from 'react';
import { View, FlatList, RefreshControl, StyleSheet, Animated } from 'react-native';
import { Chip, Text, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { getFilmItems, getFilms } from '../../api/filmItems';
import { buildUploadUrl } from '../../utils/urlHelper';
import { FILM_ITEM_STATUS_FILTERS, FILM_ITEM_STATUS_LABELS } from '../../constants/filmItemStatus';
import TouchScale from '../../components/TouchScale';
import CachedImage from '../../components/CachedImage';
import SkeletonBox from '../../components/SkeletonBox';
import { spacing, radius } from '../../theme';
import { Icon } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';

interface InventoryData {
  items: any[];
  films: any[];
}

export default function InventoryScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [statusFilter, setStatusFilter] = React.useState('all');

  const { data, error: queryError, loading, refreshing, refresh } = useApiQuery<InventoryData>(
    baseUrl ? `inventory@${baseUrl}` : null,
    async () => {
      const [filmItemsRes, filmsRes] = await Promise.all([getFilmItems(), getFilms()]);
      const items = (filmItemsRes as any) && Array.isArray((filmItemsRes as any).items) ? (filmItemsRes as any).items : [];
      return { items, films: Array.isArray(filmsRes) ? filmsRes : [] };
    },
  );
  const allItems = useMemo(() => data?.items ?? [], [data]);
  const films = useMemo(() => data?.films ?? [], [data]);
  const error = allItems.length === 0 && queryError ? 'Failed to load inventory' : '';

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // Animate on focus
  useFocusEffect(
    React.useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );

  const filmById = useMemo(() => {
    const map = new Map();
    films.forEach((f: any) => {
      if (f && f.id != null) map.set(f.id, f);
    });
    return map;
  }, [films]);

  const items = useMemo(() => {
    if (statusFilter === 'all') return allItems;
    return allItems.filter((it: any) => it.status === statusFilter);
  }, [allItems, statusFilter]);

  const renderItem = ({ item }: any) => {
    const film = filmById.get(item.film_id) || null;
    // Film name already contains full information (brand + model)
    const filmName = film
      ? (film.name || film.brand || 'Unknown Film')
      : `Film #${item.film_id || ''}`;
    // Build subtitle with format and ISO
    const filmMeta = film
      ? `ISO ${film.iso}${film.format && film.format !== '135' ? ` • ${film.format}` : ''}`
      : '';
    // For loaded items, show the camera used when available
    const statusLabel =
      item.status === 'loaded' && item.loaded_camera
        ? `Loaded on ${item.loaded_camera}`
        : ((FILM_ITEM_STATUS_LABELS as any)[item.status] || item.status);
    const expiry = item.expiry_date || null;
    const label = item.label || '';
    const rawThumb = film?.thumbPath || film?.thumbUrl || null;
    const thumb = buildUploadUrl(rawThumb, baseUrl);

    return (
      <TouchScale onPress={() => navigation.navigate('FilmItemDetail', { itemId: item.id, filmName })}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          {thumb ? (
            <CachedImage uri={thumb} style={styles.thumb} contentFit="cover" />
          ) : null}
          <View style={styles.cardBody}>
            <Text variant="titleMedium" numberOfLines={1}>{filmName}</Text>
            {filmMeta ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ opacity: 0.7 }}>{filmMeta}</Text>
            ) : null}
            {label ? (
              <Text variant="bodySmall" numberOfLines={1}>{label}</Text>
            ) : null}
            <Text variant="bodySmall" style={styles.status}>
              {statusLabel}
              {expiry ? ` • Exp ${expiry}` : ''}
            </Text>
          </View>
        </View>
      </TouchScale>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.filterRow}>
        <FlatList
          data={FILM_ITEM_STATUS_FILTERS}
          keyExtractor={item => item.value}
          horizontal
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Chip
              selected={statusFilter === item.value}
              onPress={() => setStatusFilter(item.value)}
              style={styles.chip}
            >
              {item.label}
            </Chip>
          )}
        />
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBox key={i} height={80} style={styles.skeletonCard} />
          ))}
        </View>
      ) : (
          <>
            {error ? (
              <Text style={{ color: theme.colors.error, marginHorizontal: spacing.lg, marginBottom: spacing.sm }}>{error}</Text>
            ) : null}
            <FlatList
          data={items}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[theme.colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="package" size={56} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
                No film items match this filter
              </Text>
            </View>
          }
          initialNumToRender={10}
          windowSize={7}
          maxToRenderPerBatch={10}
          removeClippedSubviews={true}
          />
          </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  chip: { marginRight: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  card: { borderRadius: radius.md, marginBottom: spacing.md, overflow: 'hidden', flexDirection: 'row' },
  thumb: { width: 80, height: 80 },
  cardBody: { flex: 1, padding: spacing.md, justifyContent: 'center' },
  status: { marginTop: 4 },
  skeletonCard: { borderRadius: radius.md, marginBottom: spacing.md },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyText: { marginTop: 12, fontSize: 14 },
});
