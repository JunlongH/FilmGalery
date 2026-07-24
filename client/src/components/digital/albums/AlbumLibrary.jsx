import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { BookMarked, Plus } from 'lucide-react';
import { getAlbums, buildUploadUrl } from '../../../api';
import { getCacheStrategy } from '../../../lib';
import AlbumEditModal from './AlbumEditModal';

export default function AlbumLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    ...getCacheStrategy('digitalAlbums'),
  });

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  }

  if (!isLoading && albums.length === 0) {
    return (
      <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold tracking-tight">Albums</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
            <BookMarked className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No Albums Yet</h3>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-6">
            Create albums to organize your digital photos by event, theme, or any grouping you like.
          </p>
          <Button color="primary" variant="flat" onPress={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create Album
          </Button>
        </div>
        <AlbumEditModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSaved={handleSaved} />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Albums</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{albums.length} albums</p>
        </div>
        <Button color="primary" variant="flat" size="sm" onPress={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Album
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {albums.map(album => (
          <AlbumCard key={album.id} album={album} onClick={() => navigate(`/albums/${album.id}`)} />
        ))}
      </div>

      <AlbumEditModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSaved={handleSaved} />
    </div>
  );
}

function AlbumCard({ album, onClick }) {
  const coverUrl = album.cover_thumb ? buildUploadUrl(album.cover_thumb) : null;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-xl overflow-hidden bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 hover:shadow-lg transition-shadow duration-200"
    >
      <div className="aspect-square bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={album.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookMarked className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm truncate">{album.title}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          {album.photo_count || 0} photos
          {album.date_range_start && ` · ${album.date_range_start.slice(0, 7)}`}
        </p>
      </div>
    </div>
  );
}
