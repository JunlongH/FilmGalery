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
import { View, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { IconButton, Text, Button, Card, ActivityIndicator, TextInput, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import LeafletMap from '../../components/map/LeafletMap';
import { useLocationPicker } from '../../context/LocationPickerContext';
import { ApiContext } from '../../context/ApiContext';
import { searchAddress, reverseGeocode } from '@filmgallery/shared/geocoding';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';
import { getCurrentPosition } from '../../services/locationService.native';
import type { LocationPickerValue } from '@filmgallery/types';

export default function LocationPickerScreen() {
  const navigation = useNavigation();
  const { pending, resolvePick } = useLocationPicker();
  const { mapProvider, amapKey }: any = useContext(ApiContext);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Guards async GPS work from touching state after unmount (back button
  // during a slow getCurrentPosition). Checked in locateAndCenter.
  const mountedRef = useRef(true);

  const initial = pending?.initial ?? null;
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [detail, setDetail] = useState(initial?.detail_location ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  // Imperative "pan the map here" channel for the GPS button / auto-locate.
  // initialLatLng is captured once by LeafletMap (to avoid WebView reloads
  // on every tap), so subsequent moves go through centerOn's nonce.
  const [centerOn, setCenterOn] = useState<{ lat: number; lng: number; zoom?: number; nonce: number } | null>(null);
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
        // Guard the async tail: if the screen unmounted while geocoding
        // (back button during a slow GPS resolve), drop the result instead
        // of setState-ing on an unmounted component.
        if (!mountedRef.current) return;
        if (result.displayName) setDetail(result.displayName);
        if (result.country) setCountry(result.country);
        if (result.city) setCity(result.city);
      } finally {
        if (mountedRef.current) setReverseGeocoding(false);
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

  // Acquire the current GPS position, persist it as the picked coordinate,
  // and imperatively pan the Leaflet map via `centerOn`. Returns success so
  // callers (button / auto-locate) can branch. Guards against unmounted
  // setState via mountedRef.
  const locateAndCenter = useCallback(async (): Promise<boolean> => {
    const pos = await getCurrentPosition();
    if (!mountedRef.current || !pos) {
      if (!pos) console.warn('LocationPicker: getCurrentPosition returned null (permission denied or GPS off)');
      return false;
    }
    handlePick(pos.latitude, pos.longitude);
    setCenterOn({ lat: pos.latitude, lng: pos.longitude, zoom: 15, nonce: Date.now() });
    return true;
  }, [handlePick]);

  // Auto-locate on entry when there is no initial coordinate (the "new
  // location" flow): the map otherwise defaults to Shanghai with no marker.
  // Runs once on mount; mountedRef prevents late state updates if the user
  // navigates away before GPS resolves.
  useEffect(() => {
    mountedRef.current = true;
    if (!initial) {
      locateAndCenter();
    }
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
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
          mode="outlined"
          dense
          placeholder="搜索地址"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSearch}
          style={styles.searchInput}
        />
        <IconButton icon="magnify" onPress={handleSearch} />
        <IconButton icon="crosshairs-gps" onPress={locateAndCenter} />
      </View>
      {searchResults.length > 0 && (
        <Card style={styles.searchResults}>
          {searchResults.map((r, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => handleSelectResult(r)}
              style={[styles.searchItem, { borderBottomColor: theme.colors.outline }]}
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
          centerOn={centerOn}
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
                  mode="outlined"
                  dense
                  placeholder="详细位置"
                  value={detail}
                  onChangeText={setDetail}
                  style={styles.detailInput}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    mode="outlined"
                    dense
                    placeholder="国家"
                    value={country}
                    onChangeText={setCountry}
                    style={styles.cityInput}
                  />
                  <TextInput
                    mode="outlined"
                    dense
                    placeholder="城市"
                    value={city}
                    onChangeText={setCity}
                    style={styles.cityInput}
                  />
                </View>
              </>
            )}
          </Card.Content>
        </Card>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  },
  bottomCard: { margin: 8 },
  detailInput: {
    marginVertical: 8,
  },
  cityInput: {
    flex: 1,
  },
});
