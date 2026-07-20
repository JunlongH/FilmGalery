import React, { useContext, useMemo } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { Card, Title, Paragraph, Text, useTheme } from 'react-native-paper';
import CachedImage from '../../components/CachedImage';
import CoverOverlay from '../../components/CoverOverlay';
import SkeletonBox from '../../components/SkeletonBox';
import { spacing, radius } from '../../theme';
import { ApiContext } from '../../context/ApiContext';
import { Icon } from '../../components/ui';
import { api } from '../../api/client';
import { format } from 'date-fns';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';

export default function FilmRollsScreen({ route, navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { filmId, filmName } = route.params;
  const { baseUrl } = useContext(ApiContext);

  // Shares the cached rolls list with the Timeline — no extra request when warm
  const { data, error: queryError, loading, refreshing, refresh } = useApiQuery<any[]>(
    baseUrl ? `rolls@${baseUrl}` : null,
    () => api.http.get('/api/rolls'),
  );
  const rolls = useMemo(
    () => (data ?? []).filter((r: any) => r.filmId === filmId),
    [data, filmId],
  );
  const error = rolls.length === 0 && queryError ? t('home.error') : null;

  React.useEffect(() => {
    navigation.setOptions({ title: filmName || t('title.filmRolls') });
  }, [navigation, filmName]);

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
      )
    });
  }, [navigation, theme, refresh]);

  const renderItem = ({ item }: any) => {
    let coverUrl = null;
    if (item.coverPath) {
      coverUrl = `${baseUrl}${item.coverPath}`;
    } else if (item.cover_photo) {
       coverUrl = `${baseUrl}/uploads/${item.cover_photo}`;
    }

    return (
      <Card 
        style={[styles.card, { backgroundColor: theme.colors.surface }]} 
        onPress={() => navigation.navigate('RollDetail', { rollId: item.id, rollName: item.title || t('home.rollFallback', { id: item.id }) })}
        mode="elevated"
      >
        {coverUrl ? (
          <View style={styles.coverWrapper}>
            <CachedImage uri={coverUrl} style={styles.cover} contentFit="cover" />
            <CoverOverlay 
              title={item.title || t('home.rollFallback', { id: item.id })}
              leftText={(item.film_name_joined || item.film_type || t('home.unknownFilm'))}
              rightText={`${item.start_date ? format(new Date(item.start_date), 'yyyy-MM-dd') : ''}${item.end_date ? ` - ${format(new Date(item.end_date), 'yyyy-MM-dd')}` : ''}`}
            />
          </View>
        ) : (
          <Card.Content style={styles.cardContent}>
            <Title style={[styles.cardTitle, { color: theme.colors.onSurface }]}>{item.title || t('home.rollFallback', { id: item.id })}</Title>
            <Paragraph style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>{item.film_name_joined || item.film_type || t('home.unknownFilm')}</Paragraph>
          </Card.Content>
        )}
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {error && (
        <View style={[styles.errorContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
        </View>
      )}
      
      {loading && rolls.length === 0 ? (
        <View style={styles.list}>
          {[0, 1].map((i) => (
            <SkeletonBox key={i} height={160} style={styles.skeletonCard} />
          ))}
        </View>
      ) : (
        <FlatList
          data={rolls}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[theme.colors.primary]} />
          }
          ListEmptyComponent={!loading ? <Text style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>{t('films.noRolls')}</Text> : null}
          initialNumToRender={6}
          windowSize={7}
          maxToRenderPerBatch={6}
          removeClippedSubviews={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: spacing.lg,
  },
  card: {
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  coverWrapper: { position: 'relative' },
  cover: {
    height: 160,
  },
  overlayFilmInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.40)',
    padding: 8,
  },
  overlayTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold' as const,
    marginBottom: 4,
  },
  overlayRow: { flexDirection: 'row', justifyContent: 'space-between' },
  overlayFilmText: { color: '#eee', fontSize: 12, fontWeight: '500' as const },
  overlayDateText: { color: '#eee', fontSize: 12 },
  yearBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  yearBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.5 },
  cardContent: {
    paddingTop: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontWeight: '600' as const,
    fontSize: 18,
  },
  dateText: {
    fontSize: 12,
  },
  meta: {
    fontSize: 14,
  },
  loader: {
    marginTop: 50,
  },
  errorContainer: {
    padding: spacing.md,
  },
  errorText: {
    textAlign: 'center',
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  skeletonCard: {
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
});
