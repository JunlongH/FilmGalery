/**
 * LocationPicker — inner Leaflet map for picking a coordinate.
 *
 * Renders a clickable map with a draggable marker. On click/drag, the marker
 * moves and onLatLngChange fires (WGS-84). A debounced reverse-geocode call
 * follows, reporting the address via onReverseGeocode.
 *
 * Coordinate system notes (critical):
 *   - DB and all external APIs use WGS-84.
 *   - react-leaflet latlng is WGS-84 when using OSM tiles, but AMap tiles use
 *     GCJ-02. To make the marker align with AMap tiles, we convert WGS-84 →
 *     GCJ-02 for DISPLAY, and convert the user's click/drag GCJ-02 → WGS-84
 *     for STORAGE. This is new behavior — the existing PhotoMap.jsx does NOT
 *     do this conversion (its markers are slightly offset on AMap tiles).
 *   - coordTransform returns { lat, lng } objects, NOT arrays.
 *
 * The MapResizer component addresses react-leaflet v4's known behavior where
 * MapContainer has zero height during the HeroUI modal open animation.
 * Calling map.invalidateSize() after the animation (300ms) forces a recalc.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { reverseGeocode } from '@filmgallery/shared/geocoding';
import { wgs84ToGcj02, gcj02ToWgs84 } from '@filmgallery/shared/coordTransform';
import { getTileLayerConfig } from '@filmgallery/shared/mapUtils';

// Pin icon — distinct from photo markers so the picked location is obvious.
const pinIcon = L.divIcon({
  className: 'fg-location-picker-pin',
  html: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" fill="#ef4444" stroke="white" stroke-width="1.5"/>'
      + '</svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

/**
 * Click handler — calls onPick(lat, lng) with WGS-84 coordinates.
 * When using AMap tiles, the click event returns GCJ-02 coordinates (because
 * the tile layer is in GCJ-02 space), so we convert back to WGS-84.
 */
function MapClickHandler({ onPick, provider }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      if (provider === 'amap') {
        const wgs = gcj02ToWgs84(lat, lng);
        onPick(wgs.lat, wgs.lng);
      } else {
        onPick(lat, lng);
      }
    },
  });
  return null;
}

/**
 * Force the map to recalculate its size after the modal animation completes.
 * Without this, MapContainer inside a HeroUI modal renders at zero height.
 */
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

/**
 * Pan the map to a new position when initialLatLng changes externally
 * (e.g. user clicks "use my location" and the parent updates the value).
 */
function MapPanner({ targetLatLng, provider }) {
  const map = useMap();
  useEffect(() => {
    if (!targetLatLng) return;
    const [lat, lng] = targetLatLng;
    // For AMap, convert WGS-84 → GCJ-02 so the pan target aligns with tiles.
    if (provider === 'amap') {
      const gcj = wgs84ToGcj02(lat, lng);
      map.setView([gcj.lat, gcj.lng], Math.max(map.getZoom(), 13), { animate: true });
    } else {
      map.setView([lat, lng], Math.max(map.getZoom(), 13), { animate: true });
    }
  }, [targetLatLng, provider, map]);
  return null;
}

/**
 * @param {Object} props
 * @param {[number, number]|null} props.initialLatLng - WGS-84 [lat, lng] or null.
 * @param {'osm'|'amap'} [props.provider='osm']
 * @param {string} [props.amapKey='']
 * @param {'light'|'dark'|'satellite'} [props.mapStyle='light']
 * @param {(lat: number, lng: number) => void} [props.onLatLngChange]
 * @param {(result: import('@filmgallery/types').GeocodeResult) => void} [props.onReverseGeocode]
 * @param {string} [props.className]
 */
export default function LocationPicker({
  initialLatLng,
  provider = 'osm',
  amapKey = '',
  mapStyle = 'light',
  onLatLngChange,
  onReverseGeocode,
  className = '',
}) {
  const [markerPos, setMarkerPos] = useState(initialLatLng); // WGS-84 [lat, lng] | null
  const [panTarget, setPanTarget] = useState(null); // WGS-84 [lat, lng] | null
  const debounceRef = useRef(null);

  const handlePick = useCallback((lat, lng) => {
    setMarkerPos([lat, lng]);
    setPanTarget([lat, lng]);
    if (onLatLngChange) onLatLngChange(lat, lng);

    // Debounce reverse geocode so rapid clicks/drags don't spam the API.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await reverseGeocode(lat, lng, { provider, amapKey });
        if (onReverseGeocode) onReverseGeocode(result);
      } catch (err) {
        console.error('LocationPicker reverse geocode failed:', err);
      }
    }, 300);
  }, [provider, amapKey, onLatLngChange, onReverseGeocode]);

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Convert WGS-84 marker position to GCJ-02 for display on AMap tiles.
  // coordTransform returns { lat, lng } objects (NOT arrays).
  let displayMarkerPos = markerPos;
  if (markerPos && provider === 'amap') {
    const c = wgs84ToGcj02(markerPos[0], markerPos[1]);
    displayMarkerPos = [c.lat, c.lng];
  }

  // Q4 fix: use getTileLayerConfig (not buildTileLayerUrl) to get subdomains.
  // AMap tiles use {s} sharding with numeric subdomains ['1','2','3','4'].
  // Without passing subdomains, Leaflet defaults to 'abc' → DNS failure.
  const tileConfig = getTileLayerConfig(provider, mapStyle);
  const center = displayMarkerPos || [20, 0];
  const zoom = markerPos ? 13 : 2;

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className={className}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        url={tileConfig.url}
        subdomains={tileConfig.subdomains || ['a', 'b', 'c']}
        maxZoom={tileConfig.maxZoom || 19}
        className={tileConfig.className}
      />
      <MapClickHandler onPick={handlePick} provider={provider} />
      <MapResizer />
      <MapPanner targetLatLng={panTarget} provider={provider} />
      {displayMarkerPos && (
        <Marker
          position={displayMarkerPos}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const ll = e.target.getLatLng(); // { lat, lng } in tile coordinate space
              if (provider === 'amap') {
                // Drag returns GCJ-02 (tile space) → convert to WGS-84.
                const wgs = gcj02ToWgs84(ll.lat, ll.lng);
                handlePick(wgs.lat, wgs.lng);
              } else {
                handlePick(ll.lat, ll.lng);
              }
            },
          }}
        />
      )}
    </MapContainer>
  );
}
