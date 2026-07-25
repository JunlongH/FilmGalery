/**
 * PhotoMarker.jsx
 * 
 * Custom marker component that displays photo thumbnails on the map.
 * Uses Leaflet's divIcon for custom HTML rendering.
 * 
 * @module components/map/PhotoMarker
 */
import React, { useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { resolveThumbUrl } from '../../utils/thumbResolver';

/**
 * Get the thumbnail URL for a photo
 */
const getThumbUrl = (photo) => resolveThumbUrl(photo, 'positive');

/**
 * Create a custom div icon with photo thumbnail
 * Hover effects are handled by CSS to avoid React re-renders that collapse spiderfy
 * Uses background-image for reliable center cropping of non-square thumbnails
 */
const createPhotoIcon = (photo, isSelected) => {
  const thumbUrl = getThumbUrl(photo);
  const size = isSelected ? 56 : 48;
  const borderColor = isSelected ? '#f59e0b' : '#ffffff';
  const borderWidth = isSelected ? 3 : 2;
  
  const html = thumbUrl 
    ? `<div class="photo-marker ${isSelected ? 'selected' : ''}" style="
        width: ${size}px;
        height: ${size}px;
        border: ${borderWidth}px solid ${borderColor};
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: all 0.15s ease-out;
        background-image: url('${thumbUrl}');
        background-size: cover;
        background-position: center center;
        background-repeat: no-repeat;
      "></div>`
    : `<div class="photo-marker photo-marker-placeholder ${isSelected ? 'selected' : ''}" style="
        width: ${size}px;
        height: ${size}px;
        border: ${borderWidth}px solid ${borderColor};
        transition: all 0.15s ease-out;
      ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21,15 16,10 5,21"/>
        </svg>
      </div>`;

  return L.divIcon({
    html,
    className: 'photo-marker-container',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

/**
 * PhotoMarker Component
 * 
 * Renders a photo as a custom marker on the map.
 * Hover effects are handled via CSS to avoid state updates that break spiderfy.
 * 
 * @param {Object} props
 * @param {Object} props.photo - Photo data with latitude, longitude, thumb_rel_path
 * @param {Function} props.onClick - Click handler
 * @param {boolean} props.isSelected - Whether this marker is selected
 */
export default function PhotoMarker({ photo, onClick, isSelected }) {
  // Memoize the icon to prevent unnecessary re-renders
  const icon = useMemo(() => {
    return createPhotoIcon(photo, isSelected);
  }, [photo, isSelected]);

  // Position
  const position = [photo.latitude, photo.longitude];

  /**
   * Handle marker click
   */
  const handleClick = (e) => {
    if (onClick) {
      // Pass the photo and the screen position for popup placement
      const containerPoint = e.containerPoint;
      onClick(photo, { x: containerPoint.x, y: containerPoint.y });
    }
  };

  return (
    <Marker
      position={position}
      icon={icon}
      photo={photo}
      eventHandlers={{
        click: handleClick,
      }}
    />
  );
}
