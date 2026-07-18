/**
 * LifeLogContext - State management for Photo Calendar
 * Handles date navigation, photo data, and cover preferences
 */
import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, 
  eachDayOfInterval, addMonths, subMonths, addYears, subYears, setMonth 
} from 'date-fns';
import { getApiBase } from '../../api';
import { resolveThumbUrl } from '../../utils/thumbResolver';

const LifeLogContext = createContext(null);

export function LifeLogProvider({ children }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'year'
  const [selectedDay, setSelectedDay] = useState(null);
  
  // Cover photo preferences (persisted to localStorage)
  const [coverPrefs, setCoverPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('calendar_covers') || '{}');
    } catch {
      return {};
    }
  });

  const year = format(currentDate, 'yyyy');
  const month = format(currentDate, 'MM');

  // Fetch photos based on view mode
  const { data: photos = [], isLoading, error } = useQuery({
    queryKey: ['photos', year, viewMode === 'month' ? month : 'all'],
    queryFn: async () => {
      const apiBase = getApiBase();
      const url = viewMode === 'month' 
        ? `${apiBase}/api/photos?year=${year}&month=${month}`
        : `${apiBase}/api/photos?year=${year}`;
      const res = await fetch(url);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
  });

  // Group photos by date
  const photosByDay = useMemo(() => {
    const map = new Map();
    const src = Array.isArray(photos) ? photos : [];
    src.forEach(p => {
      if (!p.date_taken) return;
      const d = p.date_taken.split('T')[0];
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(p);
    });
    return map;
  }, [photos]);

  // Navigation handlers
  const handlePrev = useCallback(() => {
    if (viewMode === 'month') {
      setCurrentDate(prev => subMonths(prev, 1));
    } else {
      setCurrentDate(prev => subYears(prev, 1));
    }
  }, [viewMode]);

  const handleNext = useCallback(() => {
    if (viewMode === 'month') {
      setCurrentDate(prev => addMonths(prev, 1));
    } else {
      setCurrentDate(prev => addYears(prev, 1));
    }
  }, [viewMode]);

  const switchToMonth = useCallback((monthIndex) => {
    setCurrentDate(prev => setMonth(prev, monthIndex));
    setViewMode('month');
  }, []);

  // Cover preference management
  const saveCoverPref = useCallback((dateKey, index) => {
    setCoverPrefs(prev => {
      const newPrefs = { ...prev, [dateKey]: index };
      localStorage.setItem('calendar_covers', JSON.stringify(newPrefs));
      return newPrefs;
    });
  }, []);

  // Helper to get photo URL（统一走 thumbResolver：回退链 + updated_at 缓存键）
  const getPhotoUrl = useCallback((photo) => {
    return resolveThumbUrl(photo, 'positive');
  }, []);

  // Get days for current month view
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  // Get photos for selected day
  const selectedPhotos = useMemo(() => {
    if (!selectedDay) return [];
    return photosByDay.get(format(selectedDay, 'yyyy-MM-dd')) || [];
  }, [selectedDay, photosByDay]);

  // value memo 化：避免 provider 重渲染时所有消费者被迫重渲染
  const value = useMemo(() => ({
    // State
    currentDate,
    viewMode,
    selectedDay,
    year,
    month,
    // Actions
    setViewMode,
    setSelectedDay,
    handlePrev,
    handleNext,
    switchToMonth,
    saveCoverPref,
    // Data
    photos,
    photosByDay,
    calendarDays,
    selectedPhotos,
    coverPrefs,
    isLoading,
    error,
    // Utilities
    getPhotoUrl
  }), [
    currentDate, viewMode, selectedDay, year, month,
    setViewMode, setSelectedDay, handlePrev, handleNext, switchToMonth, saveCoverPref,
    photos, photosByDay, calendarDays, selectedPhotos, coverPrefs,
    isLoading, error, getPhotoUrl,
  ]);

  return (
    <LifeLogContext.Provider value={value}>
      {children}
    </LifeLogContext.Provider>
  );
}

export function useLifeLog() {
  const context = useContext(LifeLogContext);
  if (!context) {
    throw new Error('useLifeLog must be used within LifeLogProvider');
  }
  return context;
}

export default LifeLogContext;
