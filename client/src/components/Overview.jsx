import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRolls, searchPhotos } from '../api';
import HeroRandomPhotos from './HeroRandomPhotos';
import FilterPanel from './FilterPanel';
import RollGrid from './RollGrid';
import PhotoGrid from './PhotoGrid';
import { motion } from 'framer-motion';

export default function Overview() {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({});
  const [mode, setMode] = useState('rolls'); // 'rolls' | 'photos'

  // stabilize filters for react-query key: sort arrays
  const stableFilters = React.useMemo(() => {
    const out = {};
    Object.entries(filters || {}).forEach(([k,v]) => {
      if (Array.isArray(v)) out[k] = [...v].sort(); else out[k] = v;
    });
    return out;
  }, [filters]);

  const rollsQuery = useQuery({
    queryKey: ['rolls', stableFilters],
    queryFn: () => getRolls(filters),
    enabled: mode === 'rolls'
  });
  const photosQuery = useQuery({
    queryKey: ['photos', stableFilters],
    queryFn: () => searchPhotos(filters),
    enabled: mode === 'photos'
  });

  return (
    <div style={{ padding: '0 20px 40px' }}>
      <HeroRandomPhotos />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
          <div className="segmented-control" style={{ marginRight: '8px' }}>
            <button className={`segment-btn ${mode==='rolls' ? 'active' : ''}`} onClick={() => setMode('rolls')}>Rolls</button>
            <button className={`segment-btn ${mode==='photos' ? 'active' : ''}`} onClick={() => setMode('photos')}>Photos</button>
          </div>
        </div>
        <button 
          className="fg-btn"
          onClick={() => setShowFilters(!showFilters)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filters
        </button>
      </div>

      <FilterPanel isOpen={showFilters} onChange={setFilters} />

      {(mode==='rolls' ? rollsQuery.isLoading : photosQuery.isLoading) ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading...</div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {mode==='rolls' ? (
            <RollGrid rolls={rollsQuery.data || []} />
          ) : (
            <PhotoGrid photos={photosQuery.data || []} />
          )}
        </motion.div>
      )}
    </div>
  );
}
