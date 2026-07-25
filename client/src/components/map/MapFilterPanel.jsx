/**
 * MapFilterPanel.jsx
 * 
 * Filter panel for the photo map view.
 * Allows filtering by date range, roll, and location.
 * 
 * @module components/map/MapFilterPanel
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getApiBase } from '../../api';

/**
 * Fetch all rolls for the dropdown
 */
async function fetchRolls() {
  const apiBase = getApiBase();
  const response = await fetch(`${apiBase}/api/rolls`);
  if (!response.ok) throw new Error('Failed to fetch rolls');
  return response.json();
}

/**
 * MapFilterPanel Component
 * 
 * @param {Object} props
 * @param {Object} props.filters - Current filter values
 * @param {Function} props.onChange - Filter change handler
 * @param {Function} props.onClear - Clear all filters handler
 * @param {boolean} props.isOpen - Whether panel is visible (mobile)
 * @param {Function} props.onClose - Close panel handler (mobile)
 * @param {string} [props.mode] - 'film' | 'digital'; digital hides the roll filter (rolls are film-only)
 */
export default function MapFilterPanel({
  filters,
  onChange,
  onClear,
  isOpen,
  onClose,
  mode
}) {
  // Fetch rolls for dropdown (film-only; skipped in digital workspace)
  const { data: rolls = [] } = useQuery({
    queryKey: ['rolls'],
    queryFn: fetchRolls,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: mode !== 'digital',
  });

  /**
   * Handle date range change
   */
  const handleDateChange = (field, value) => {
    const newDateRange = { ...filters.dateRange } || {};
    newDateRange[field] = value || null;
    
    // Clear if both are empty
    if (!newDateRange.start && !newDateRange.end) {
      onChange({ dateRange: null });
    } else {
      onChange({ dateRange: newDateRange });
    }
  };

  /**
   * Handle roll selection change
   */
  const handleRollChange = (e) => {
    const value = e.target.value;
    onChange({ rollId: value ? parseInt(value, 10) : null });
  };

  /**
   * Check if any filters are active
   */
  const hasActiveFilters = filters.dateRange || filters.rollId || filters.locationId;

  return (
    <div className={`map-filter-panel ${isOpen ? 'open' : ''}`}>
      {/* Panel header */}
      <div className="map-filter-header">
        <h3>Filters</h3>
        <button 
          className="map-filter-close" 
          onClick={onClose}
          aria-label="Close filters"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Date range filter */}
      <div className="map-filter-section">
        <label className="map-filter-label">Date Range</label>
        <div className="map-filter-date-row">
          <input
            type="date"
            className="map-filter-input"
            value={filters.dateRange?.start || ''}
            onChange={(e) => handleDateChange('start', e.target.value)}
            placeholder="Start date"
          />
          <span className="map-filter-date-separator">to</span>
          <input
            type="date"
            className="map-filter-input"
            value={filters.dateRange?.end || ''}
            onChange={(e) => handleDateChange('end', e.target.value)}
            placeholder="End date"
          />
        </div>
      </div>

      {/* Roll selector (rolls are film-only) */}
      {mode !== 'digital' && (
        <div className="map-filter-section">
          <label className="map-filter-label">Roll</label>
          <select
            className="map-filter-select"
            value={filters.rollId || ''}
            onChange={handleRollChange}
          >
            <option value="">All Rolls</option>
            {rolls.map(roll => (
              <option key={roll.id} value={roll.id}>
                {roll.title || roll.name || `Roll #${roll.id}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Clear filters button */}
      {hasActiveFilters && (
        <button className="map-filter-clear" onClick={onClear}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Clear Filters
        </button>
      )}

      {/* Help text */}
      <div className="map-filter-help">
        <p>Use filters to narrow down photos shown on the map.</p>
        <p>Click on markers to see photo details.</p>
      </div>
    </div>
  );
}
