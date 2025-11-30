import React, { useContext, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { Card, Title, Paragraph, ActivityIndicator, Text, useTheme, IconButton } from 'react-native-paper';
import CachedImage from '../components/CachedImage';
import CoverOverlay from '../components/CoverOverlay';
import { colors, spacing, radius } from '../theme';
import { ApiContext } from '../context/ApiContext';
import axios from 'axios';
import { format } from 'date-fns';

export default function FilmRollsScreen({ route, navigation }) {
  const theme = useTheme();
  const { filmId, filmName } = route.params;
  const { baseUrl } = useContext(ApiContext);
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRolls = async () => {
    if (!baseUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${baseUrl}/api/rolls`);
      // Filter by filmId
      const filtered = res.data.filter(r => r.filmId === filmId);
      setRolls(filtered);
    } catch (err) {
      setError('Failed to connect to server.');
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRolls();
    navigation.setOptions({ title: filmName || 'Film Rolls' });
  }, [baseUrl, filmId]);

  // Add header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="refresh" onPress={async () => { const { clearImageCache } = await import('../components/CachedImage'); await clearImageCache(); fetchRolls(); }} />
      )
    });
  }, [navigation, baseUrl, filmId]);

  const renderItem = ({ item }) => {
    let coverUrl = null;
    if (item.coverPath) {
      coverUrl = `${baseUrl}${item.coverPath}`;
    } else if (item.cover_photo) {
       coverUrl = `${baseUrl}/uploads/${item.cover_photo}`;
    }

    return (
      <Card 
        style={styles.card} 
        onPress={() => navigation.navigate('RollDetail', { rollId: item.id, rollName: item.title || `Roll #${item.id}` })}
        mode="elevated"
      >
        {coverUrl ? (
          <View style={styles.coverWrapper}>
            <CachedImage uri={coverUrl} style={styles.cover} contentFit="cover" />
            <CoverOverlay 
              title={item.title || `Roll #${item.id}`}
              leftText={(item.film_name_joined || item.film_type || 'Unknown Film')}
              rightText={`${item.start_date ? format(new Date(item.start_date), 'yyyy-MM-dd') : ''}${item.end_date ? ` - ${format(new Date(item.end_date), 'yyyy-MM-dd')}` : ''}`}
            />
          </View>
        ) : (
          <Card.Content style={styles.cardContent}>
            <Title style={styles.cardTitle}>{item.title || `Roll #${item.id}`}</Title>
            <Paragraph style={styles.meta}>{item.film_name_joined || item.film_type || 'Unknown Film'}</Paragraph>
          </Card.Content>
        )}
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      
      {loading && rolls.length === 0 ? (
        <ActivityIndicator animating={true} size="large" style={styles.loader} color="#5a4632" />
      ) : (
        <FlatList
          data={rolls}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchRolls} colors={['#5a4632']} />
          }
          ListEmptyComponent={!loading && <Text style={styles.empty}>No rolls found for this film.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: spacing.lg,
  },
  card: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
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
    fontWeight: 'bold',
    marginBottom: 4,
  },
  overlayRow: { flexDirection: 'row', justifyContent: 'space-between' },
  overlayFilmText: { color: '#eee', fontSize: 12, fontWeight: '500' },
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
  yearBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
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
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 18,
  },
  dateText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  meta: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  loader: {
    marginTop: 50,
  },
  errorContainer: {
    padding: spacing.md,
    backgroundColor: colors.surfaceVariant,
  },
  errorText: {
    color: colors.error,
    textAlign: 'center',
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
    color: colors.textSecondary,
  },
});
