/**
 * BrowseSection - Rolls/Photos browsing with tabs and search
 * 
 * Features:
 * - Tabs for Rolls/Photos mode
 * - Search input with debounce
 * - Filter button
 * - Results grid
 */
import React, { useState, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { 
  Tabs, 
  Tab,
  Button, 
  Chip,
  Spinner
} from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, X } from 'lucide-react';
import { getRolls, searchPhotos } from '../../api';
import { getCacheStrategy } from '../../lib';
import { useDebounce } from '../../hooks';
import RollGrid from '../RollGrid';
import PhotoGrid from '../PhotoGrid';
import FilterDrawer from './FilterDrawer';
import SearchInput from '../shared/SearchInput';

export default function BrowseSection() {
  const [mode, setMode] = useState('rolls');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState({
    camera: [],
    lens: [],
    photographer: [],
    location_id: [],
    year: [],
    ym: [],
    film: []
  });

  // 搜索防抖 - 300ms 延迟
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Stabilize filters for react-query key
  const stableFilters = useMemo(() => {
    const out = {};
    Object.entries(filters || {}).forEach(([k, v]) => {
      if (Array.isArray(v)) out[k] = [...v].sort();
      else out[k] = v;
    });
    if (debouncedSearch) out.q = debouncedSearch;
    return out;
  }, [filters, debouncedSearch]);

  const rollsQuery = useQuery({
    queryKey: ['rolls', stableFilters],
    queryFn: () => getRolls(stableFilters),
    enabled: mode === 'rolls',
    ...getCacheStrategy('rolls'),
    placeholderData: keepPreviousData,
  });

  const photosQuery = useQuery({
    queryKey: ['photos', stableFilters],
    queryFn: () => searchPhotos(stableFilters),
    enabled: mode === 'photos',
    ...getCacheStrategy('photos'),
    placeholderData: keepPreviousData,
  });

  const isLoading = mode === 'rolls' ? rollsQuery.isLoading : photosQuery.isLoading;
  const data = mode === 'rolls' ? rollsQuery.data : photosQuery.data;

  // Count active filters
  const activeFilterCount = Object.values(filters).reduce(
    (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
    0
  );

  const clearFilters = () => {
    setFilters({
      camera: [],
      lens: [],
      photographer: [],
      location_id: [],
      year: [],
      ym: [],
      film: []
    });
    setSearchQuery('');
  };

  return (
    <div>
      {/* Header with Tabs and Controls */}
      <div className="flex flex-row items-center justify-between gap-4 mb-6 whitespace-nowrap overflow-x-auto pb-2 scrollbar-hide">
        {/* Tabs */}
        <Tabs
          selectedKey={mode}
          onSelectionChange={setMode}
          color="primary"
          variant="solid"
          size="lg"
          classNames={{
            tabList: 'bg-zinc-100 dark:bg-zinc-800/50',
            tab: 'data-[selected=true]:bg-white data-[selected=true]:dark:bg-zinc-700',
          }}
        >
          <Tab 
            key="rolls" 
            title={
              <div className="flex items-center gap-2">
                <span>🎞️ Rolls</span>
              </div>
            } 
          />
          <Tab 
            key="photos" 
            title={
              <div className="flex items-center gap-2">
                <span>📷 Photos</span>
              </div>
            } 
          />
        </Tabs>

        {/* Search and Filter */}
        <div className="flex items-center gap-3">
          <SearchInput
            placeholder={`Search ${mode}...`}
            value={searchQuery}
            onChange={setSearchQuery}
            className="w-64"
          />
          
          <Button
            variant={activeFilterCount > 0 ? 'solid' : 'flat'}
            color={activeFilterCount > 0 ? 'primary' : 'default'}
            startContent={<SlidersHorizontal size={16} />}
            endContent={
              activeFilterCount > 0 && (
                <Chip size="sm" color="primary" variant="solid" className="ml-1">
                  {activeFilterCount}
                </Chip>
              )
            }
            onPress={() => setIsFilterOpen(true)}
          >
            Filters
          </Button>

          {(activeFilterCount > 0 || searchQuery) && (
            <Button
              isIconOnly
              variant="flat"
              color="danger"
              onPress={clearFilters}
            >
              <X size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* Active Filters Display */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(filters).map(([key, values]) => 
            Array.isArray(values) && values.map((value, idx) => (
              <Chip
                key={`${key}-${idx}`}
                onClose={() => {
                  const newValues = values.filter(v => v !== value);
                  setFilters(prev => ({ ...prev, [key]: newValues }));
                }}
                variant="flat"
                color="primary"
                size="sm"
              >
                {key}: {value}
              </Chip>
            ))
          )}
        </div>
      )}

      {/* Results */}
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center py-20"
          >
            <Spinner size="lg" color="primary" />
          </motion.div>
        ) : (
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {data?.length === 0 ? (
              <div className="text-center py-20 text-zinc-400 dark:text-zinc-500">
                <p className="text-lg mb-2">No {mode} found</p>
                <p className="text-sm">Try adjusting your filters or search query</p>
              </div>
            ) : mode === 'rolls' ? (
              <RollGrid rolls={data || []} horizontal />
            ) : (
              <PhotoGrid photos={data || []} horizontal />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Drawer */}
      <FilterDrawer
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        filters={filters}
        onChange={setFilters}
      />
    </div>
  );
}
