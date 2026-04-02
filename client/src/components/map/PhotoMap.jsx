/**
 * PhotoMap.jsx
 * 
 * Core map component using Leaflet to display photo markers.
 * Implements clustering, custom markers, and smooth interactions.
 * Supports switching between 3D Globe view and 2D flat map.
 * 
 * @module components/map/PhotoMap
 */
import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import PhotoMarker from './PhotoMarker';
import MapPhotoPreview from './MapPhotoPreview';
import PhotoGlobe from './PhotoGlobe';
import useGeoPhotos from '../../hooks/useGeoPhotos';
import { getApiBase } from '../../api';
import { useTheme } from '../../providers';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../utils/coordTransform';

// Import Leaflet CSS
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

/**
 * Get thumbnail URL for a photo
 */
const getThumbUrl = (photo) => {
  const thumbPath = photo.positive_thumb_rel_path || photo.thumb_rel_path || photo.negative_thumb_rel_path;
  if (thumbPath) {
    const apiBase = getApiBase();
    return `${apiBase}/uploads/${thumbPath}`;
  }
  return null;
};

/**
 * Tile layer configurations
 */
const TILE_LAYERS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    name: 'Light',
    options: { maxZoom: 19, crossOrigin: 'anonymous' }
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    name: 'Dark',
    options: { maxZoom: 19, crossOrigin: 'anonymous' }
  },
  satellite: {
    // ArcGIS World Imagery (ESRI) - widely used, but may fail under strict CSP/hosting setups.
    // Add crossOrigin to reduce canvas tainting and provide maxZoom hint.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    name: 'Satellite',
    options: { maxZoom: 19, crossOrigin: 'anonymous' }
  },
};

/**
 * Amap (高德) tile layer configurations
 */
const AMAP_TILE_LAYERS = {
  light: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    attribution: '&copy; <a href="https://amap.com">高德地图</a>',
    name: '高德普通',
    options: { maxZoom: 19, subdomains: ['1', '2', '3', '4'] }
  },
  dark: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    attribution: '&copy; <a href="https://amap.com">高德地图</a>',
    name: '高德夜间',
    options: { maxZoom: 19, subdomains: ['1', '2', '3', '4'], className: 'amap-dark-tile' }
  },
  satellite: {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    attribution: '&copy; <a href="https://amap.com">高德地图</a>',
    name: '高德卫星',
    options: { maxZoom: 19, subdomains: ['1', '2', '3', '4'] }
  },
};

/**
 * Default map center (world view)
 */
const DEFAULT_CENTER = [30, 0];
const DEFAULT_ZOOM = 2;

/**
 * Custom cluster icon creator with thumbnail mosaic
 * Shows up to 4 thumbnails arranged in a grid pattern with count badge
 */
