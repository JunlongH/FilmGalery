/**
 * PhotoGlobe.jsx
 * 
 * 3D Globe component for displaying photos at world-level zoom.
 * Uses react-globe.gl for spherical Earth visualization.
 * Provides a cinematic view when zoomed out to see the entire world.
 * 
 * @module components/map/PhotoGlobe
 */
import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import Globe from 'react-globe.gl';
import { resolveThumbUrl } from '../../utils/thumbResolver';

/**
 * Get thumbnail URL for a photo
 */
const getThumbUrl = (photo) => resolveThumbUrl(photo, 'positive');

/**
 * Group nearby photos into clusters for globe display
 * Uses actual average coordinates of photos in cluster for accurate positioning
 */
const clusterPhotos = (photos, gridSize = 10) => {
  const clusters = new Map();
  
  photos.forEach(photo => {
    // Create grid cell key
    const latCell = Math.floor(photo.latitude / gridSize) * gridSize;
    const lngCell = Math.floor(photo.longitude / gridSize) * gridSize;
    const key = `${latCell},${lngCell}`;
    
    if (!clusters.has(key)) {
      clusters.set(key, {
        photos: [],
        count: 0,
        sumLat: 0,
        sumLng: 0,
      });
    }
    
    const cluster = clusters.get(key);
    cluster.photos.push(photo);
    cluster.count++;
    cluster.sumLat += photo.latitude;
    cluster.sumLng += photo.longitude;
  });
  
  // Calculate average coordinates for each cluster
  return Array.from(clusters.values()).map(cluster => ({
    ...cluster,
    lat: cluster.sumLat / cluster.count,
    lng: cluster.sumLng / cluster.count,
  }));
};

/**
 * Create HTML element for globe marker
 */
const createMarkerElement = (cluster, onClick) => {
  const container = document.createElement('div');
  container.className = 'globe-marker';
  container.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid #fff;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    background: #2a2a2a;
    position: relative;
  `;
  
  // Get first photo's thumbnail
  const thumbUrl = cluster.photos[0] ? getThumbUrl(cluster.photos[0]) : null;
  
  if (thumbUrl) {
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = '';
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
    `;
    img.loading = 'lazy';
    container.appendChild(img);
  }
  
  // Add count badge if multiple photos
  if (cluster.count > 1) {
    const badge = document.createElement('div');
    badge.className = 'globe-marker-count';
    badge.textContent = cluster.count;
    badge.style.cssText = `
      position: absolute;
      top: -4px;
      right: -4px;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #000;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 10px;
      min-width: 18px;
      text-align: center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    `;
    container.appendChild(badge);
  }
  
  // Hover effects
  container.addEventListener('mouseenter', () => {
    container.style.transform = 'scale(1.2)';
    container.style.boxShadow = '0 4px 20px rgba(245, 158, 11, 0.6)';
    container.style.borderColor = '#f59e0b';
    container.style.zIndex = '1000';
  });
  
  container.addEventListener('mouseleave', () => {
    container.style.transform = 'scale(1)';
    container.style.boxShadow = '0 2px 12px rgba(0,0,0,0.5)';
    container.style.borderColor = '#fff';
    container.style.zIndex = 'auto';
  });
  
  // Store cluster data for click handler
  container.__clusterData = cluster;
  
  return container;
};

/**
 * PhotoGlobe Component
 * 
 * Renders a 3D globe with photo markers.
 * 
 * @param {Object} props
 * @param {Array} props.photos - Array of photos with lat/lng
 * @param {Function} props.onZoomIn - Called when user wants to zoom into flat map
 * @param {number} props.width - Container width
 * @param {number} props.height - Container height
 */
export default function PhotoGlobe({ 
  photos = [], 
  onZoomIn,
  width,
  height 
}) {
  const globeRef = useRef();
  const [hoveredCluster, setHoveredCluster] = useState(null);

  // Cluster photos for globe display
  const clusters = useMemo(() => {
    if (!photos || photos.length === 0) return [];
    return clusterPhotos(photos, 15); // 15-degree grid
  }, [photos]);

  // Configure globe on mount
  useEffect(() => {
    if (globeRef.current) {
      // Set initial view
      globeRef.current.pointOfView({ lat: 30, lng: 0, altitude: 2.5 }, 0);
      
      // Enable auto-rotation for visual appeal
      globeRef.current.controls().autoRotate = true;
      globeRef.current.controls().autoRotateSpeed = 0.3;
      
      // Enable smooth controls
      globeRef.current.controls().enableDamping = true;
      globeRef.current.controls().dampingFactor = 0.1;
    }
  }, []);

  // Stop auto-rotation on user interaction
  const handleInteraction = useCallback(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = false;
    }
  }, []);

  /**
   * Handle click on a marker element
   * Always navigates to flat map at the clicked location for detailed exploration
   */
  const handleElementClick = useCallback((el) => {
    const cluster = el.__clusterData;
    if (cluster && cluster.photos && cluster.photos.length > 0) {
      // Always zoom into flat map at this location
      // Use higher zoom for single photo, lower for clusters
      const zoomLevel = cluster.count === 1 ? 14 : 10;
      if (onZoomIn) {
        onZoomIn({ lat: cluster.lat, lng: cluster.lng, zoom: zoomLevel });
      }
    }
  }, [onZoomIn]);

  /**
   * Handle hover on a marker element
   */
  const handleElementHover = useCallback((el) => {
    const cluster = el ? el.__clusterData : null;
    setHoveredCluster(cluster);
    document.body.style.cursor = el ? 'pointer' : 'grab';
  }, []);

  /**
   * Create HTML element for each cluster
   */
  const htmlElementAccessor = useCallback((cluster) => {
    return createMarkerElement(cluster);
  }, []);

  return (
    <div 
      className="photo-globe-wrapper"
      onMouseDown={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <Globe
        ref={globeRef}
        width={width}
        height={height}
        globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="https://unpkg.com/three-globe/example/img/night-sky.png"
        
        // HTML Elements (photo thumbnails)
        htmlElementsData={clusters}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={0.02}
        htmlElement={htmlElementAccessor}
        onHtmlElementClick={handleElementClick}
        onHtmlElementHover={handleElementHover}
        
        // Atmosphere
        atmosphereColor="#3a82f7"
        atmosphereAltitude={0.15}
        
        // Animation
        animateIn={true}
      />
      
      {/* Zoom to flat map button */}
      <button 
        className="globe-zoom-flat-btn"
        onClick={() => onZoomIn && onZoomIn({ lat: 0, lng: 0, zoom: 3 })}
        title="Switch to flat map"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 3v18" />
        </svg>
        Flat Map
      </button>

      {/* Photo count indicator */}
      <div className="globe-photo-count">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span>{photos.length} photos across {clusters.length} locations</span>
      </div>

      {/* Hovered cluster info */}
      {hoveredCluster && (
        <div className="globe-hover-info">
          <strong>{hoveredCluster.count} photo{hoveredCluster.count > 1 ? 's' : ''}</strong>
          <span>Click to {hoveredCluster.count > 1 ? 'explore' : 'view'}</span>
        </div>
      )}
    </div>
  );
}
