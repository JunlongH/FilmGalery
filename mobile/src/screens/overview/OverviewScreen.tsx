import React, { useCallback, useContext, useMemo, useState } from 'react';
import { ScrollView, RefreshControl, View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { ApiContext } from '../../context/ApiContext';
import { useAppMode } from '../../context/AppModeContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import HeroCarousel from '../../components/overview/HeroCarousel';
import QuickStatsRow from '../../components/overview/QuickStatsRow';
import BrowseSection from '../../components/overview/BrowseSection';

function toArray<T>(value: T | undefined | null): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function OverviewScreen() {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);
  const { mode } = useAppMode();

  const randomKey = baseUrl ? `overview/random@${baseUrl}#${mode}` : null;
  const summaryKey = baseUrl ? `overview/summary@${baseUrl}#${mode}` : null;
  const favoritesKey = baseUrl ? `favorites@${baseUrl}#${mode}` : null;
  const locationsKey = baseUrl && mode === 'film' ? `overview/locations@${baseUrl}#${mode}` : null;
  const albumsKey = baseUrl && mode === 'digital' ? `overview/albums@${baseUrl}#${mode}` : null;
  const recentKey = baseUrl ? `overview/recent@${baseUrl}#${mode}` : null;

  const randomQuery = useApiQuery<any[]>(
    randomKey,
    () => api.http.get('/api/photos/random', { limit: 8, mode }),
  );
  const summaryQuery = useApiQuery<any>(
    summaryKey,
    () => api.http.get('/api/stats/summary', { mode }),
  );
  const favoritesQuery = useApiQuery<any[]>(
    favoritesKey,
    () => api.http.get('/api/photos/favorites', { mode }),
  );
  const locationsQuery = useApiQuery<any[]>(
    locationsKey,
    () => api.http.get('/api/stats/locations', { mode }),
  );
  const albumsQuery = useApiQuery<any[]>(
    albumsKey,
    () => api.http.get('/api/albums', { include_deleted: false }),
  );
  const recentQuery = useApiQuery<any[]>(
    recentKey,
    () =>
      api.http.get('/api/photos', {
        mode,
        pageSize: 20,
        sort: 'date_taken',
        order: 'desc',
      }),
  );

  const refreshAll = useCallback(() => {
    randomQuery.refresh();
    summaryQuery.refresh();
    favoritesQuery.refresh();
    locationsQuery.refresh();
    albumsQuery.refresh();
    recentQuery.refresh();
  }, [
    randomQuery.refresh,
    summaryQuery.refresh,
    favoritesQuery.refresh,
    locationsQuery.refresh,
    albumsQuery.refresh,
    recentQuery.refresh,
  ]);

  const refreshing =
    randomQuery.refreshing ||
    summaryQuery.refreshing ||
    favoritesQuery.refreshing ||
    locationsQuery.refreshing ||
    albumsQuery.refreshing ||
    recentQuery.refreshing;

  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const randomPhotos = useMemo(() => toArray(randomQuery.data), [randomQuery.data]);
  const recentPhotos = useMemo(() => toArray(recentQuery.data), [recentQuery.data]);
  const favorites = useMemo(() => toArray(favoritesQuery.data), [favoritesQuery.data]);
  const locations = useMemo(() => toArray(locationsQuery.data), [locationsQuery.data]);
  const albums = useMemo(() => toArray(albumsQuery.data), [albumsQuery.data]);
  const summary = summaryQuery.data ?? null;

  const totalPhotos =
    mode === 'film'
      ? summary?.total_photos ?? 0
      : summary?.total_digital_photos ?? summary?.total_photos ?? 0;

  const anyLoading =
    randomQuery.loading || recentQuery.loading || summaryQuery.loading;

  const trulyEmpty =
    randomPhotos.length === 0 &&
    recentPhotos.length === 0 &&
    totalPhotos === 0 &&
    !anyLoading;

  const onRefreshStats = useCallback(() => {
    // Tapping stats cards opens the Stats screen for the active mode
    // (navigation wired at the BrowseSection level for the Stats entry card;
    // this prop is for the QuickStats tiles).
  }, []);

  if (trulyEmpty) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.emptyWrap}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        <Icon name="image" size={48} color={theme.colors.onSurfaceVariant} />
        <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
          {t('overview.emptyTitle')}
        </Text>
        <Text style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
          {t('overview.emptyBody')}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refreshAll}
          colors={[theme.colors.primary]}
          tintColor={theme.colors.primary}
        />
      }
    >
      <HeroCarousel
        photos={randomPhotos}
        loading={randomQuery.loading}
        active={focused}
        mode={mode}
        photosKey={randomKey}
      />
      <QuickStatsRow
        mode={mode}
        summary={summary}
        favoritesCount={favorites.length}
        locationsCount={locations.length}
        albumsCount={albums.length}
        recentPhotos={recentPhotos}
        loading={summaryQuery.loading}
        onPressStats={onRefreshStats}
      />
      <BrowseSection
        mode={mode}
        recentPhotos={recentPhotos}
        recentLoading={recentQuery.loading}
        recentPhotosKey={recentKey}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  emptyWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    marginTop: 16,
  },
  emptyBody: {
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
});
