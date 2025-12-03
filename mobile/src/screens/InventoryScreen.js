import React, { useContext, useEffect, useMemo, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet, Image } from 'react-native';
import { ActivityIndicator, Chip, Text, useTheme } from 'react-native-paper';
import { ApiContext } from '../context/ApiContext';
import { getFilmItems, getFilms } from '../api/filmItems';
import { buildUploadUrl } from '../utils/urlHelper';
import { FILM_ITEM_STATUS_FILTERS, FILM_ITEM_STATUS_LABELS } from '../constants/filmItemStatus';
import TouchScale from '../components/TouchScale';
import { spacing, radius } from '../theme';

export default function InventoryScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [statusFilter, setStatusFilter] = useState('all');
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [films, setFilms] = useState([]);

  const loadAll = async () => {
    if (!baseUrl) return;
    setLoading(true);
    setError('');
    try {
      const [filmItemsRes, filmsRes] = await Promise.all([
        getFilmItems(),
        getFilms(),
      ]);
      const items = filmItemsRes && Array.isArray(filmItemsRes.items) ? filmItemsRes.items : [];
      setAllItems(items);
      setFilms(Array.isArray(filmsRes) ? filmsRes : []);
    } catch (err) {
      console.log('Failed to load film items', err);
      setError('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [baseUrl]);

  const onRefresh = () => {
    loadAll();
  };

  const filmById = useMemo(() => {
    const map = new Map();
    films.forEach(f => {
      if (f && f.id != null) map.set(f.id, f);
    });
    return map;
  }, [films]);

  const items = useMemo(() => {
    if (statusFilter === 'all') return allItems;
    return allItems.filter(it => it.status === statusFilter);
  }, [allItems, statusFilter]);

  const renderItem = ({ item }) => {
    const film = filmById.get(item.film_id) || null;
    const filmName = film?.name || `Film #${item.film_id || ''}`;
    // For loaded items, show the camera used when available
    const statusLabel =
      item.status === 'loaded' && item.loaded_camera
        ? `Loaded on ${item.loaded_camera}`
        : (FILM_ITEM_STATUS_LABELS[item.status] || item.status);
    const expiry = item.expiry_date || null;
    const label = item.label || '';
    const rawThumb = film?.thumbPath || film?.thumbUrl || null;
    const thumb = buildUploadUrl(rawThumb, baseUrl);

    return (
      <TouchScale onPress={() => navigation.navigate('FilmItemDetail', { itemId: item.id, filmName })}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
          ) : null}
          <View style={styles.cardBody}>
            <Text variant="titleMedium" numberOfLines={1}>{filmName}</Text>
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
        <ActivityIndicator animating size="large" style={{ marginTop: 40 }} />
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
            <RefreshControl refreshing={loading} onRefresh={onRefresh} colors={[theme.colors.primary]} />
          }
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
});
