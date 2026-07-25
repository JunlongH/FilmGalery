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
  Dimensions,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
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
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import CachedImage from '../../components/CachedImage';
import DigitalPhotoGrid, { type DigitalPhoto } from '../../components/digital/DigitalPhotoGrid';

const PAGE_SIZE = 60;
const { width } = Dimensions.get('window');
const SESSION_CARD_WIDTH = 160;

interface SessionRow {
  id: number;
  label?: string;
  notes?: string;
  session_date?: string;
  import_batch?: string;
  camera_name?: string;
  cover_thumb?: string;
  [key: string]: any;
}

export default function DigitalLibraryScreen() {
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
  const sessionsKey = baseUrl ? `digitalSessions@${baseUrl}` : null;

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

  const sessionsQuery = useApiQuery<SessionRow[]>(
    sessionsKey,
    () => api.http.get('/api/digital-sessions'),
  );
  const sessions = (sessionsQuery.data ?? []).slice(0, 12);

  const loading = !derived.loaded && pages === 1;
  const error = !derived.loaded ? getQueryError(pageKey(1)) : undefined;

  const onRefresh = useCallback(async () => {
    if (!baseUrl) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchQuery(pageKey(1), () => fetchPage(1).then((r) => r.items), 0),
        sessionsQuery.refresh(),
      ]);
      for (let p = 2; p <= pages; p++) invalidateQueries(pageKey(p));
      setPages(1);
      forceRender((n) => n + 1);
    } catch {
      /* surfaced via ApiErrorSnackbar */
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, pageKey, fetchPage, pages, sessionsQuery]);

  const onEndReached = useCallback((_: { distanceFromEnd: number }) => {
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
  }, [refreshing, loading, derived.hasMore, baseUrl, pages, pageKey, fetchPage]);

  const onPhotoPress = useCallback(
    (photo: DigitalPhoto, index: number) => {
      navigation.navigate('PhotoView', {
        photo,
        photosKey: aggregateKey,
        initialIndex: index,
        viewMode: 'positive',
        source_type: 'digital',
      });
    },
    [navigation, aggregateKey],
  );

  const sessionCoverUrl = useCallback(
    (s: SessionRow): string | null => {
      if (!baseUrl || !s.cover_thumb) return null;
      return `${baseUrl}/uploads/${s.cover_thumb}`;
    },
    [baseUrl],
  );

  const renderSession = ({ item }: { item: SessionRow }) => {
    const cover = sessionCoverUrl(item);
    const title = item.label || t('digital.sessionFallback', { id: item.id });
    return (
      <View style={[styles.sessionCard, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.sessionCover}>
          {cover ? (
            <CachedImage uri={cover} style={styles.sessionCoverImg} contentFit="cover" />
          ) : (
            <View style={[styles.sessionCoverImg, { backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }]}>
              <Icon name="image" size={28} color={theme.colors.onSurfaceVariant} />
            </View>
          )}
        </View>
        <Text style={[styles.sessionTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.sessionMeta, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
          {item.camera_name || (item.session_date ? formatDate(item.session_date) : '')}
        </Text>
      </View>
    );
  };

  const header = (
    <View>
      <View style={styles.headerSection}>
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
          {t('digital.albums')}
        </Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('DigitalAlbumList')}
          style={[styles.albumEntry, { backgroundColor: theme.colors.surface }]}
        >
          <View style={[styles.albumEntryIcon, { backgroundColor: theme.colors.secondaryContainer }]}>
            <Icon name="folder" size={26} color={theme.colors.secondary} />
          </View>
          <View style={styles.albumEntryBody}>
            <Text style={[styles.albumEntryTitle, { color: theme.colors.onSurface }]}>
              {t('digital.albums')}
            </Text>
            <Text style={[styles.albumEntryHint, { color: theme.colors.onSurfaceVariant }]}>
              {t('digital.albumsHint')}
            </Text>
          </View>
          <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      {sessions.length > 0 && (
        <View style={styles.headerSection}>
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
            {t('digital.recentImports')}
          </Text>
          <FlatList
            horizontal
            data={sessions}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderSession}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sessionsList}
            ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
          />
        </View>
      )}

      <View style={styles.headerSection}>
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
          {t('library.photos')}
        </Text>
      </View>
    </View>
  );

  const empty = (
    <View style={styles.empty}>
      <Icon name="image" size={40} color={theme.colors.onSurfaceVariant} />
      <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
        {t('digital.emptyTitle')}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
        {t('digital.emptyBody')}
      </Text>
    </View>
  );

  const footer = loadingMore ? (
    <View style={styles.footer}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}>
        {t('digital.loadingMore')}
      </Text>
    </View>
  ) : null;

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
      <DigitalPhotoGrid
        photos={derived.items}
        baseUrl={baseUrl}
        onPhotoPress={onPhotoPress}
        onEndReached={onEndReached}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer ?? undefined}
      />
    </View>
  );
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
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
  headerSection: {
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 10,
  },
  albumEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  albumEntryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumEntryBody: {
    flex: 1,
  },
  albumEntryTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  albumEntryHint: {
    fontSize: 12,
    marginTop: 2,
  },
  sessionsList: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sessionCard: {
    width: SESSION_CARD_WIDTH,
    borderRadius: 12,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  sessionCover: {
    width: '100%',
    height: 110,
  },
  sessionCoverImg: {
    width: '100%',
    height: '100%',
  },
  sessionTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    marginTop: 6,
    marginHorizontal: 8,
  },
  sessionMeta: {
    fontSize: 11,
    marginTop: 2,
    marginHorizontal: 8,
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
