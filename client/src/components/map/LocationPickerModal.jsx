/**
 * LocationPickerModal — GlassModal-wrapped LocationPicker with search bar,
 * tile toggle, GPS button, and editable lat/lng/address fields.
 *
 * State flow:
 *   1. User opens the modal with an optional initialValue (edit mode).
 *   2. User clicks the map or drags the marker → onLatLngChange fires →
 *      the lat/lng inputs update and a debounced reverseGeocode fills the
 *      address/country/city fields.
 *   3. User can also type lat/lng directly or edit the address text.
 *   4. "Confirm" assembles a LocationPickerValue and calls onConfirm.
 *
 * All coordinates are WGS-84. The confirm button is disabled when lat/lng
 * are missing or out of range (isValidLatitude/isValidLongitude).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@heroui/react';
import GlassModal from '../ui/GlassModal';
import LocationPicker from './LocationPicker';
import GeoSearchInput from '../GeoSearchInput';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';
import { getCityCoordinates, reverseGeocode } from '../../utils/geocoding';

const TILE_STYLES = ['light', 'dark', 'satellite'];

const LAST_LOCATION_KEY = 'fg_last_picked_location';

/**
 * Read map provider config from localStorage (desktop convention).
 * Q4 fix: default to 'amap' instead of 'osm' — OSM tile servers are often
 * unreachable in China, causing the map to load as blank gray tiles.
 * AMap tiles (高德) are served from Chinese CDN and are always accessible.
 * Users who explicitly set 'osm' in Settings are respected.
 */
function getMapConfig() {
  const provider = localStorage.getItem('map_provider') || 'amap';
  const amapKey = localStorage.getItem('amap_web_key') || '';
  return { provider, amapKey };
}

/**
 * Remember the last confirmed pick so the next open (without an initialValue)
 * starts there instead of the middle of the ocean ([20, 0], zoom 2).
 * Stored as {latitude, longitude, country, city} to match initialValue's
 * shape, so the open-reset code can treat both uniformly.
 */
