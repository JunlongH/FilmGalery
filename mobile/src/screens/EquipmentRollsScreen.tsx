/**
 * EquipmentRollsScreen - Shows rolls that use a specific piece of equipment
 * Navigates to RollDetail when a roll is tapped
 */
import React, { useContext, useEffect, useState, useLayoutEffect, useRef, useCallback } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, Animated, TouchableOpacity } from 'react-native';
import { Card, Title, Paragraph, ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import CachedImage from '../components/CachedImage';
import CoverOverlay from '../components/CoverOverlay';
import { colors, spacing, radius } from '../theme';
import { ApiContext } from '../context/ApiContext';
import { Icon } from '../components/ui';
import { getRollsByEquipment } from '../api/equipment';
import { format } from 'date-fns';

export default function EquipmentRollsScreen({ route, navigation }: any) {
  const theme = useTheme();
  const { type, id, name } = route.params; // type: 'camera'|'lens'|'flash'|'film'
  const { baseUrl } = useContext(ApiContext);
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const fetchRolls = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getRollsByEquipment(type, id);
      setRolls(Array.isArray(data) ? data : []);
    } catch (err) {
      setError('Failed to load rolls.');
      console.error('Failed to fetch rolls by equipment:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRolls();
  }, [type, id]);

  useEffect(() => {
    navigation.setOptions({ title: name || 'Equipment Rolls' });
  }, [navigation, name]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity 
          style={{ marginRight: 16, padding: 4 }}
          onPress={async () => {
            const { clearImageCache } = await import('../components/CachedImage');
            await clearImageCache();
            fetchRolls();
          }}
        >
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      )
    });
  }, [navigation, theme]);

  const getTypeLabel = () => {
    switch (type) {
      case 'camera': return 'Camera';
      case 'lens': return 'Lens';
      case 'flash': return 'Flash';
      case 'film': return 'Film';
      default: return 'Equipment';
    }
  };

  const renderItem = ({ item }: any) => {
    let coverUrl = null;
    if (item.coverPath) {
      coverUrl = `${baseUrl}${item.coverPath}`;
    } else if (item.cover_photo) {
      coverUrl = `${baseUrl}/uploads/${item.cover_photo}`;
    }

    const dateRange = item.start_date 
      ? `${format(new Date(item.start_date), 'yyyy-MM-dd')}${item.end_date ? ` - ${format(new Date(item.end_date), 'yyyy-MM-dd')}` : ''}`
      : '';

    return (
      <Card 
        style={styles.card} 
        onPress={() => navigation.navigate('RollDetail', { 
          rollId: item.id, 
          rollName: item.title || `Roll #${item.id}` 
        })}
        mode="elevated"
      >
        {coverUrl ? (
          <View style={styles.coverWrapper}>
            <CachedImage uri={coverUrl} style={styles.cover} contentFit="cover" />
            <CoverOverlay 
              title={item.title || `Roll #${item.id}`}
              leftText={item.film_name_joined || item.film_type || 'Unknown Film'}
              rightText={dateRange}
            />
          </View>
        ) : (
          <Card.Content style={styles.cardContent}>
            <Title style={styles.cardTitle}>{item.title || `Roll #${item.id}`}</Title>
            <Paragraph style={styles.meta}>
              {item.film_name_joined || item.film_type || 'Unknown Film'}
            </Paragraph>
            {dateRange ? <Paragraph style={styles.dateText}>{dateRange}</Paragraph> : null}
          </Card.Content>
        )}
      </Card>
    );
  };

  if (loading && rolls.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" style={styles.loader} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text variant="bodyLarge" style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={{ padding: 8 }} onPress={async () => {
          const { clearImageCache } = await import('../components/CachedImage');
          await clearImageCache();
          fetchRolls();
        }}>
          <Icon name="refresh-cw" size={32} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={rolls}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchRolls} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text variant="titleMedium" style={styles.emptyText}>
              No rolls found for this {getTypeLabel().toLowerCase()}
            </Text>
            <Text variant="bodyMedium" style={styles.emptySubtext}>
              Rolls using this equipment will appear here
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  coverWrapper: {
    position: 'relative',
    width: '100%',
    height: 200,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  cardContent: {
    paddingVertical: spacing.md,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    marginBottom: spacing.xs,
  },
  meta: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: spacing.xs,
  },
  dateText: {
    fontSize: 12,
    opacity: 0.5,
  },
  loader: {
    marginTop: spacing.xl,
  },
  errorText: {
    color: colors.error,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontWeight: '600' as const,
  },
  emptySubtext: {
    textAlign: 'center',
    opacity: 0.6,
  },
});
