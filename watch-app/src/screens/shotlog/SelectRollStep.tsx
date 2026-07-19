import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { api } from '../../services/api';
import { FilmItem, Film } from '../../types';

export interface FixedLensInfo {
  text: string;
  focal_length?: number;
  max_aperture?: number;
}

type CameraResult = Awaited<ReturnType<typeof api.getCamera>>;

interface SelectRollStepProps {
  onSelect: (
    roll: FilmItem,
    filmName: string,
    filmIso: string | undefined,
    fixedLensInfo: FixedLensInfo | undefined
  ) => void;
}

const SelectRollStep: React.FC<SelectRollStepProps> = ({ onSelect }) => {
  const [rolls, setRolls] = useState<FilmItem[]>([]);
  const [filmById, setFilmById] = useState<Map<number, Film>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // In-flight camera lookups keyed by equip id, kicked off when rolls load so
  // the camera is usually already fetched by the time the user taps a roll.
  const cameraPromisesRef = useRef<Map<number, Promise<CameraResult>>>(new Map());

  useEffect(() => {
    loadRolls();
  }, []);

  const loadRolls = async () => {
    try {
      setLoading(true);
      setError(null);
      // Only fetch 'loaded' items for shot logging
      const [data, films] = await Promise.all([
        api.getFilmItems('loaded'),
        api.getFilms(),
      ]);

      const map = new Map<number, Film>();
      films.forEach(f => {
        if (f.id != null) map.set(f.id, f);
      });
      setFilmById(map);
      setRolls(data);

      // Prefetch cameras in the background
      const promises = new Map<number, Promise<CameraResult>>();
      data.forEach(item => {
        if (item.camera_equip_id && !promises.has(item.camera_equip_id)) {
          promises.set(item.camera_equip_id, api.getCamera(item.camera_equip_id));
        }
      });
      cameraPromisesRef.current = promises;
    } catch (err: any) {
      console.error('Failed to load rolls:', err);
      setError(err.message || 'Failed to load rolls');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRoll = async (roll: FilmItem) => {
    const film = roll.film_id ? filmById.get(roll.film_id) : undefined;
    // Film name already contains full information (brand + model)
    const filmName = roll.film_type || roll.film_name || film?.name || 'Unknown Film';
    const filmIsoRaw = roll.iso || (film?.iso != null ? String(film.iso) : undefined);

    // Check if camera has fixed lens
    let fixedLensInfo: FixedLensInfo | undefined;
    if (roll.camera_equip_id) {
      try {
        const cameraPromise =
          cameraPromisesRef.current.get(roll.camera_equip_id) ??
          api.getCamera(roll.camera_equip_id);
        const camera = await cameraPromise;
        if (camera?.has_fixed_lens) {
          const lensText = camera.fixed_lens_focal_length
            ? `${camera.fixed_lens_focal_length}mm${camera.fixed_lens_max_aperture ? ` f/${camera.fixed_lens_max_aperture}` : ''}`
            : 'Fixed Lens';
          fixedLensInfo = {
            text: lensText,
            focal_length: camera.fixed_lens_focal_length,
            max_aperture: camera.fixed_lens_max_aperture,
          };
        }
      } catch (e) {
        console.warn('Failed to fetch camera info for fixed lens check', e);
      }
    }

    onSelect(roll, filmName, filmIsoRaw, fixedLensInfo);
  };

  const renderItem = ({ item }: { item: FilmItem }) => {
    // Prepare film type display
    const film = item.film_id ? filmById.get(item.film_id) : undefined;
    // Film name already contains full information (brand + model)
    const filmType = film?.name || item.film_name || item.film_type || 'Unknown Film';
    const cameraInfo = item.loaded_camera || 'Camera';
    const isoValue = item.iso || (film?.iso != null ? String(film.iso) : undefined);
    const formatValue = film?.format && film.format !== '135' ? ` • ${film.format}` : '';
    const isoInfo = isoValue ? ` ISO ${isoValue}${formatValue}` : '';

    return (
      <TouchableOpacity
        style={styles.rollItem}
        onPress={() => handleSelectRoll(item)}
      >
        <Text style={styles.rollTitle}>#{item.id}</Text>
        <Text style={styles.rollSubtitle}>
          {filmType}{isoInfo}
        </Text>
        <Text style={styles.rollCamera}>
          {cameraInfo}
        </Text>
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
          <Text style={styles.emptyText}>No active rolls found</Text>
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
  rollItem: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rollTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  rollSubtitle: {
    color: '#999',
    fontSize: 12,
    marginBottom: 2,
  },
  rollCamera: {
    color: '#666',
    fontSize: 11,
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

export default SelectRollStep;