function loadLastLocation() {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.lat === 'number' && typeof v.lng === 'number') {
      return { latitude: v.lat, longitude: v.lng, country: v.country || '', city: v.city || '' };
    }
  } catch { /* ignore corrupt entry */ }
  return null;
}
function saveLastLocation(lat, lng, country, city) {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat, lng, country, city }));
  } catch { /* storage may be unavailable (private mode) */ }
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {import('@filmgallery/types').LocationPickerValue | null} [props.initialValue]
 * @param {string} [props.title]
 * @param {(value: import('@filmgallery/types').LocationPickerValue) => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export default function LocationPickerModal({
  isOpen,
  initialValue = null,
  title = '选择位置',
  onConfirm,
  onCancel,
}) {
  const [lat, setLat] = useState(initialValue?.latitude ?? null);
  const [lng, setLng] = useState(initialValue?.longitude ?? null);
  const [reverse, setReverse] = useState(null);
  const [detail, setDetail] = useState(initialValue?.detail_location ?? '');
  const [country, setCountry] = useState(initialValue?.country ?? '');
  const [city, setCity] = useState(initialValue?.city ?? '');
  const [mapStyle, setMapStyle] = useState('light');
  const [mapConfig] = useState(getMapConfig);
  // City-jump input (separate from the address `detail` field). The user
  // types a city name, presses Enter / the jump button, and we geocode it →
  // pan the map + drop a marker there.
  const [cityQuery, setCityQuery] = useState('');
  const [cityJumping, setCityJumping] = useState(false);
  const [cityError, setCityError] = useState('');
  // Imperative pan channel for LocationPicker (city-jump + GPS). nonce makes
  // each request distinct so re-sending the same coords still re-centers.
  const [centerOn, setCenterOn] = useState(null);
  // Track the previous isOpen so we only reset the form when the modal
  // transitions closed→open. Initialized to FALSE (not isOpen) so that a
  // lazy-loaded modal that mounts already-open (lazyModal only mounts after
  // first open) still triggers the reset on its first render. For a modal
  // that mounts closed, false→false is a no-op and false→true fires normally.
  const prevIsOpenRef = useRef(false);

  // Reset state when the modal opens (closed→open, including lazy mount).
  // Falls back to the last confirmed pick when there's no initialValue, so
  // the map opens on a meaningful location instead of the middle of the
  // ocean ([20,0], zoom 2).
  //
  // Drives the resolved coords through `centerOn` (not just setLat/setLng)
  // because lazyModal may keep LocationPicker mounted across close→open
  // cycles — its markerPos/panTarget are captured at mount, so without
  // centerOn a re-open with a different initialValue leaves the map/marker
  // at the PREVIOUS position. centerOn forces a pan+marker move every open.
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;
    if (isOpen && !wasOpen) {
      const init = initialValue || loadLastLocation();
      const initLat = init?.latitude ?? null;
      const initLng = init?.longitude ?? null;
      setLat(initLat);
      setLng(initLng);
      setReverse(null);
      setDetail(initialValue?.detail_location ?? '');
      setCountry(init?.country ?? '');
      setCity(init?.city ?? '');
      setCityQuery('');
      setCityError('');
      // Pan the map + marker to the resolved location (no-op-ish on a fresh
      // mount where LocationPicker already inits to initialLatLng, but
      // essential when LocationPicker stayed mounted from a prior open).
      if (initLat != null && initLng != null) {
        setCenterOn({ lat: initLat, lng: initLng, zoom: 13, nonce: Date.now() });
      } else {
        setCenterOn(null);
      }
    }
  }, [isOpen, initialValue]);

  const handleLatLngChange = useCallback((newLat, newLng) => {
    setLat(newLat);
    setLng(newLng);
  }, []);

  const handleReverseGeocode = useCallback((result) => {
    setReverse(result);
    // Only fill fields that the user hasn't manually edited — but since we
    // can't track "manual edit" without extra state, we follow the simpler
    // rule: always overwrite with reverse-geocode results (user can re-edit).
    if (result.displayName) setDetail(result.displayName);
    if (result.country) setCountry(result.country);
    if (result.city) setCity(result.city);
  }, []);

  const handleGeoSearchSelect = useCallback((r) => {
    handleLatLngChange(r.latitude, r.longitude);
    if (r.detail || r.displayName) setDetail(r.detail || r.displayName);
    if (r.country) setCountry(r.country);
    if (r.city) setCity(r.city);
  }, [handleLatLngChange]);

  // GPS / "use my location" — defined at the modal level (review finding C2).
  // Routes through centerOn so the map pans + drops a marker (not just the
  // field update that the previous version did, which left the map static).
  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported by this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        handleLatLngChange(latitude, longitude);
        setCenterOn({ lat: latitude, lng: longitude, zoom: 15, nonce: Date.now() });
      },
      (err) => console.error('Geolocation failed:', err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [handleLatLngChange]);

  // City-jump: geocode a typed city name, then pan the map + drop a marker.
  // After arriving, reverse-geocode the destination so country/city/detail
  // fields reflect the ACTUAL place (not the pre-jump country, which would
  // be wrong for an international jump — e.g. country="中国" + city="Paris").
  // We deliberately do NOT bias the forward search by the current country
  // field — getCityCoordinates would build "Paris, 中国" and return nothing.
  const handleCityJump = useCallback(async () => {
    const q = cityQuery.trim();
    if (!q) return;
    setCityJumping(true);
    setCityError('');
    try {
      const coords = await getCityCoordinates(null, q);
      if (!coords) {
        setCityError(`未找到「${q}」，请尝试更完整的名称`);
        return;
      }
      handleLatLngChange(coords.latitude, coords.longitude);
      // Seed city with the typed query immediately (reverse-geocode below may
      // overwrite with a more precise name, or leave it if it returns none).
      setCity(q);
      setCenterOn({ lat: coords.latitude, lng: coords.longitude, zoom: 12, nonce: Date.now() });
      // Reverse-geocode the destination to fill country/city/detail with the
      // real place names (clears a stale pre-jump country, and fills detail).
      try {
        const result = await reverseGeocode(coords.latitude, coords.longitude);
        handleReverseGeocode(result);
      } catch (err) {
        // Reverse-geocode is best-effort here; the lat/lng + marker are
        // already set. Leave country/city as-is for the user to edit.
        console.error('City-jump reverse geocode failed:', err);
      }
    } catch (err) {
      console.error('City jump failed:', err);
      setCityError('跳转失败，请检查网络后重试');
    } finally {
      setCityJumping(false);
    }
  }, [cityQuery, handleLatLngChange, handleReverseGeocode]);

  const cycleMapStyle = useCallback(() => {
    setMapStyle((s) => {
      const idx = TILE_STYLES.indexOf(s);
      return TILE_STYLES[(idx + 1) % TILE_STYLES.length];
    });
  }, []);

  const canConfirm = isValidLatitude(lat) && isValidLongitude(lng);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    // Persist for next open (ocean-avoidance). Only stored on a successful
    // confirm so a cancelled/abandoned pick doesn't override the last good one.
    saveLastLocation(lat, lng, country, city);
    onConfirm({
      latitude: lat,
      longitude: lng,
      country,
      city,
      state: reverse?.state || '',
      detail_location: detail,
      displayName: detail,
    });
  }, [canConfirm, lat, lng, country, city, reverse, detail, onConfirm]);

  const initialLatLng = lat != null && lng != null ? [lat, lng] : null;

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="5xl"
      isDismissable={false}
      footer={
        <>
          <Button variant="light" onPress={onCancel}>取消</Button>
          <Button color="primary" onPress={handleConfirm} isDisabled={!canConfirm}>确认</Button>
        </>
      }
    >
      {/*
        Map-centric layout. The map uses a DEFINITE viewport-based height
        (min(58vh, 520px)) rather than flex-grow: Leaflet reads the
        container's height at MapContainer mount to size its tile pane, and a
        flex-grow container is 0 at mount (flex resolves later) → the tile
        pane stays 0x0 → blank map even though tiles download. A definite
        height avoids that entirely. The form is a compact 2 rows so the map
        dominates (~65% of the modal).
      */}
      <div>
        {/* Top bar: address search + tile toggle + GPS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <GeoSearchInput
              value={detail}
              onChange={setDetail}
              onSelect={handleGeoSearchSelect}
              placeholder="搜索地址或输入详细位置..."
            />
          </div>
          <Button size="sm" variant="flat" onPress={cycleMapStyle} title="切换地图样式">
            🗺️
          </Button>
          <Button size="sm" variant="flat" onPress={handleUseMyLocation} title="使用我的位置">
            📍
          </Button>
        </div>

        {/* City-jump: type a city name → geocode → pan + drop marker */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            className="fg-input"
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCityJump(); } }}
            placeholder="输入城市名快速跳转（如：上海、Paris）..."
            style={{ flex: 1 }}
          />
          <Button
            size="sm"
            variant="flat"
            onPress={handleCityJump}
            isDisabled={cityJumping || !cityQuery.trim()}
            title="跳转到该城市"
          >
            {cityJumping ? '⏳' : '🏙️ 跳转'}
          </Button>
        </div>
        {cityError && (
          <div style={{ marginBottom: 10, fontSize: 12, color: '#f87171' }}>{cityError}</div>
        )}

        {/* Map — definite height so Leaflet sizes its tile pane at mount */}
        <div className="fg-location-picker-map" style={{ height: 'min(58vh, 520px)', width: '100%', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          <LocationPicker
            initialLatLng={initialLatLng}
            provider={mapConfig.provider}
            amapKey={mapConfig.amapKey}
            mapStyle={mapStyle}
            onLatLngChange={handleLatLngChange}
            onReverseGeocode={handleReverseGeocode}
            centerOn={centerOn}
            className="fg-location-picker-map"
          />
        </div>

        {/*
          Compact 2-row form (was 3 rows) to maximize map space.
          Row 1: lat | lng | country | city (4 cols).
          Row 2: address (full width).
        */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            <div className="fg-field">
              <label className="fg-label">纬度</label>
              <input
                type="number"
                step="0.00001"
                value={lat ?? ''}
                onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))}
                className={`fg-input ${lat != null && !isValidLatitude(lat) ? 'fg-input-error' : ''}`}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">经度</label>
              <input
                type="number"
                step="0.00001"
                value={lng ?? ''}
                onChange={(e) => setLng(e.target.value === '' ? null : Number(e.target.value))}
                className={`fg-input ${lng != null && !isValidLongitude(lng) ? 'fg-input-error' : ''}`}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">国家</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="fg-input"
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">城市</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="fg-input"
              />
            </div>
          </div>
          <div className="fg-field">
            <label className="fg-label">详细位置 / 地址</label>
            <input
              type="text"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              className="fg-input"
            />
          </div>
        </div>
      </div>
    </GlassModal>
  );
}
