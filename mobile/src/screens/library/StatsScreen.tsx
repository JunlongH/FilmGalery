import React, { useRef, useCallback, useContext } from 'react';
import { ScrollView, StyleSheet, View, Dimensions, Animated } from 'react-native';
import { ActivityIndicator, Card, Text, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { BarChart, PieChart } from 'react-native-chart-kit';
import { spacing, radius } from '../../theme';
import { Icon } from '../../components/ui';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLibraryMode } from '../../hooks/useLibraryMode';
import { useT } from '../../i18n';

const screenWidth = Dimensions.get('window').width;

const makeChartConfig = (surface: string) => ({
  backgroundGradientFrom: surface,
  backgroundGradientTo: surface,
  color: (opacity = 1) => `rgba(102, 126, 234, ${opacity})`,
  strokeWidth: 2,
  barPercentage: 0.7,
  decimalPlaces: 0,
});

const COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe',
  '#43e97b', '#38f9d7', '#fa709a', '#fee140', '#8fd3f4', '#84fab0'
];

interface StatsData {
  overview: any;
  inventory: any;
  activity: any;
  costs: any;
  gear: any;
}

export default function StatsScreen({ navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);
  const mode = useLibraryMode();

  const { data, error: queryError, loading, refresh } = useApiQuery<StatsData>(
    baseUrl ? `stats@${baseUrl}#${mode}` : null,
    async () => {
      const [overview, inventory, activity, costs, gear] = await Promise.all([
        api.http.get('/api/stats/summary', { mode }),
        api.http.get('/api/stats/inventory', { mode }),
        api.http.get('/api/stats/activity', { mode }),
        api.http.get('/api/stats/costs', { mode }),
        api.http.get('/api/stats/gear', { mode }),
      ]);
      return { overview, inventory, activity, costs, gear };
    },
  );
  const CHART_CONFIG = makeChartConfig(theme.colors.surface);
  const { overview, inventory, activity, costs, gear } = data ?? {
    overview: null, inventory: null, activity: null, costs: null, gear: null,
  };

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );

  React.useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ marginRight: 8 }}>
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} onPress={refresh} />
        </View>
      ),
    });
  }, [navigation, theme, refresh]);

  if (loading && !overview) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator animating size="large" />
      </View>
    );
  }

  // Prepare Activity Data
  const activityData = {
    labels: (activity || []).slice(0, 6).reverse().map((a: any) => a.month.split('-')[1]), // Last 6 months, show month number
    datasets: [{
      data: (activity || []).slice(0, 6).reverse().map((a: any) => a.count)
    }]
  };

  // Prepare Pie Data Helper
  const preparePieData = (items: any, labelKey = 'name', valueKey = 'count') => {
    if (!items) return [];
    return items.slice(0, 5).map((item: any, index: any) => ({
      name: item[labelKey],
      population: item[valueKey],
      color: COLORS[index % COLORS.length],
      legendFontColor: '#7F7F7F',
      legendFontSize: 12
    }));
  };

  const filmData = preparePieData(gear?.films);
  const cameraData = preparePieData(gear?.cameras);

  return (
    <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}>
      {queryError ? (
        <Text style={{ color: theme.colors.error, marginBottom: spacing.sm }}>{t('stats.loadFailed')}</Text>
      ) : null}

      {/* Overview cards */}
      <Text variant="titleMedium" style={styles.sectionTitle}>{t('stats.overview')}</Text>
      <View style={styles.row}>
        <StatCard label={t('stats.totalRolls')} value={overview?.total_rolls ?? '-'} />
        <StatCard label={t('stats.totalPhotos')} value={overview?.total_photos ?? '-'} />
      </View>
      <View style={styles.row}>
        <StatCard label={t('stats.totalSpending')} value={overview ? `¥${Math.round(overview.total_cost || 0)}` : '-'} />
        <StatCard label={t('stats.avgPerRoll')} value={costs && costs.summary ? `¥${Math.round((costs.summary.total_purchase + costs.summary.total_develop) / (costs.summary.roll_count || 1))}` : '-'} />
      </View>

      {/* Inventory */}
      <Text variant="titleMedium" style={styles.sectionTitle}>{t('stats.inventory')}</Text>
      <View style={styles.row}>
        <StatCard label={t('stats.inStock')} value={inventory?.value?.total_count ?? 0} />
        <StatCard label={t('stats.inventoryValue')} value={inventory ? `¥${Math.round(inventory.value?.total_value || 0)}` : '-'} />
      </View>

      {/* Activity Chart */}
      <Text variant="titleMedium" style={styles.sectionTitle}>{t('stats.activity')}</Text>
      {activity && activity.length > 0 ? (
        <View style={[styles.chartContainer, { backgroundColor: theme.colors.surface }]}>
          <BarChart
            data={activityData}
            width={screenWidth - spacing.lg * 2}
            height={220}
            yAxisLabel=""
            yAxisSuffix=""
            chartConfig={{
              ...CHART_CONFIG,
              color: (opacity = 1) => `rgba(118, 75, 162, ${opacity})`,
            }}
            style={styles.chart}
            fromZero
            showValuesOnTopOfBars
          />
        </View>
      ) : (
        <Text style={styles.noData}>{t('stats.noActivity')}</Text>
      )}

      {/* Film Distribution */}
      <Text variant="titleMedium" style={styles.sectionTitle}>{t('stats.topFilms')}</Text>
      {filmData.length > 0 ? (
        <View style={[styles.chartContainer, { backgroundColor: theme.colors.surface }]}>
          <PieChart
            data={filmData}
            width={screenWidth - spacing.lg * 2}
            height={200}
            chartConfig={CHART_CONFIG}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="15"
            absolute
          />
        </View>
      ) : (
        <Text style={styles.noData}>{t('stats.noFilmData')}</Text>
      )}

      {/* Camera Usage */}
      <Text variant="titleMedium" style={styles.sectionTitle}>{t('stats.topCameras')}</Text>
      {cameraData.length > 0 ? (
        <View style={[styles.chartContainer, { backgroundColor: theme.colors.surface }]}>
          <PieChart
            data={cameraData}
            width={screenWidth - spacing.lg * 2}
            height={200}
            chartConfig={CHART_CONFIG}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="15"
            absolute
          />
        </View>
      ) : (
        <Text style={styles.noData}>{t('stats.noCameraData')}</Text>
      )}

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

function StatCard({ label, value }: any) {
  const theme = useTheme();
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{label}</Text>
        <Text variant="titleLarge">{value}</Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm, fontWeight: 'bold' as const },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  card: { flex: 1, marginBottom: spacing.md, borderRadius: radius.md },
  chartContainer: {
    borderRadius: radius.md,
    padding: spacing.sm,
    elevation: 2,
    alignItems: 'center',
    overflow: 'hidden'
  },
  chart: {
    borderRadius: radius.md,
    marginVertical: 8,
  },
  noData: {
    color: '#888',
    fontStyle: 'italic',
    marginBottom: spacing.md
  }
});
