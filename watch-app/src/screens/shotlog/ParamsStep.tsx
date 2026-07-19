import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { FilmItem } from '../../types';
import { FixedLensInfo } from './SelectRollStep';

const SHUTTER_SPEEDS = [
  '1/8000', '1/4000', '1/2000', '1/1000', '1/500', '1/250', '1/125',
  '1/60', '1/30', '1/15', '1/8', '1/4', '1/2', '1"', '2"', '4"',
];

const APERTURES = [
  1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22,
];

export interface ShotParams {
  count: number;
  shutterSpeed: string;
  aperture: number | null;
}

interface ParamsStepProps {
  roll: FilmItem;
  filmName?: string;
  filmIso?: string;
  fixedLensInfo?: FixedLensInfo;
  onNext: (params: ShotParams) => void;
}

const ParamsStep: React.FC<ParamsStepProps> = ({
  roll,
  filmName,
  filmIso,
  fixedLensInfo,
  onNext,
}) => {
  const [count, setCount] = useState(1);
  const [shutterSpeed, setShutterSpeed] = useState('1/125');
  const [aperture, setAperture] = useState<number | null>(5.6);

  const handleNext = () => {
    onNext({ count, shutterSpeed, aperture });
  };

  const filmDisplayName = roll?.film_type || roll?.film_name || filmName || 'Unknown Film';
  const isoDisplay = roll?.iso || filmIso;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Shot Parameters</Text>

      <Text style={styles.rollInfo}>{roll?.title}</Text>
      <Text style={[styles.rollInfo, { fontSize: 14, marginBottom: 4, fontWeight: '600' }]}>
        {filmDisplayName}
      </Text>
      <Text style={[styles.rollInfo, { fontSize: 12, marginBottom: fixedLensInfo ? 8 : 24 }]}>
        {isoDisplay ? `ISO ${isoDisplay}` : ''} {roll?.loaded_camera ? `• ${roll.loaded_camera}` : ''}
      </Text>

      {/* Fixed Lens Indicator */}
      {fixedLensInfo && (
        <View style={styles.fixedLensIndicator}>
          <Text style={styles.fixedLensText}>🔒 {fixedLensInfo.text}</Text>
        </View>
      )}

      {/* Shot Count */}
      <View style={styles.section}>
        <Text style={styles.label}>Shot Count</Text>
        <View style={styles.counterRow}>
          <TouchableOpacity
            style={styles.counterButton}
            onPress={() => setCount(Math.max(1, count - 1))}
          >
            <Text style={styles.counterButtonText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.counterValue}>{count}</Text>
          <TouchableOpacity
            style={styles.counterButton}
            onPress={() => setCount(count + 1)}
          >
            <Text style={styles.counterButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Shutter Speed */}
      <View style={styles.section}>
        <Text style={styles.label}>Shutter Speed</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.scrollPicker}
        >
          {SHUTTER_SPEEDS.map(speed => (
            <TouchableOpacity
              key={speed}
              style={[
                styles.pickerItem,
                shutterSpeed === speed && styles.pickerItemActive,
              ]}
              onPress={() => setShutterSpeed(speed)}
            >
              <Text
                style={[
                  styles.pickerItemText,
                  shutterSpeed === speed && styles.pickerItemTextActive,
                ]}
              >
                {speed}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Aperture */}
      <View style={styles.section}>
        <Text style={styles.label}>Aperture</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.scrollPicker}
        >
          {APERTURES.map(ap => (
            <TouchableOpacity
              key={ap}
              style={[
                styles.pickerItem,
                aperture === ap && styles.pickerItemActive,
              ]}
              onPress={() => setAperture(ap)}
            >
              <Text
                style={[
                  styles.pickerItemText,
                  aperture === ap && styles.pickerItemTextActive,
                ]}
              >
                f/{ap}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
        <Text style={styles.nextButtonText}>Next</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  rollInfo: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterButton: {
    backgroundColor: '#1a1a1a',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  counterValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginHorizontal: 24,
    minWidth: 48,
    textAlign: 'center',
  },
  scrollPicker: {
    flexDirection: 'row',
  },
  pickerItem: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    marginRight: 8,
  },
  pickerItemActive: {
    backgroundColor: '#4CAF50',
  },
  pickerItemText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
  },
  pickerItemTextActive: {
    color: '#fff',
  },
  nextButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fixedLensIndicator: {
    backgroundColor: '#1a3a1a',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    alignSelf: 'center',
  },
  fixedLensText: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default ParamsStep;
