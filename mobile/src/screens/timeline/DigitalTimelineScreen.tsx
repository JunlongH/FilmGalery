import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  type ListRenderItem,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import {
  fetchQuery,
  getQueryData,
  getQueryError,
  invalidateQueries,
  setQueryData,
  subscribeQuery,
} from '../../api/queryCache';
import { useT, getLanguage } from '../../i18n';
import { Icon } from '../../components/ui';
import GridCell from '../../components/digital/GridCell';
import { ITEM_SIZE, type DigitalPhoto } from '../../components/digital/DigitalPhotoGrid';
import {
  flattenPhotosToTimeline,
  type TimelineSectionItem,
} from './flattenTimeline';

const PAGE_SIZE = 60;
const NUM_COLUMNS = 3;
const GAP = 2;
const ROW_PADDING_H = 8;
export const ROW_HEIGHT = ITEM_SIZE;
export const HEADER_HEIGHT = 44;

export default function DigitalTimelineScreen() {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const [pages, setPages] = useState(1);
  const [renderTick, forceRender] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const pageKey = useCallback(
    (p: number) => `digitalPhotos@${baseUrl}?mode=digital&page=${p}`,
    [baseUrl],
  );
  const aggregateKey = baseUrl ? `digitalPhotosAggregate@${baseUrl}` : null;

  const fetchPage = useCallback(
    async (p: number): Promise<{ items: DigitalPhoto[]; hasMore: boolean }> => {
      const res: any = await api.http.get('/api/photos', {
        mode: 'digital',
        page: p,
        pageSize: PAGE_SIZE,
        sort: 'date_taken',
        order: 'desc',
      });
      const items: DigitalPhoto[] = Array.isArray(res) ? res : (res?.data ?? []);
      const hasMore = Array.isArray(res)
        ? items.length >= PAGE_SIZE
        : !!res?.hasMore;
      return { items, hasMore };
    },
    [],
  );

  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    setPages(1);
    fetchQuery(pageKey(1), () => fetchPage(1).then((r) => r.items), 0)
      .catch(() => {})
      .finally(() => { if (!cancelled) forceRender((n) => n + 1); });
    return () => { cancelled = true; };
  }, [baseUrl, pageKey, fetchPage]);

  useEffect(() => {
    if (!baseUrl) return;
    const keys = Array.from({ length: pages }, (_, i) => pageKey(i + 1));
    const unsubs = keys.map((k) => subscribeQuery(k, () => forceRender((n) => n + 1)));
    return () => unsubs.forEach((u) => u());
  }, [pages, baseUrl, pageKey]);

  const derived = useMemo(() => {
    const out: DigitalPhoto[] = [];
    const seen = new Set<number>();
    let lastHasMore = true;
    let lastLoaded = false;
    for (let p = 1; p <= pages; p++) {
      const d = getQueryData<DigitalPhoto[]>(pageKey(p));
      if (!d) continue;
      lastLoaded = true;
      for (const it of d) {
        if (it && typeof it.id !== 'undefined' && !seen.has(it.id)) {
          seen.add(it.id);
          out.push(it);
        }
      }
      if (p === pages) {
        lastHasMore = d.length >= PAGE_SIZE;
      }
    }
    return { items: out, hasMore: lastLoaded ? lastHasMore : true, loaded: lastLoaded };
  }, [pages, pageKey, renderTick]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aggregateKey) return;
    setQueryData<DigitalPhoto[]>(aggregateKey, derived.items);
  }, [aggregateKey, derived.items]);

  const loading = !derived.loaded && pages === 1;
  const error = !derived.loaded ? getQueryError(pageKey(1)) : undefined;

  // useT() subscribes to language changes (useSyncExternalStore), so reading
  // getLanguage() here re-evaluates the locale on each language switch.
  const locale = getLanguage() === 'en' ? 'en' : 'zh';

  const sections = useMemo(
    () =>
      flattenPhotosToTimeline(derived.items, {
        locale,
        unknownLabel: t('timeline.unknownMonth'),
      }),
    [derived.items, locale, t],
  );

  const onRefresh = useCallback(async () => {
    if (!baseUrl) return;
    setRefreshing(true);
    try {
      await fetchQuery(pageKey(1), () => fetchPage(1).then((r) => r.items), 0);
      for (let p = 2; p <= pages; p++) invalidateQueries(pageKey(p));
      setPages(1);
      forceRender((n) => n + 1);
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, pageKey, fetchPage, pages]);

  const onEndReached = useCallback(
    (_: { distanceFromEnd: number }) => {
      if (loadingMoreRef.current || refreshing || loading || !derived.hasMore || !baseUrl) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      const next = pages + 1;
      fetchPage(next)
        .then((r) => {
          setQueryData<DigitalPhoto[]>(pageKey(next), r.items);
          setPages(next);
        })
        .catch(() => {
          /* surfaced via ApiErrorSnackbar */
        })
        .finally(() => {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        });
    },
    [refreshing, loading, derived.hasMore, baseUrl, pages, pageKey, fetchPage],
  );

  const onPhotoPress = useCallback(
    (photo: DigitalPhoto) => {
      const flat: DigitalPhoto[] = [];
      for (const sec of sections) {
        if (sec.type === 'row') {
          for (const p of sec.photos) flat.push(p);
        }
      }
      const idx = flat.findIndex((p) => p.id === photo.id);
      navigation.navigate('PhotoView', {
        photo,
        photosKey: aggregateKey,
        initialIndex: idx >= 0 ? idx : 0,
        viewMode: 'positive',
        source_type: 'digital',
      });
    },
    [navigation, aggregateKey, sections],
  );

  const renderItem: ListRenderItem<TimelineSectionItem> = ({ item }) => {
    if (item.type === 'header') {
      return (
        <View style={[styles.headerRow, { borderColor: theme.colors.surfaceVariant }]}>
          <Text style={[styles.headerText, { color: theme.colors.onSurface }]}>
            {item.label}
          </Text>
        </View>
      );
    }
    const cells = item.photos.slice(0, NUM_COLUMNS);
    const fillerCount = NUM_COLUMNS - cells.length;
    return (
      <View style={styles.row}>
        {cells.map((p) => (
          <GridCell
            key={String(p.id)}
            photo={p}
            baseUrl={baseUrl}
            size={ITEM_SIZE}
            onPress={onPhotoPress}
          />
        ))}
        {fillerCount > 0
          ? Array.from({ length: fillerCount }).map((_, i) => (
              <View
                key={`fill-${i}`}
                style={[styles.filler, { width: ITEM_SIZE, height: ITEM_SIZE }]}
              />
            ))
          : null}
      </View>
    );
  };

  const keyExtractor = useCallback((item: TimelineSectionItem) => item.key, []);

  // Pre-compute cumulative offsets once per sections change so getItemLayout
  // is O(1) instead of O(n) per call (FlatList invokes it heavily during
  // scroll-to-index / windowing).
  const itemLayouts = useMemo(
    () => computeSectionLayouts(sections),
    [sections],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => itemLayouts[index] ?? { length: 0, offset: 0, index },
    [itemLayouts],
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (derived.items.length === 0 && error) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Icon name="alert" size={40} color={theme.colors.onSurfaceVariant} />
        <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant, marginTop: 12 }]}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={onRefresh}
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={9}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="image" size={40} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
              {t('digital.emptyTitle')}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              {t('digital.emptyBody')}
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>
                {t('digital.loadingMore')}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  listContent: {
    paddingHorizontal: ROW_PADDING_H,
    paddingBottom: 32,
  },
  headerRow: {
    height: HEADER_HEIGHT,
    justifyContent: 'flex-end',
    paddingBottom: 6,
    paddingTop: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
    height: ROW_HEIGHT,
  },
  filler: {
    backgroundColor: 'transparent',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    marginTop: 12,
  },
  emptyBody: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  footerText: {
    fontSize: 12,
  },
});

export interface SectionLayout {
  length: number;
  offset: number;
  index: number;
}

/**
 * Cumulative layout table for a flattened timeline. Each entry i gives the
 * { length, offset } FlatList expects for getItemLayout(_, i). Headers contribute
 * HEADER_HEIGHT; rows contribute ROW_HEIGHT. Pre-computed once so lookups are O(1).
 */
export function computeSectionLayouts(sections: TimelineSectionItem[]): SectionLayout[] {
  const out: SectionLayout[] = new Array(sections.length);
  let acc = 0;
  for (let i = 0; i < sections.length; i++) {
    const length = sections[i].type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
    out[i] = { length, offset: acc, index: i };
    acc += length;
  }
  return out;
}
