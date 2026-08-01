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
  ScrollView,
  TouchableOpacity,
  type ListRenderItem,
} from 'react-native';
import { useTheme, FAB, SegmentedButtons } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import {
  fetchQuery,
  getQueryData,
  getQueryError,
  hasQueryData,
  invalidateQueries,
  removeQueryData,
  setQueryData,
  subscribeQuery,
} from '../../api/queryCache';
import { useT, getLanguage } from '../../i18n';
import { Icon } from '../../components/ui';
import GridCell from '../../components/digital/GridCell';
import { ITEM_SIZE, type DigitalPhoto } from '../../components/digital/DigitalPhotoGrid';
import {
  flattenPhotosToTimeline,
  getPhotoGroupKey,
  type GroupBy,
  type TimelineSectionItem,
} from './flattenTimeline';

interface FacetMonth {
  month: string;
  count: number;
}
interface FacetYear {
  year: string;
  count: number;
  months: FacetMonth[];
}
interface Facets {
  years: FacetYear[];
  cameras: unknown[];
  lenses: unknown[];
}

function formatMonthChipLabel(monthStr: string, locale: string): string {
  const m = Number(monthStr);
  if (!Number.isFinite(m) || m < 1 || m > 12) return monthStr;
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(
      new Date(2000, m - 1, 1),
    );
  } catch {
    return monthStr;
  }
}

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
  const generationRef = useRef(0);
  const lastFilteredKeyRef = useRef<string | null>(null);
  const [autoLoadBlocked, setAutoLoadBlocked] = useState(false);

  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [filterYear, setFilterYear] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState<string | null>(null);

  const pageKey = useCallback(
    (p: number) => `digitalPhotos@${baseUrl}?mode=digital&page=${p}`,
    [baseUrl],
  );
  const aggregateKey = baseUrl ? `digitalPhotosAggregate@${baseUrl}` : null;
  const facetsKey = baseUrl ? `digitalFacets@${baseUrl}` : null;

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
    AsyncStorage.getItem(`timeline_groupby@${baseUrl}`)
      .then((saved) => {
        if (cancelled) return;
        if (saved === 'day' || saved === 'month') setGroupBy(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const handleGroupByChange = useCallback(
    (next: GroupBy) => {
      setGroupBy(next);
      if (baseUrl) {
        AsyncStorage.setItem(`timeline_groupby@${baseUrl}`, next).catch(() => {});
      }
    },
    [baseUrl],
  );

  useEffect(() => {
    if (!facetsKey) return;
    let cancelled = false;
    if (!hasQueryData(facetsKey)) {
      fetchQuery(facetsKey, () => api.http.get('/api/photos/facets', { mode: 'digital' }), 0)
        .catch(() => {})
        .finally(() => {
          if (!cancelled) forceRender((n) => n + 1);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [facetsKey]);

  useEffect(() => {
    if (!facetsKey) return;
    const unsub = subscribeQuery(facetsKey, () => forceRender((n) => n + 1));
    return unsub;
  }, [facetsKey]);

  const selectYear = useCallback((year: string | null) => {
    setFilterYear(year);
    setFilterMonth(null);
  }, []);

  const selectMonth = useCallback((month: string | null) => {
    setFilterMonth(month);
  }, []);

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

  const facets = useMemo(() => {
    if (!facetsKey) return null;
    return getQueryData<Facets>(facetsKey) ?? null;
  }, [facetsKey, renderTick]);  // eslint-disable-line react-hooks/exhaustive-deps

  const facetYears = useMemo<FacetYear[]>(() => facets?.years ?? [], [facets]);

  const activeYearBucket = useMemo(
    () => facetYears.find((y) => y.year === filterYear) ?? null,
    [facetYears, filterYear],
  );
  const monthOptions = useMemo<FacetMonth[]>(
    () => (activeYearBucket ? [...activeYearBucket.months].sort((a, b) => a.month.localeCompare(b.month)) : []),
    [activeYearBucket],
  );

  const isFiltering = filterYear !== null || filterMonth !== null;

  const filteredItems = useMemo(() => {
    if (!isFiltering) return derived.items;
    const out: DigitalPhoto[] = [];
    for (const p of derived.items) {
      const key = getPhotoGroupKey(p, 'month');
      if (!key) continue;
      if (filterYear && filterMonth) {
        if (key === `${filterYear}-${filterMonth}`) out.push(p);
      } else if (filterYear) {
        if (key.startsWith(`${filterYear}-`)) out.push(p);
      }
    }
    return out;
  }, [derived.items, isFiltering, filterYear, filterMonth]);

  const viewerPhotosKey = useMemo(() => {
    if (!baseUrl) return null;
    if (!isFiltering) return aggregateKey;
    return `digitalPhotosFiltered@${baseUrl}?y=${filterYear ?? ''}&m=${filterMonth ?? ''}`;
  }, [baseUrl, aggregateKey, isFiltering, filterYear, filterMonth]);

  const sections = useMemo(
    () =>
      flattenPhotosToTimeline(filteredItems, {
        locale,
        unknownLabel: t('timeline.unknownMonth'),
        groupBy,
      }),
    [filteredItems, locale, t, groupBy],
  );

  const onRefresh = useCallback(async () => {
    if (!baseUrl) return;
    generationRef.current += 1;
    setRefreshing(true);
    try {
      await fetchQuery(pageKey(1), () => fetchPage(1).then((r) => r.items), 0);
      for (let p = 2; p <= pages; p++) invalidateQueries(pageKey(p));
      if (facetsKey) {
        invalidateQueries(facetsKey);
        fetchQuery(facetsKey, () => api.http.get('/api/photos/facets', { mode: 'digital' }), 0)
          .catch((err) => { console.error('[DigitalTimeline] facets refresh error:', err); })
          .finally(() => { forceRender((n) => n + 1); });
      }
      setAutoLoadBlocked(false);
      setPages(1);
      forceRender((n) => n + 1);
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, pageKey, fetchPage, pages, facetsKey]);

  const loadMore = useCallback(
    (opts: { auto?: boolean } = {}) => {
      const { auto = false } = opts;
      if (loadingMoreRef.current || refreshing || loading || !derived.hasMore || !baseUrl) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      const gen = generationRef.current;
      const next = pages + 1;
      fetchPage(next)
        .then((r) => {
          if (gen !== generationRef.current) return;
          setQueryData<DigitalPhoto[]>(pageKey(next), r.items);
          setPages(next);
        })
        .catch(() => {
          if (gen !== generationRef.current) return;
          if (auto) setAutoLoadBlocked(true);
        })
        .finally(() => {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        });
    },
    [refreshing, loading, derived.hasMore, baseUrl, pages, pageKey, fetchPage],
  );

  const onEndReached = useCallback(
    (_: { distanceFromEnd: number }) => {
      loadMore();
    },
    [loadMore],
  );

  useEffect(() => {
    setAutoLoadBlocked(false);
  }, [filterYear, filterMonth]);

  useEffect(() => () => {
    if (lastFilteredKeyRef.current) removeQueryData(lastFilteredKeyRef.current);
  }, []);

  useEffect(() => {
    if (!isFiltering) return;
    if (filteredItems.length > 0) return;
    if (!derived.hasMore) return;
    if (loadingMoreRef.current) return;
    if (autoLoadBlocked) return;
    loadMore({ auto: true });
  }, [isFiltering, filterYear, filterMonth, filteredItems.length, derived.hasMore, autoLoadBlocked, loadMore]);

  const onPhotoPress = useCallback(
    (photo: DigitalPhoto) => {
      const flat: DigitalPhoto[] = filteredItems;
      const idx = flat.findIndex((p) => p.id === photo.id);
      if (isFiltering && viewerPhotosKey) {
        if (lastFilteredKeyRef.current && lastFilteredKeyRef.current !== viewerPhotosKey) {
          removeQueryData(lastFilteredKeyRef.current);
        }
        lastFilteredKeyRef.current = viewerPhotosKey;
        setQueryData<DigitalPhoto[]>(viewerPhotosKey, flat);
      }
      navigation.navigate('PhotoView', {
        photo,
        photosKey: viewerPhotosKey,
        initialIndex: idx >= 0 ? idx : 0,
        viewMode: 'positive',
        source_type: 'digital',
      });
    },
    [navigation, viewerPhotosKey, filteredItems, isFiltering],
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
      <View style={styles.toolbar}>
        <SegmentedButtons
          value={groupBy}
          onValueChange={(v) => {
            if (v === 'day' || v === 'month') handleGroupByChange(v);
          }}
          buttons={[
            { value: 'month', label: t('timeline.groupByMonth'), icon: 'calendar-month' },
            { value: 'day', label: t('timeline.groupByDay'), icon: 'calendar-today' },
          ]}
          density="small"
        />
        {facetYears.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <TouchableOpacity
              onPress={() => selectYear(null)}
              style={[
                styles.chip,
                {
                  backgroundColor: !filterYear ? theme.colors.primary : theme.colors.surface,
                  borderColor: theme.colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: !filterYear ? '#fff' : theme.colors.primary },
                ]}
              >
                {t('common.all')}
              </Text>
            </TouchableOpacity>
            {facetYears.map((y) => {
              const selected = filterYear === y.year;
              return (
                <TouchableOpacity
                  key={y.year}
                  onPress={() => selectYear(y.year)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                      borderColor: theme.colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selected ? '#fff' : theme.colors.primary },
                    ]}
                  >
                    {y.year}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
        {filterYear && monthOptions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <TouchableOpacity
              onPress={() => selectMonth(null)}
              style={[
                styles.chip,
                {
                  backgroundColor: !filterMonth ? theme.colors.primary : theme.colors.surface,
                  borderColor: theme.colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: !filterMonth ? '#fff' : theme.colors.primary },
                ]}
              >
                {t('common.all')}
              </Text>
            </TouchableOpacity>
            {monthOptions.map((m) => {
              const selected = filterMonth === m.month;
              return (
                <TouchableOpacity
                  key={m.month}
                  onPress={() => selectMonth(m.month)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                      borderColor: theme.colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selected ? '#fff' : theme.colors.primary },
                    ]}
                  >
                    {formatMonthChipLabel(m.month, locale)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
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
          derived.items.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="image" size={40} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
                {t('digital.emptyTitle')}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
                {t('digital.emptyBody')}
              </Text>
            </View>
          ) : isFiltering && derived.hasMore && !autoLoadBlocked ? (
            <View style={styles.empty}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="filter" size={40} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant, marginTop: 12 }]}>
                {t('timeline.filterEmpty')}
              </Text>
            </View>
          )
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
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color="#fff"
        accessibilityLabel={t('digital.import.title')}
        onPress={() => navigation.navigate('DigitalImport')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    paddingTop: 6,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  listContent: {
    paddingHorizontal: ROW_PADDING_H,
    paddingBottom: 96,
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
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
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
