import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { FilmItem, ShotLog } from '../types';
import { autoDetectLocation } from '../services/location';
import { api } from '../services/api';

const ShotLogLocationScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { roll, filmName, filmIso, count, shutterSpeed, aperture, fixedLensInfo } = route.params;

  const filmDisplayName = roll?.film_type || roll?.film_name || filmName || 'Unknown Film';
  const isoDisplay = roll?.iso || filmIso;
  
  // Use fixed lens text if available, otherwise use roll.lens
  const lensForLog = fixedLensInfo?.text || roll.lens || undefined;

  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [detailLocation, setDetailLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAutoDetect = async () => {
    try {
      setDetecting(true);
      console.log('[ShotLogLocation] Starting auto-detect...');
      const location = await autoDetectLocation();
      console.log('[ShotLogLocation] Auto-detect result:', JSON.stringify(location));
      
      // Coordinates are always echoed by reverseGeocode (GeocodeResult).
      setLatitude(location.latitude.toFixed(6));
      setLongitude(location.longitude.toFixed(6));
      console.log('[ShotLogLocation] Set coords:', location.latitude, location.longitude);
      
      // Set geocoded address fields
      if (location.country) {
        setCountry(location.country);
        console.log('[ShotLogLocation] Set country:', location.country);
      }
      if (location.city) {
        setCity(location.city);
        console.log('[ShotLogLocation] Set city:', location.city);
      }
      if (location.displayName) {
        setDetailLocation(location.displayName);
        console.log('[ShotLogLocation] Set detail:', location.displayName);
      }

      // If no geocode data, show alert
      if (!location.country && !location.city && !location.displayName) {
        Alert.alert(
          'Coordinates Found',
          `Got coordinates but reverse geocoding failed.\n\nPlease check internet connection or enter address manually.`
        );
      }
    } catch (error: any) {
      console.error('[ShotLogLocation] Auto-detect error:', error);
      Alert.alert('Error', error.message || 'Failed to detect location');
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Get current shot logs
      const filmItem = await api.getFilmItem(roll.id);
      let existingLogs: ShotLog[] = [];
      if (filmItem.shot_logs) {
        try {
          existingLogs = JSON.parse(filmItem.shot_logs);
        } catch (e) {
          console.error('Failed to parse existing shot logs');
        }
      }

      // Create new shot log entry
      const newLog: ShotLog = {
        date: new Date().toISOString().split('T')[0],
        count,
        lens: lensForLog,
        aperture,
        shutter_speed: shutterSpeed,
        country: country || undefined,
        city: city || undefined,
        detail_location: detailLocation || undefined,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
      };

      // Add to existing logs
      const updatedLogs = [...existingLogs, newLog];

      // Save to server
      await api.updateFilmItemShotLogs(roll.id, updatedLogs);

      Alert.alert('Success', 'Shot log saved successfully', [
        {
          text: 'OK',
          onPress: () => navigation.navigate('Home'),
        },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save shot log');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Location</Text>
      
      <Text style={[styles.filmInfo, { marginBottom: 24 }]}>
        {filmDisplayName}{isoDisplay ? ` • ISO ${isoDisplay}` : ''}
      </Text>

      <TouchableOpacity
        style={[styles.detectButton, detecting && styles.detectButtonDisabled]}
        onPress={handleAutoDetect}
        disabled={detecting}
      >
        {detecting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Text style={styles.detectIcon}>📍</Text>
            <Text style={styles.detectButtonText}>Auto-Detect</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.label}>Country</Text>
        <TextInput
          style={styles.input}
          value={country}
          onChangeText={setCountry}
          placeholder="Optional"
          placeholderTextColor="#666"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>City</Text>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          placeholder="Optional"
          placeholderTextColor="#666"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Detail Location</Text>
        <TextInput
          style={styles.input}
          value={detailLocation}
          onChangeText={setDetailLocation}
          placeholder="Street, building, etc."
          placeholderTextColor="#666"
        />
      </View>

      <View style={styles.coordRow}>
        <View style={styles.coordSection}>
          <Text style={styles.label}>Latitude</Text>
          <TextInput
            style={styles.coordInput}
            value={latitude}
            onChangeText={setLatitude}
            placeholder="--"
            placeholderTextColor="#666"
            keyboardType="numeric"
            editable={false}
          />
        </View>
        <View style={styles.coordSection}>
          <Text style={styles.label}>Longitude</Text>
          <TextInput
            style={styles.coordInput}
            value={longitude}
            onChangeText={setLongitude}
            placeholder="--"
            placeholderTextColor="#666"
            keyboardType="numeric"
            editable={false}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>Save Shot Log</Text>
        )}
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
  filmInfo: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
  },
  detectButton: {
    backgroundColor: '#2196F3',
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 24,
  },
  detectButtonDisabled: {
    backgroundColor: '#666',
  },
  detectIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  detectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  coordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  coordSection: {
    flex: 1,
    marginHorizontal: 4,
  },
  coordInput: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 10,
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonDisabled: {
    backgroundColor: '#666',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ShotLogLocationScreen;
