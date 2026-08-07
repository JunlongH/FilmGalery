/**
 * EquipmentRollsScreen - Shows rolls that use a specific piece of equipment
 * Navigates to RollDetail when a roll is tapped
 */
import React, { useContext, useLayoutEffect, useMemo } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { Card, Title, Paragraph, Text, useTheme } from 'react-native-paper';
import CachedImage from '../../components/CachedImage';
import CoverOverlay from '../../components/CoverOverlay';
import SkeletonBox from '../../components/SkeletonBox';
import { spacing, radius } from '../../theme';
import { ApiContext } from '../../context/ApiContext';
import { Icon } from '../../components/ui';
import { getRollsByEquipment } from '../../api/equipment';
import { format } from 'date-fns';
import { parseLocalDate } from '../../utils/date';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';

export default function EquipmentRollsScreen({ route, navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { type, id, name } = route.params; // type: 'camera'|'lens'|'flash'|'film'
  const { baseUrl } = useContext(ApiContext);

  const { data, error: queryError, loading, refreshing, refresh } = useApiQuery<any[]>(
    baseUrl && id ? `equipmentRolls:${type}:${id}@${baseUrl}` : null,
    async () => {
      const res = await getRollsByEquipment(type, id);
      return Array.isArray(res) ? res : [];
    },
  );
  const rolls = useMemo(() => data ?? [], [data]);
  const error = rolls.length === 0 && queryError ? t('equipment.loadFailed') : null;

  React.useEffect(() => {
    navigation.setOptions({ title: name || t('title.equipmentRolls') });
  }, [navigation, name]);

  useLayoutEffect(() => {
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

  const getTypeLabel = () => {
    switch (type) {
      case 'camera': return t('roll.camera');
      case 'lens': return t('roll.lens');
      case 'flash': return t('equipment.flashes');
      case 'film': return t('equipment.films');
      default: return t('title.equipment');
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
      ? `${format(parseLocalDate(item.start_date)!, 'yyyy-MM-dd')}${item.end_date ? ` - ${format(parseLocalDate(item.end_date)!, 'yyyy-MM-dd')}` : ''}`
      : '';

    return (
      <Card 
        style={styles.card} 
        onPress={() => navigation.navigate('RollDetail', { 
          rollId: item.id, 
          rollName: item.title || t('home.rollFallback', { id: item.id }) 
        })}
        mode="elevated"
      >
        {coverUrl ? (
          <View style={styles.coverWrapper}>
            <CachedImage uri={coverUrl} style={styles.cover} contentFit="cover" />
            <CoverOverlay 
              title={item.title || t('home.rollFallback', { id: item.id })}
              leftText={item.film_name_joined || item.film_type || t('home.unknownFilm')}
              rightText={dateRange}
            />
          </View>
        ) : (
          <Card.Content style={styles.cardContent}>
            <Title style={styles.cardTitle}>{item.title || t('home.rollFallback', { id: item.id })}</Title>
            <Paragraph style={styles.meta}>
              {item.film_name_joined || item.film_type || t('home.unknownFilm')}
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
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <SkeletonBox key={i} height={200} style={styles.skeletonCard} />
          ))}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text variant="bodyLarge" style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
        <TouchableOpacity style={{ padding: 8 }} onPress={refresh}>
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
          <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[theme.colors.primary]} />
        }
        initialNumToRender={6}
        windowSize={7}
        maxToRenderPerBatch={6}
        removeClippedSubviews={true}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text variant="titleMedium" style={styles.emptyText}>
              {t('equipment.noRolls', { what: getTypeLabel() })}
            </Text>
            <Text variant="bodyMedium" style={styles.emptySubtext}>
              {t('equipment.noRollsHint')}
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
  skeletonCard: {
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errorText: {
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
