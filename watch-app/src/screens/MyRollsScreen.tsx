import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { Roll } from '../types';

const MyRollsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRolls();
  }, []);

  const loadRolls = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getRolls();
      setRolls(data);
    } catch (err: any) {
      console.error('Failed to load rolls:', err);
      setError(err.message || 'Failed to load rolls');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRoll = (roll: Roll) => {
    navigation.navigate('RollDetail', { roll });
  };

  const renderItem = ({ item }: { item: Roll }) => {
    const cameraLens = [item.camera, item.lens].filter(Boolean).join(' • ');
    const dateRange = [item.start_date, item.end_date].filter(Boolean).join(' - ');
    // Prefer explicit film_type, fallback to film_name_joined
    const filmType = item.film_type || item.film_name_joined || 'Film type unknown';

    return (
      <TouchableOpacity style={styles.card} onPress={() => handleSelectRoll(item)}>
        <View style={styles.row}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title || 'Untitled Roll'}
          </Text>
          {item.status ? (
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {filmType}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {cameraLens || 'Camera / Lens'}
        </Text>
        {dateRange ? (
          <Text style={styles.meta} numberOfLines={1}>
            {dateRange}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={loadRolls} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {rolls.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No rolls found</Text>
        </View>
      ) : (
        <FlatList
          data={rolls}
          renderItem={renderItem}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  list: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  card: {
    backgroundColor: '#121212',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  statusPill: {
    backgroundColor: '#2f4f2f',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    color: '#9be28a',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  meta: {
    color: '#9aa0a6',
    fontSize: 11,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 16,
  },
  errorText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
  },
});

export default MyRollsScreen;
