import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Dimensions } from 'react-native';
import { ActivityIndicator, Card, Text, useTheme, IconButton } from 'react-native-paper';
import { BarChart, PieChart } from 'react-native-chart-kit';
import { getStatsActivity, getStatsInventory, getStatsOverview, getStatsCosts, getStatsGear } from '../api/stats';
import { spacing, radius } from '../theme';

const screenWidth = Dimensions.get('window').width;

const CHART_CONFIG = {
  backgroundGradientFrom: '#ffffff',
  backgroundGradientTo: '#ffffff',
  color: (opacity = 1) => `rgba(102, 126, 234, ${opacity})`,
  strokeWidth: 2,
  barPercentage: 0.7,
  decimalPlaces: 0,
};

const COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe',
  '#43e97b', '#38f9d7', '#fa709a', '#fee140', '#8fd3f4', '#84fab0'
];

export default function StatsScreen({ navigation }) {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [activity, setActivity] = useState(null);
  const [costs, setCosts] = useState(null);
  const [gear, setGear] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [ov, inv, act, cs, gr] = await Promise.all([
        getStatsOverview(),
        getStatsInventory(),
        getStatsActivity(),
        getStatsCosts(),
        getStatsGear(),
      ]);
      setOverview(ov);
      setInventory(inv);
      setActivity(act);
      setCosts(cs);
      setGear(gr);
    } catch (err) {
      console.log('Failed to load stats', err);
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="refresh" onPress={load} />
      ),
    });
  }, [navigation]);

  if (loading && !overview) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator animating size="large" />
      </View>
    );
  }

  // Prepare Activity Data
  const activityData = {
    labels: (activity || []).slice(0, 6).reverse().map(a => a.month.split('-')[1]), // Last 6 months, show month number
    datasets: [{
      data: (activity || []).slice(0, 6).reverse().map(a => a.count)
    }]
  };

  // Prepare Pie Data Helper
  const preparePieData = (items, labelKey = 'name', valueKey = 'count') => {
    if (!items) return [];
    return items.slice(0, 5).map((item, index) => ({
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
      {error ? (
        <Text style={{ color: theme.colors.error, marginBottom: spacing.sm }}>{error}</Text>
      ) : null}

      {/* Overview cards */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Overview</Text>
      <View style={styles.row}>
        <StatCard label="Total rolls" value={overview?.total_rolls ?? '-'} />
        <StatCard label="Total photos" value={overview?.total_photos ?? '-'} />
      </View>
      <View style={styles.row}>
        <StatCard label="Total spending" value={overview ? `¥${Math.round(overview.total_cost || 0)}` : '-'} />
        <StatCard label="Avg / roll" value={costs && costs.summary ? `¥${Math.round((costs.summary.total_purchase + costs.summary.total_develop) / (costs.summary.roll_count || 1))}` : '-'} />
      </View>

      {/* Inventory */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Inventory</Text>
      <View style={styles.row}>
        <StatCard label="In stock" value={inventory?.value?.total_count ?? 0} />
        <StatCard label="Inventory value" value={inventory ? `¥${Math.round(inventory.value?.total_value || 0)}` : '-'} />
      </View>

      {/* Activity Chart */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Activity (Last 6 Months)</Text>
      {activity && activity.length > 0 ? (
        <View style={styles.chartContainer}>
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
        <Text style={styles.noData}>No activity data</Text>
      )}

      {/* Film Distribution */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Top Films</Text>
      {filmData.length > 0 ? (
        <View style={styles.chartContainer}>
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
        <Text style={styles.noData}>No film data</Text>
      )}

      {/* Camera Usage */}
      <Text variant="titleMedium" style={styles.sectionTitle}>Top Cameras</Text>
      {cameraData.length > 0 ? (
        <View style={styles.chartContainer}>
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
        <Text style={styles.noData}>No camera data</Text>
      )}

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

function StatCard({ label, value }) {
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
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm, fontWeight: 'bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  card: { flex: 1, marginBottom: spacing.md, borderRadius: radius.md },
  chartContainer: {
    backgroundColor: '#fff',
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