const createClusterCustomIcon = (cluster) => {
  const count = cluster.getChildCount();
  const childMarkers = cluster.getAllChildMarkers();
  
  // Get photos from markers (up to 4 for display)
  const photos = childMarkers
    .slice(0, 4)
    .map(marker => marker.options.photo)
    .filter(Boolean);
  
  // Determine size based on count
  let containerSize = 64;
  let mainSize = 48;
  let miniSize = 24;
  
  if (count >= 50) {
    containerSize = 80;
    mainSize = 56;
    miniSize = 28;
  } else if (count >= 10) {
    containerSize = 72;
    mainSize = 52;
    miniSize = 26;
  }
  
  // Build thumbnail HTML
  let thumbnailsHtml = '';
  
  if (photos.length > 0) {
    const mainPhoto = photos[0];
    const mainThumbUrl = getThumbUrl(mainPhoto);
    
    // Main center thumbnail
    if (mainThumbUrl) {
      thumbnailsHtml += `
        <div class="cluster-main-thumb" style="
          width: ${mainSize}px;
          height: ${mainSize}px;
          border-radius: 50%;
          overflow: hidden;
          border: 2px solid #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 2;
        ">
          <img src="${mainThumbUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy" />
        </div>
      `;
    }
    
    // Mini thumbnails around (up to 3)
    const miniPhotos = photos.slice(1, 4);
    const positions = [
      { top: '5%', left: '5%' },      // top-left
      { top: '5%', right: '5%' },     // top-right
      { bottom: '5%', left: '50%', transform: 'translateX(-50%)' },  // bottom-center
    ];
    
    miniPhotos.forEach((photo, index) => {
      const thumbUrl = getThumbUrl(photo);
      if (thumbUrl && positions[index]) {
        const pos = positions[index];
        const posStyle = Object.entries(pos).map(([k, v]) => `${k}:${v}`).join(';');
        thumbnailsHtml += `
          <div class="cluster-mini-thumb" style="
            width: ${miniSize}px;
            height: ${miniSize}px;
            border-radius: 50%;
            overflow: hidden;
            border: 1.5px solid #fff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            position: absolute;
            ${posStyle};
            z-index: 1;
          ">
            <img src="${thumbUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy" />
          </div>
        `;
      }
    });
  }
  
  // Count badge
  const badgeHtml = `
    <div class="cluster-count-badge" style="
      position: absolute;
      bottom: -4px;
      right: -4px;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #000;
      font-size: ${count >= 100 ? '10px' : '11px'};
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 10px;
      min-width: 20px;
      text-align: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      z-index: 3;
    ">${count}</div>
  `;

  return L.divIcon({
    html: `
      <div class="photo-cluster-mosaic" style="
        width: ${containerSize}px;
        height: ${containerSize}px;
        position: relative;
        cursor: pointer;
        transition: transform 0.15s ease;
      ">
        ${thumbnailsHtml || `<div class="cluster-fallback" style="
          width: ${mainSize}px;
          height: ${mainSize}px;
          border-radius: 50%;
          background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21,15 16,10 5,21"/>
          </svg>
        </div>`}
        ${badgeHtml}
      </div>
    `,
    className: 'photo-cluster-container',
    iconSize: L.point(containerSize, containerSize, true),
  });
};

/**
 * Map event handler component
 */
function MapEventHandler({ onBoundsChange }) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        sw_lat: bounds.getSouthWest().lat,
        sw_lng: bounds.getSouthWest().lng,
        ne_lat: bounds.getNorthEast().lat,
        ne_lng: bounds.getNorthEast().lng,
      });
    },
    zoomend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        sw_lat: bounds.getSouthWest().lat,
        sw_lng: bounds.getSouthWest().lng,
        ne_lat: bounds.getNorthEast().lat,
        ne_lng: bounds.getNorthEast().lng,
      });
    },
  });

  return null;
}

/**
 * Tile layer switcher component
 */
