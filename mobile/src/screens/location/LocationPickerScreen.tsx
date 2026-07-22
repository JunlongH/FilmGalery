/**
 * LocationPickerScreen — full-screen modal for picking a location on the map.
 *
 * Opened via LocationPickerContext.pickLocation(initial) which returns a
 * Promise. The screen resolves the Promise on confirm (with a
 * LocationPickerValue) or cancel/goBack (with null).
 *
 * Coordinates are WGS-84 everywhere. The LeafletMap's onPick callback already
 * converts GCJ-02 → WGS-84 when using AMap tiles, so this screen always
 * works in WGS-84.
 *
 * Review findings applied:
 *   - C3: use useContext(ApiContext), not useApi (which doesn't exist)
 *   - W9: resolvedRef prevents beforeRemove + handleCancel double-resolve
 */

import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { View, TextInput, StyleSheet, SafeAreaView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { IconButton, Text, Button, Card, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import LeafletMap from '../../components/map/LeafletMap';
import { useLocationPicker } from '../../context/LocationPickerContext';
import { ApiContext } from '../../context/ApiContext';
import { searchAddress, reverseGeocode } from '@filmgallery/shared/geocoding';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';
import { getCurrentPosition } from '../../services/locationService.native';
import type { LocationPickerValue, GeocodeResult } from '@filmgallery/types';

export default function LocationPickerScreen() {
  const navigation = useNavigation();
  const { pending, resolvePick } = useLocationPicker();
  const { mapProvider, amapKey }: any = useContext(ApiContext);

  const initial = pending?.initial ?? null;
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [detail, setDetail] = useState(initial?.detail_location ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  // Prevent beforeRemove + handleCancel from calling resolvePick twice. (W9)
  const resolvedRef = useRef(false);

  const handlePick = useCallback(
    async (pickedLat: number, pickedLng: number) => {
      setLat(pickedLat);
      setLng(pickedLng);
      setReverseGeocoding(true);
      try {
        const result = await reverseGeocode(pickedLat, pickedLng, {
          provider: mapProvider,
          amapKey,
        });
        if (result.displayName) setDetail(result.displayName);
        if (result.country) setCountry(result.country);
        if (result.city) setCity(result.city);
      } finally {
        setReverseGeocoding(false);
      }
    },
    [mapProvider, amapKey]
  );

  const handleSearch = async () => {
    if (!searchText.trim()) return;
    try {
      const results = await searchAddress(searchText, {
        provider: mapProvider,
        amapKey,
        limit: 5,
      });
      setSearchResults(results);
    } catch (e) {
      console.error('LocationPicker search failed:', e);
    }
  };

  const handleSelectResult = (r: any) => {
    // Use the search result's own metadata directly — no need for a fresh
    // reverseGeocode call that might return different/empty data. (W2)
    setLat(r.latitude);
    setLng(r.longitude);
    if (r.displayName) setDetail(r.displayName);
    if (r.country) setCountry(r.country);
    if (r.city) setCity(r.city);
    setSearchText('');
    setSearchResults([]);
  };

  const handleUseMyLocation = async () => {
    const pos = await getCurrentPosition();
    if (pos) {
      handlePick(pos.latitude, pos.longitude);
    } else {
      // At least log the failure; better UX would be a toast. (W5)
      console.warn('LocationPicker: getCurrentPosition returned null (permission denied or GPS off)');
    }
  };

  // Guard: resolvePick must only fire once per screen instance.
  const doResolve = useCallback(
    (value: LocationPickerValue | null) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      resolvePick(value);
    },
    [resolvePick]
  );

  const handleConfirm = () => {
    if (!isValidLatitude(lat) || !isValidLongitude(lng)) return;
    const value: LocationPickerValue = {
      latitude: lat!,
      longitude: lng!,
      country,
      city,
      state: '',
      detail_location: detail,
      displayName: detail,
    };
    doResolve(value);
    navigation.goBack();
  };

  const handleCancel = () => {
    doResolve(null);
    navigation.goBack();
  };

  // Hardware back button / swipe back — treat as cancel. doResolve is
  // idempotent so the subsequent navigation.goBack() in handleCancel is
  // a no-op for the Promise (just dismisses the screen).
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (e.data.action.type === 'GO_BACK') {
        doResolve(null);
      }
    });
    return unsub;
  }, [navigation, doResolve]);

  const canConfirm = isValidLatitude(lat) && isValidLongitude(lng);
  const mapInitial = lat != null && lng != null ? ([lat, lng] as [number, number]) : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={handleCancel} />
        <Text variant="titleMedium" style={{ flex: 1 }}>
          选择位置
        </Text>
        <Button mode="text" onPress={handleConfirm} disabled={!canConfirm}>
          完成
        </Button>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索地址"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSearch}
        />
        <IconButton icon="magnify" onPress={handleSearch} />
        <IconButton icon="crosshairs-gps" onPress={handleUseMyLocation} />
      </View>
      {searchResults.length > 0 && (
        <Card style={styles.searchResults}>
          {searchResults.map((r, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => handleSelectResult(r)}
              style={styles.searchItem}
            >
              <Text>{r.displayName}</Text>
              <Text variant="bodySmall">
                📍 {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
              </Text>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      {/* Map */}
      <View style={{ flex: 1 }}>
        <LeafletMap
          mode="pick"
          initialLatLng={mapInitial}
          onPick={handlePick}
        />
      </View>

      {/* Bottom info card */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Card style={styles.bottomCard}>
          <Card.Content>
            {reverseGeocoding ? (
              <ActivityIndicator size="small" />
            ) : (
              <>
                <Text variant="labelSmall">
                  坐标: {lat?.toFixed(5) ?? '-'}, {lng?.toFixed(5) ?? '-'}
                </Text>
                <TextInput
                  style={styles.detailInput}
                  placeholder="详细位置"
                  value={detail}
                  onChangeText={setDetail}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={styles.cityInput}
                    placeholder="国家"
                    value={country}
                    onChangeText={setCountry}
                  />
                  <TextInput
                    style={styles.cityInput}
                    placeholder="城市"
                    value={city}
                    onChangeText={setCity}
                  />
                </View>
              </>
            )}
          </Card.Content>
        </Card>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: 56,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  searchResults: {
    marginHorizontal: 8,
    marginBottom: 4,
    maxHeight: 200,
  },
  searchItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  bottomCard: { margin: 8 },
  detailInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginVertical: 8,
    height: 40,
  },
  cityInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
  },
});
