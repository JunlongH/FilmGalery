import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { Icon } from '../ui';
import type { AppMode } from '../../context/AppModeContext';
import { parseLocalDate } from '../../utils/date';
import { useT } from '../../i18n';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface QuickStatsRowProps {
  mode: AppMode;
  summary: any;
  favoritesCount: number;
  locationsCount: number;
  albumsCount: number;
  recentPhotos: any[];
  loading?: boolean;
  onPressStats?: () => void;
}

interface StatItem {
  icon: string;
  iconColor?: string;
  value: number | string;
  labelKey: string;
}

function isThisMonth(dateStr: string | null | undefined): boolean {
  const d = parseLocalDate(dateStr);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function QuickStatsRow({
  mode,
  summary,
  favoritesCount,
  locationsCount,
  albumsCount,
  recentPhotos,
  loading = false,
  onPressStats,
}: QuickStatsRowProps) {
  const theme = useTheme();
  const t = useT();

  const items: StatItem[] = useMemo(() => {
    const totalPhotos =
      mode === 'film'
        ? summary?.total_photos ?? 0
        : summary?.total_digital_photos ?? summary?.total_photos ?? 0;
    if (mode === 'film') {
      return [
        { icon: 'film', value: summary?.total_rolls ?? 0, labelKey: 'overview.stats.rolls' },
        { icon: 'image', value: totalPhotos, labelKey: 'overview.stats.photos' },
        { icon: 'heart', iconColor: '#E53935', value: favoritesCount, labelKey: 'overview.stats.favorites' },
        { icon: 'map-pin', iconColor: '#FB8C00', value: locationsCount, labelKey: 'overview.stats.locations' },
      ];
    }
    const monthCount = (Array.isArray(recentPhotos) ? recentPhotos : []).filter((p) =>
      isThisMonth(p?.date_taken || p?.taken_at || p?.created_at),
    ).length;
    return [
      { icon: 'image', value: totalPhotos, labelKey: 'overview.stats.photos' },
      { icon: 'folder', iconColor: '#7B1FA2', value: albumsCount, labelKey: 'overview.stats.albums' },
      { icon: 'trending-up', iconColor: '#43A047', value: monthCount, labelKey: 'overview.stats.thisMonth' },
      { icon: 'heart', iconColor: '#E53935', value: favoritesCount, labelKey: 'overview.stats.favorites' },
    ];
  }, [mode, summary, favoritesCount, locationsCount, albumsCount, recentPhotos]);

  return (
    <View style={styles.row}>
      {items.map((it, idx) => (
        <TouchableOpacity
          key={`${mode}-${idx}`}
          style={[styles.cell, { backgroundColor: theme.colors.surface }]}
          onPress={onPressStats}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: (it.iconColor || theme.colors.primary) + '22' },
            ]}
          >
            <Icon name={it.icon} size={18} color={it.iconColor || theme.colors.primary} />
          </View>
          <Text style={[styles.value, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {loading ? '–' : it.value}
          </Text>
          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {t(it.labelKey as any)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const cellGap = 8;
const sidePad = 12;
const cellWidth = (SCREEN_WIDTH - sidePad * 2 - cellGap * 3) / 4;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: sidePad,
    marginTop: 12,
    gap: cellGap,
  },
  cell: {
    width: cellWidth,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
});
