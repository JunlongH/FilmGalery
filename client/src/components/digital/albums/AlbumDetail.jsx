import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { BookMarked, Pencil, Trash2, ChevronLeft, Plus, Check, X } from 'lucide-react';
import {
  getAlbum, getAlbumPhotos, deleteAlbum,
  removeAlbumPhoto, setAlbumCover, sortAlbumPhotos,
} from '../../../api';
import { getCacheStrategy } from '../../../lib';
import PhotoGrid from '../../PhotoGrid';
import AlbumEditModal from './AlbumEditModal';
import AlbumAddPhotosModal from './AlbumAddPhotosModal';

export default function AlbumDetail() {
  const { id } = useParams();
  const albumId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [localPhotos, setLocalPhotos] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const dragIndexRef = useRef(null);

  const { data: album } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => getAlbum(id),
    ...getCacheStrategy('digitalAlbums'),
  });

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['album-photos', albumId],
    queryFn: () => getAlbumPhotos(id),
    ...getCacheStrategy('digitalPhotos'),
  });

  const displayPhotos = localPhotos || photos;
  const orderDirty = localPhotos !== null;
  const existingIds = useMemo(() => new Set(photos.map(p => p.id)), [photos]);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  function invalidateAlbumQueries() {
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['album-photos', albumId] });
  }

  const deleteMutation = useMutation({
    mutationFn: () => deleteAlbum(id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      navigate('/albums');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (photoId) => removeAlbumPhoto(id, photoId),
    onSuccess: (_data, photoId) => {
      setLocalPhotos(prev => (prev ? prev.filter(p => p.id !== photoId) : prev));
      invalidateAlbumQueries();
    },
  });

  const coverMutation = useMutation({
    mutationFn: (photoId) => setAlbumCover(id, photoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    },
  });

  const sortMutation = useMutation({
    mutationFn: (photoIds) => sortAlbumPhotos(id, photoIds),
    onSuccess: () => {
      setLocalPhotos(null);
      queryClient.invalidateQueries({ queryKey: ['album-photos', albumId] });
    },
  });

  function handleDelete() {
    if (window.confirm(`Delete album "${album?.title}"? Photos will not be deleted.`)) {
      deleteMutation.mutate();
    }
  }

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['albums'] });
  }

  const handleRemove = useCallback((photo) => {
    if (window.confirm('Remove this photo from the album? The photo itself will not be deleted.')) {
      removeMutation.mutate(photo.id);
    }
  }, [removeMutation.mutate]);

  function handleSaveOrder() {
    if (!localPhotos || localPhotos.length === 0) return;
    sortMutation.mutate(localPhotos.map(p => p.id));
  }

  function handleCancelOrder() {
    setLocalPhotos(null);
    setDropIndex(null);
    dragIndexRef.current = null;
  }

  const handleDrop = useCallback((e, idx) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    setDropIndex(null);
    if (from == null || from === idx) return;
    setLocalPhotos(prev => {
      const base = (prev || photosRef.current).slice();
      const [moved] = base.splice(from, 1);
      const insertAt = from < idx ? idx - 1 : idx;
      base.splice(insertAt, 0, moved);
      return base;
    });
  }, []);

  const renderTile = useCallback((photo, idx, defaultTile) => {
    return (
      <div
        className={`group relative rounded cursor-grab active:cursor-grabbing ${dropIndex === idx ? 'ring-2 ring-primary' : ''}`}
        draggable
        onDragStart={e => {
          dragIndexRef.current = idx;
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dropIndex !== idx) setDropIndex(idx);
        }}
        onDrop={e => handleDrop(e, idx)}
        onDragEnd={() => {
          dragIndexRef.current = null;
          setDropIndex(null);
        }}
      >
        {defaultTile}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="pointer-events-auto rounded bg-white/20 px-2 py-1 text-[11px] text-white hover:bg-white/40"
            onClick={e => {
              e.stopPropagation();
              coverMutation.mutate(photo.id);
            }}
          >
            Set as cover
          </button>
          <button
            type="button"
            className="pointer-events-auto rounded bg-white/20 px-2 py-1 text-[11px] text-white hover:bg-red-500/80"
            onClick={e => {
              e.stopPropagation();
              handleRemove(photo);
            }}
          >
            From album remove
          </button>
        </div>
      </div>
    );
  }, [dropIndex, handleDrop, handleRemove, coverMutation.mutate]);

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
          <p className="text-zinc-400 dark:text-zinc-500 mt-1">{displayPhotos.length} photos</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {orderDirty && (
            <>
              <Button color="primary" size="sm" onPress={handleSaveOrder} isLoading={sortMutation.isPending}>
                <Check className="w-4 h-4" /> Save order
              </Button>
              <Button variant="flat" size="sm" onPress={handleCancelOrder}>
                <X className="w-4 h-4" /> Cancel
              </Button>
            </>
          )}
          <Button color="primary" variant="flat" size="sm" onPress={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" /> Add photos
          </Button>
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
          <div className="flex items-center gap-2 mt-4">
            <Button color="primary" onPress={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" /> Add photos
            </Button>
            <Button color="primary" variant="flat" onPress={() => navigate('/digital-import')}>
              Import Photos
            </Button>
          </div>
        </div>
      ) : (
        <PhotoGrid photos={displayPhotos} renderTile={renderTile} />
      )}

      {album && (
        <AlbumEditModal album={album} isOpen={showEdit} onClose={() => setShowEdit(false)} onSaved={handleSaved} />
      )}
      <AlbumAddPhotosModal
        albumId={albumId}
        existingIds={existingIds}
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
      />
    </div>
  );
}