function TileLayerSwitcher({ currentLayer, onChange, tileLayers }) {
  return (
    <div className="map-layer-switcher">
      {Object.entries(tileLayers).map(([key, layer]) => (
        <button
          key={key}
          className={`map-layer-btn ${currentLayer === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
          title={layer.name}
        >
          {layer.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Auto-fit bounds component
 */
function FitBoundsToPhotos({ photos }) {
  const map = useMap();

  useEffect(() => {
    if (photos && photos.length > 0) {
      const validPhotos = photos.filter(p => p.latitude && p.longitude);
      if (validPhotos.length > 0) {
        const bounds = L.latLngBounds(
          validPhotos.map(p => [p.latitude, p.longitude])
        );
        // Only fit if bounds are valid and not too small
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        }
      }
    }
  }, [photos, map]);

  return null;
}

/**
 * PhotoMap Component
 * 
 * @param {Object} props
 * @param {Object} props.filters - Filter criteria
 * @param {Function} props.onPhotoClick - Callback when photo is clicked
 * @param {Object} props.selectedPhoto - Currently selected photo
 */
export default function PhotoMap({ filters, onPhotoClick, selectedPhoto }) {
  // Get current theme
  const { theme } = useTheme();

  // Map provider from settings
  const [mapProvider, setMapProvider] = useState(
    () => localStorage.getItem('map_provider') || 'osm'
  );

  // Listen for map settings changes (from MapSettings component)
  useEffect(() => {
    const handleSettingsChange = () => {
      setMapProvider(localStorage.getItem('map_provider') || 'osm');
    };
    window.addEventListener('map-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('map-settings-changed', handleSettingsChange);
  }, []);
  
  // View mode: 'globe' for 3D Earth, 'flat' for Leaflet map
  // Default to 'flat' for faster initial load and more practical use
  const [viewMode, setViewMode] = useState('flat');

  // Active tile layers based on map provider
  const activeTileLayers = mapProvider === 'amap' ? AMAP_TILE_LAYERS : TILE_LAYERS;

  // Tile layer state - initialized based on theme (dark theme -> dark map)
  const [tileLayer, setTileLayer] = useState(() => theme === 'dark' ? 'dark' : 'light');
  
  // Sync tile layer with theme changes
  useEffect(() => {
    setTileLayer(theme === 'dark' ? 'dark' : 'light');
  }, [theme]);

  // Reset tile layer when provider changes
  useEffect(() => {
    setTileLayer(theme === 'dark' ? 'dark' : 'light');
  }, [mapProvider]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Map bounds for lazy loading (future use)
  const [bounds, setBounds] = useState(null);

  // Preview popup state
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [previewPosition, setPreviewPosition] = useState(null);
  
  // Initial map position when switching from globe
  const [initialMapView, setInitialMapView] = useState({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  
  // Container ref for dimensions
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Fetch photos with geo data
  const { photos, isLoading, error, total } = useGeoPhotos({
    rollId: filters?.rollId,
    dateRange: filters?.dateRange,
    bounds: viewMode === 'flat' ? bounds : null, // Only use bounds in flat mode
  });

  // Filter photos that have valid coordinates
  // When using Amap (GCJ-02), transform WGS-84 coords from DB to GCJ-02
  const geoPhotos = useMemo(() => {
    if (!photos) return [];
    const valid = photos.filter(p => 
      p.latitude !== null && 
      p.longitude !== null && 
      !isNaN(p.latitude) && 
      !isNaN(p.longitude)
    );
    if (mapProvider !== 'amap') return valid;
    return valid.map(p => {
      const { lat, lng } = wgs84ToGcj02(p.latitude, p.longitude);
      return { ...p, latitude: lat, longitude: lng };
    });
  }, [photos, mapProvider]);

  /**
   * Handle bounds change for lazy loading
   * When using Amap (GCJ-02 tiles), convert bounds back to WGS-84 for server query
   */
  const handleBoundsChange = useCallback((newBounds) => {
    if (mapProvider === 'amap') {
      const sw = gcj02ToWgs84(newBounds.sw_lat, newBounds.sw_lng);
      const ne = gcj02ToWgs84(newBounds.ne_lat, newBounds.ne_lng);
      setBounds({ sw_lat: sw.lat, sw_lng: sw.lng, ne_lat: ne.lat, ne_lng: ne.lng });
    } else {
      setBounds(newBounds);
    }
  }, [mapProvider]);

  /**
   * Handle marker click
   */
  const handleMarkerClick = useCallback((photo, position) => {
    setPreviewPhoto(photo);
    setPreviewPosition(position);
    if (onPhotoClick) {
      onPhotoClick(photo);
    }
  }, [onPhotoClick]);

  /**
   * Close preview popup
   */
  const handleClosePreview = useCallback(() => {
    setPreviewPhoto(null);
    setPreviewPosition(null);
  }, []);
  
  /**
   * Handle zoom from globe to flat map
   */
  const handleZoomToFlat = useCallback(({ lat, lng, zoom }) => {
    setInitialMapView({
      center: [lat, lng],
      zoom: zoom || 6,
    });
    setViewMode('flat');
  }, []);

  // Current tile layer config (based on active provider)
  const currentTileLayer = activeTileLayers[tileLayer] || activeTileLayers.light;

  return (
    <div className="photo-map-wrapper" ref={containerRef}>
      {/* Loading skeleton overlay */}
      {isLoading && (
        <div className="map-loading-overlay">
          <div className="map-loading-skeleton">
            <div className="map-skeleton-globe">
              <div className="map-skeleton-pulse" />
            </div>
            <div className="map-skeleton-text">
              <div className="map-loading-spinner" />
              <span>Loading photo locations...</span>
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="map-error-message">
          <span>Failed to load photos: {error.message}</span>
        </div>
      )}
      
      {/* Empty state */}
      {!isLoading && !error && geoPhotos.length === 0 && (
        <div className="map-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <h3>No photos with location data</h3>
          <p>Upload photos with GPS coordinates or add location info manually to see them on the map.</p>
        </div>
      )}

      {/* View mode toggle */}
      <div className="map-view-toggle">
        <button
          className={`map-view-btn ${viewMode === 'globe' ? 'active' : ''}`}
          onClick={() => setViewMode('globe')}
          title="3D Globe View"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          Globe
        </button>
        <button
          className={`map-view-btn ${viewMode === 'flat' ? 'active' : ''}`}
          onClick={() => setViewMode('flat')}
          title="Flat Map View"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 3v18"/>
          </svg>
          Flat
        </button>
      </div>

      {/* Photo count badge */}
      <div className="map-photo-count">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21,15 16,10 5,21"/>
        </svg>
        <span>{geoPhotos.length} photos with location</span>
        {total > geoPhotos.length && (
          <span className="map-photo-count-total"> / {total} total</span>
        )}
      </div>

      {/* 3D Globe View */}
      {viewMode === 'globe' && geoPhotos.length > 0 && (
        <PhotoGlobe
          photos={geoPhotos}
          onPhotoClick={handleMarkerClick}
          onZoomIn={handleZoomToFlat}
          width={dimensions.width}
          height={dimensions.height}
        />
      )}

      {/* Flat Map View */}
      {viewMode === 'flat' && (
        <>
          {/* Tile layer switcher */}
          <TileLayerSwitcher 
            currentLayer={tileLayer} 
            onChange={setTileLayer}
            tileLayers={activeTileLayers}
          />

          {/* Main Map */}
          <MapContainer
            center={initialMapView.center}
            zoom={initialMapView.zoom}
            className="photo-map"
            scrollWheelZoom={true}
            zoomControl={true}
          >
            <TileLayer
              key={`${mapProvider}-${tileLayer}`}
              url={currentTileLayer.url}
              attribution={currentTileLayer.attribution}
              {...(currentTileLayer.options || {})}
              eventHandlers={{
                // If tiles fail to load (common with some providers in packaged apps),
                // automatically fallback to a safe layer and log a warning.
                tileerror: (err) => {
                  try {
                    console.warn('Tile load error for layer', tileLayer, err);
                    if (tileLayer === 'satellite') {
                      // fallback to dark layer if satellite fails
                      setTileLayer('dark');
                    }
                  } catch (e) {
                    // swallow
                  }
                }
              }}
            />

            <MapEventHandler onBoundsChange={handleBoundsChange} />
            
            {/* Auto-fit bounds on first load */}
            {!isLoading && geoPhotos.length > 0 && initialMapView.zoom === DEFAULT_ZOOM && (
              <FitBoundsToPhotos photos={geoPhotos} />
            )}

            {/* Clustered markers */}
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={createClusterCustomIcon}
              maxClusterRadius={60}
              spiderfyOnMaxZoom={true}
              disableClusteringAtZoom={16}
              showCoverageOnHover={false}
              zoomToBoundsOnClick={true}
              spiderfyDistanceMultiplier={2}
              animate={true}
              animateAddingMarkers={false}
              removeOutsideVisibleBounds={true}
              // Prevent spiderfy from closing on marker interaction
              spiderLegPolylineOptions={{ weight: 1.5, color: '#666', opacity: 0.5 }}
            >
              {geoPhotos.map((photo) => (
                <PhotoMarker
                  key={photo.id}
                  photo={photo}
                  onClick={handleMarkerClick}
                  isSelected={selectedPhoto?.id === photo.id}
                />
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </>
      )}

      {/* Photo preview popup */}
      {previewPhoto && (
        <MapPhotoPreview
          photo={previewPhoto}
          position={previewPosition}
          onClose={handleClosePreview}
        />
      )}
    </div>
  );
}
