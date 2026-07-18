import React, { useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, ScrollView, Animated, Dimensions, TouchableOpacity } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { colors, spacing, radius } from '../theme';
import CachedImage from '../components/CachedImage';
import { ApiContext } from '../context/ApiContext';
import { api } from '../api/client';
import { format } from 'date-fns';
import { getRollCoverUrl } from '../utils/urls';
import { Icon } from '../components/ui';
import { useFocusEffect } from '@react-navigation/native';

const { width } = Dimensions.get('window');

export default function HomeScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [selectedYear, setSelectedYear] = useState<any>(null); // null = all years

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // Animate on focus
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }, [])
  );

  const fetchRolls = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.http.get('/api/rolls');
      setRolls(res);
    } catch (err) {
      setError('Failed to connect to server. Check Settings.');
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchRolls();
  }, [fetchRolls]);

  // Derive year list from rolls
  const years = useMemo(() => {
    const set = new Set();
    rolls.forEach(r => {
      const dateStr = r.start_date || r.startDate || r.shot_date || r.created_at || r.createdAt || r.date || r.end_date || r.endDate;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) set.add(d.getFullYear());
    });
    return Array.from(set).sort((a: any, b: any) => (b as number) - (a as number)); // desc
  }, [rolls]);

  // Filter rolls by selected year (null shows all)
  const filteredRolls = useMemo(() => {
    if (!selectedYear) return rolls;
    return rolls.filter(r => {
      const sStr = r.start_date || r.startDate || r.shot_date || r.created_at || r.createdAt || r.date;
      const eStr = r.end_date || r.endDate;
      const dates = [sStr, eStr].filter(Boolean);
      if (dates.length === 0) return false;
      return dates.some(ds => {
        const d = new Date(ds);
        return !isNaN(d.getTime()) && d.getFullYear() === selectedYear;
      });
    });
  }, [rolls, selectedYear]);

  const renderItem = ({ item, index }) => {
    const coverUrl = getRollCoverUrl(baseUrl, item);
    const filmLabel = item.film_name_joined || item.film_type || 'Unknown Film';
    const dateStr = item.start_date ? format(new Date(item.start_date), 'yyyy-MM-dd') : '';
    const dateRange = item.end_date ? `${dateStr} - ${format(new Date(item.end_date), 'yyyy-MM-dd')}` : dateStr;
    const photoCount = item.photo_count || item.photos?.length || 0;

    return (
      <Animated.View
        style={{
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }}
      >
        <TouchableOpacity 
          onPress={() => navigation.navigate('RollDetail', { rollId: item.id, rollName: item.title || `Roll #${item.id}` })}
          activeOpacity={0.9}
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
        >
          <View style={styles.coverWrapper}>
            {coverUrl ? (
              <CachedImage uri={coverUrl} style={styles.cover} contentFit="cover" />
            ) : (
              <View style={[styles.cover, styles.placeholderCover, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Icon name="film" size={48} color={theme.colors.onSurfaceVariant} />
              </View>
            )}
            {/* Gradient overlay */}
            <View style={styles.gradientOverlay} />
            
            {/* Content overlay */}
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title || `Roll #${item.id}`}
              </Text>
              <View style={styles.cardMeta}>
                <View style={styles.metaItem}>
                  <Icon name="film" size={14} color="#fff" />
                  <Text style={styles.metaText}>{filmLabel}</Text>
                </View>
                {dateStr ? (
                  <View style={styles.metaItem}>
                    <Icon name="calendar" size={14} color="#fff" />
                    <Text style={styles.metaText}>{dateRange}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            
            {/* Photo count badge */}
            {photoCount > 0 && (
              <View style={styles.photoBadge}>
                <Icon name="image" size={12} color="#fff" />
                <Text style={styles.photoBadgeText}>{photoCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {error && (
        <View style={styles.errorContainer}>
          <Icon name="wifi-off" size={24} color={theme.colors.error} />
          <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
        </View>
      )}
      
      {loading && rolls.length === 0 ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator animating={true} size="large" color={theme.colors.primary} />
          <Text style={[styles.loaderText, { color: theme.colors.onSurfaceVariant }]}>Loading rolls...</Text>
        </View>
      ) : (
        <>
          {/* Year filter chips */}
          <View style={styles.yearBarWrapper}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.yearBarContent}
            >
              <TouchableOpacity
                onPress={() => setSelectedYear(null)}
                style={[
                  styles.yearChip,
                  { 
                    backgroundColor: !selectedYear ? theme.colors.primary : theme.colors.surface,
                    borderColor: theme.colors.primary,
                  }
                ]}
              >
                <Text style={[
                  styles.yearChipText,
                  { color: !selectedYear ? '#fff' : theme.colors.primary }
                ]}>All</Text>
              </TouchableOpacity>
              {years.map(y => (
                <TouchableOpacity
                  key={y as React.Key}
                  onPress={() => setSelectedYear(y)}
                  style={[
                    styles.yearChip,
                    { 
                      backgroundColor: selectedYear === y ? theme.colors.primary : theme.colors.surface,
                      borderColor: theme.colors.primary,
                    }
                  ]}
                >
                  <Text style={[
                    styles.yearChipText,
                    { color: selectedYear === y ? '#fff' : theme.colors.primary }
                  ]}>{String(y)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Roll count */}
          <View style={styles.countBar}>
            <Text style={[styles.countText, { color: theme.colors.onSurfaceVariant }]}>
              {filteredRolls.length} {filteredRolls.length === 1 ? 'roll' : 'rolls'}
              {selectedYear ? ` in ${selectedYear}` : ''}
            </Text>
          </View>

          <FlatList
            data={filteredRolls}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={fetchRolls} colors={[theme.colors.primary]} />
            }
            showsVerticalScrollIndicator={false}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 100,
  },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  coverWrapper: {
    position: 'relative',
    height: 200,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  placeholderCover: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
    backgroundColor: 'transparent',
  },
  cardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: '#eee',
    fontSize: 12,
    fontWeight: '500' as const,
  },
  photoBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  photoBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: 8,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 14,
  },
  yearBarWrapper: {
    height: 56,
    backgroundColor: 'transparent',
  },
  yearBarContent: {
    paddingHorizontal: 16,
    height: 56,
    alignItems: 'center',
    flexDirection: 'row',
  },
  yearChip: {
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1.5,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  countBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  countText: {
    fontSize: 13,
  },
});
