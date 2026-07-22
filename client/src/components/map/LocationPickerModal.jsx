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

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@heroui/react';
import GlassModal from '../ui/GlassModal';
import LocationPicker from './LocationPicker';
import GeoSearchInput from '../GeoSearchInput';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';
import { reverseGeocode } from '@filmgallery/shared/geocoding';

const TILE_STYLES = ['light', 'dark', 'satellite'];

/**
 * Read map provider config from localStorage (desktop convention).
 * The shared geocoding module is pure — config is injected here.
 */
function getMapConfig() {
  const provider = localStorage.getItem('map_provider') || 'osm';
  const amapKey = localStorage.getItem('amap_web_key') || '';
  return { provider, amapKey };
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

  // Reset state when the modal opens with a new initialValue (editing a
  // different photo while the modal was previously closed).
  useEffect(() => {
    if (isOpen) {
      setLat(initialValue?.latitude ?? null);
      setLng(initialValue?.longitude ?? null);
      setReverse(null);
      setDetail(initialValue?.detail_location ?? '');
      setCountry(initialValue?.country ?? '');
      setCity(initialValue?.city ?? '');
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
  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported by this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => handleLatLngChange(pos.coords.latitude, pos.coords.longitude),
      (err) => console.error('Geolocation failed:', err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [handleLatLngChange]);

  const cycleMapStyle = useCallback(() => {
    setMapStyle((s) => {
      const idx = TILE_STYLES.indexOf(s);
      return TILE_STYLES[(idx + 1) % TILE_STYLES.length];
    });
  }, []);

  const canConfirm = isValidLatitude(lat) && isValidLongitude(lng);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
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
      {/* Top bar: search + tile toggle + GPS */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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

      {/* Map */}
      <div className="fg-location-picker-map" style={{ height: 400, width: '100%', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <LocationPicker
          initialLatLng={initialLatLng}
          provider={mapConfig.provider}
          amapKey={mapConfig.amapKey}
          mapStyle={mapStyle}
          onLatLngChange={handleLatLngChange}
          onReverseGeocode={handleReverseGeocode}
          className="fg-location-picker-map"
        />
      </div>

      {/* Bottom info: lat/lng + detail + country/city */}
      <div className="fg-sidepanel-groupGrid cols-2" style={{ marginBottom: 8 }}>
        <div className="fg-field">
          <label className="fg-label">纬度 Latitude</label>
          <input
            type="number"
            step="0.00001"
            value={lat ?? ''}
            onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))}
            className={`fg-input ${lat != null && !isValidLatitude(lat) ? 'fg-input-error' : ''}`}
          />
        </div>
        <div className="fg-field">
          <label className="fg-label">经度 Longitude</label>
          <input
            type="number"
            step="0.00001"
            value={lng ?? ''}
            onChange={(e) => setLng(e.target.value === '' ? null : Number(e.target.value))}
            className={`fg-input ${lng != null && !isValidLongitude(lng) ? 'fg-input-error' : ''}`}
          />
        </div>
      </div>
      <div className="fg-field" style={{ marginBottom: 8 }}>
        <label className="fg-label">详细位置 / 地址</label>
        <input
          type="text"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="fg-input"
        />
      </div>
      <div className="fg-sidepanel-groupGrid cols-2">
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
    </GlassModal>
  );
}
