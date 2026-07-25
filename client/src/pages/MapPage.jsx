/**
 * MapPage.jsx
 * 
 * Main page component for the Photo Map view.
 * Displays an interactive map with photo markers based on GPS coordinates.
 * 
 * @module pages/MapPage
 */
import React, { useState, useCallback } from 'react';
import PhotoMap from '../components/map/PhotoMap';
import MapFilterPanel from '../components/map/MapFilterPanel';
import '../styles/map.css';

/**
 * MapPage Component
 *
 * Container for the photo map view. Orchestrates filters and map display.
 * mode: 'film' | 'digital' — forwarded to the geo photos query so each
 * workspace's map stays pure.
 */
export default function MapPage({ mode }) {
  // Filter state
  const [filters, setFilters] = useState({
    dateRange: null, // { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
    rollId: null,
    locationId: null,
  });

  // Selected photo for preview
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  // Filter panel visibility (for mobile)
  const [showFilters, setShowFilters] = useState(false);

  /**
   * Handle filter changes from the filter panel
   */
  const handleFilterChange = useCallback((newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  /**
   * Handle photo marker click
   */
  const handlePhotoClick = useCallback((photo) => {
    setSelectedPhoto(photo);
  }, []);

  /**
   * Clear all filters
   */
  const handleClearFilters = useCallback(() => {
    setFilters({
      dateRange: null,
      rollId: null,
      locationId: null,
    });
  }, []);

  return (
    <div className="map-page">
      {/* Filter Toggle Button (Mobile) */}
      <button 
        className="map-filter-toggle"
        onClick={() => setShowFilters(!showFilters)}
        aria-label="Toggle filters"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        Filters
      </button>

      {/* Filter Panel */}
      <MapFilterPanel
        filters={filters}
        onChange={handleFilterChange}
        onClear={handleClearFilters}
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        mode={mode}
      />

      {/* Map Container */}
      <div className="map-container">
        <PhotoMap
          filters={filters}
          onPhotoClick={handlePhotoClick}
          selectedPhoto={selectedPhoto}
          mode={mode}
        />
      </div>

      {/* Photo count indicator */}
      <div className="map-status-bar">
        <span className="map-status-text">
          Drag and zoom to explore your photos
        </span>
      </div>
    </div>
  );
}
