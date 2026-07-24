import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { Images } from 'lucide-react';
import { searchPhotos } from '../../api';
import { getCacheStrategy } from '../../lib';
import PhotoGrid from '../PhotoGrid';
import FilterChips from './FilterChips';

const STORAGE_KEY = 'fg-library-filter';

export default function LibraryView() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState(() => localStorage.getItem(STORAGE_KEY) || 'all');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, filter);
  }, [filter]);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['library-photos', filter],
    queryFn: () => searchPhotos({ mode: filter, limit: 500 }),
    ...getCacheStrategy('digitalPhotos'),
  });

  if (!isLoading && photos.length === 0) {
    return (
      <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Library</h2>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">All your photos in one place</p>
          </div>
          <FilterChips value={filter} onChange={setFilter} />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
            <Images className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No Photos Yet</h3>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-6">
            {filter === 'digital'
              ? 'Import your first digital photos to get started.'
              : filter === 'film'
                ? 'Create a roll and upload photos to see them here.'
                : 'Upload film scans or import digital photos to build your library.'}
          </p>
          {filter !== 'film' && (
            <Button color="primary" variant="flat" onPress={() => navigate('/digital-import')}>
              Import Digital Photos
            </Button>
          )}
          {filter !== 'digital' && (
            <Button color="default" variant="flat" className="ml-2" onPress={() => navigate('/rolls/new')}>
              New Roll
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Library</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{photos.length} photos</p>
        </div>
        <FilterChips value={filter} onChange={setFilter} />
      </div>
      <PhotoGrid photos={photos} />
    </div>
  );
}
