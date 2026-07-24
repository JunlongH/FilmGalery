import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { BookMarked, Pencil, Trash2, ChevronLeft } from 'lucide-react';
import { getAlbum, getAlbumPhotos, deleteAlbum } from '../../../api';
import { getCacheStrategy } from '../../../lib';
import PhotoGrid from '../../PhotoGrid';
import AlbumEditModal from './AlbumEditModal';

export default function AlbumDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);

  const { data: album } = useQuery({
    queryKey: ['album', Number(id)],
    queryFn: () => getAlbum(id),
    ...getCacheStrategy('digitalAlbums'),
  });

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['album-photos', Number(id)],
    queryFn: () => getAlbumPhotos(id),
    ...getCacheStrategy('digitalPhotos'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAlbum(id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      navigate('/albums');
    },
  });

  function handleDelete() {
    if (window.confirm(`Delete album "${album?.title}"? Photos will not be deleted.`)) {
      deleteMutation.mutate();
    }
  }

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['album', Number(id)] });
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      <button
        onClick={() => navigate('/albums')}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Albums
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{album?.title || '...'}</h2>
          {album?.description && (
            <p className="text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">{album.description}</p>
          )}
          <p className="text-zinc-400 dark:text-zinc-500 mt-1">{photos.length} photos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="flat" size="sm" onPress={() => setShowEdit(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="flat" color="danger" size="sm" onPress={handleDelete} isLoading={deleteMutation.isPending}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      {!isLoading && photos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
            <BookMarked className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">This Album is Empty</h3>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md">
            Import photos and add them to this album.
          </p>
          <Button color="primary" variant="flat" className="mt-4" onPress={() => navigate('/digital-import')}>
            Import Photos
          </Button>
        </div>
      ) : (
        <PhotoGrid photos={photos} />
      )}

      {album && (
        <AlbumEditModal album={album} isOpen={showEdit} onClose={() => setShowEdit(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
