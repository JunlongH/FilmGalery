/**
 * MapPhotoPreview.jsx
 * 
 * Popup preview component shown when a photo marker is clicked.
 * Displays photo thumbnail, metadata, and navigation link.
 * 
 * @module components/map/MapPhotoPreview
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { resolveThumbUrl } from '../../utils/thumbResolver';

/**
 * Get the full image URL for preview
 */
const getPreviewUrl = (photo) => resolveThumbUrl(photo, 'positive');

/**
 * Format date for display
 */
const formatDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

/**
 * MapPhotoPreview Component
 * 
 * @param {Object} props
 * @param {Object} props.photo - Photo data
 * @param {Object} props.position - Screen position {x, y}
 * @param {Function} props.onClose - Close handler
 */
export default function MapPhotoPreview({ photo, position, onClose }) {
  if (!photo) return null;

  const previewUrl = getPreviewUrl(photo);
  const dateTaken = formatDate(photo.date_taken || photo.taken_at);

  // Build location string
  const locationParts = [
    photo.detail_location,
    photo.city,
    photo.country,
  ].filter(Boolean);
  const locationStr = locationParts.join(', ');

  return (
    <div 
      className="map-photo-preview"
      style={{
        // Position near the click point, but ensure it stays in viewport
        left: Math.min(position?.x || 100, window.innerWidth - 280),
        top: Math.min(position?.y || 100, window.innerHeight - 320),
      }}
    >
      {/* Close button */}
      <button className="map-preview-close" onClick={onClose} aria-label="Close preview">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Photo preview */}
      <div className="map-preview-image">
        {previewUrl ? (
          <img src={previewUrl} alt="" loading="eager" />
        ) : (
          <div className="map-preview-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21,15 16,10 5,21"/>
            </svg>
          </div>
        )}
      </div>

      {/* Photo metadata */}
      <div className="map-preview-meta">
        {dateTaken && (
          <div className="map-preview-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>{dateTaken}</span>
          </div>
        )}

        {locationStr && (
          <div className="map-preview-location">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span>{locationStr}</span>
          </div>
        )}

        {(photo.camera || photo.lens) && (
          <div className="map-preview-gear">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span>
              {[photo.camera, photo.lens].filter(Boolean).join(' • ')}
            </span>
          </div>
        )}

        {/* Coordinates */}
        <div className="map-preview-coords">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span>
            {photo.latitude?.toFixed(4)}, {photo.longitude?.toFixed(4)}
          </span>
        </div>
      </div>

      {/* View in roll link */}
      {photo.roll_id && (
        <Link 
          to={`/rolls/${photo.roll_id}`} 
          className="map-preview-link"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          View in Roll
        </Link>
      )}
    </div>
  );
}
