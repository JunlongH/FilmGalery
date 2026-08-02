import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { BookMarked, Pencil, Trash2, ChevronLeft, Plus, Check, X, Square, CheckSquare, ArrowDownUp, Upload, ChevronRight } from 'lucide-react';
import {
  getAlbum, getAlbums, getAlbumPhotos, deleteAlbum,
  removeAlbumPhoto, setAlbumCover, sortAlbumPhotos,
  updatePhoto, getTags,
} from '../../../api';
import { getCacheStrategy } from '../../../lib';
import { groupPhotosByDate } from '../../../lib/dateGroups';
import PhotoGrid from '../../PhotoGrid';
import PhotoItem from '../../PhotoItem';
import TagEditModal from '../../TagEditModal';
import ImageViewer from '../../common/LazyImageViewer';
import PhotoDetailsSidebar from '../../PhotoDetailsSidebar';
import AlbumEditModal from './AlbumEditModal';
import AlbumAddPhotosModal from './AlbumAddPhotosModal';
import AlbumCard from './AlbumCard';

export default function AlbumDetail() {
  const { id } = useParams();
  const albumId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [localPhotos, setLocalPhotos] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [coverFeedback, setCoverFeedback] = useState(null);
  const [sortMode, setSortMode] = useState('date');
  const [groupBy, setGroupBy] = useState('month');
  const [reversed, setReversed] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [batchEditPhotos, setBatchEditPhotos] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [editingTagsPhoto, setEditingTagsPhoto] = useState(null);
  const dragIndexRef = useRef(null);
  const coverFeedbackTimer = useRef(null);

  useEffect(() => () => clearTimeout(coverFeedbackTimer.current), []);

  useEffect(() => {
    if (!coverFeedback) return;
    clearTimeout(coverFeedbackTimer.current);
    coverFeedbackTimer.current = setTimeout(() => setCoverFeedback(null), 4000);
  }, [coverFeedback]);

  useEffect(() => {
    setLocalPhotos(null);
    setDropIndex(null);
    setViewerIndex(null);
    dragIndexRef.current = null;
  }, [sortMode]);

  const { data: album } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => getAlbum(id),
    ...getCacheStrategy('digitalAlbums'),
  });

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['album-photos', albumId, sortMode],
    queryFn: () => getAlbumPhotos(id, sortMode === 'date' ? { sort: 'date_taken' } : undefined),
    ...getCacheStrategy('digitalPhotos'),
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
    ...getCacheStrategy('tags'),
  });

  const { data: albums = [] } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    ...getCacheStrategy('digitalAlbums'),
  });

  const displayPhotos = localPhotos || photos;
  const orderedPhotos = useMemo(
    () => reversed ? [...displayPhotos].reverse() : displayPhotos,
    [displayPhotos, reversed],
  );
  const orderDirty = sortMode === 'manual' && localPhotos !== null;
  const existingIds = useMemo(() => new Set(photos.map(p => p.id)), [photos]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const dragEnabled = sortMode === 'manual' && !selectionMode && !reversed;

  const children = useMemo(
    () => albums.filter(a => Number(a.parent_id) === albumId),
    [albums, albumId],
  );

  const ancestors = useMemo(() => {
    const byId = new Map(albums.map(a => [a.id, a]));
    const chain = [];
    let cur = byId.get(albumId);
    while (cur && cur.parent_id != null) {
      const parent = byId.get(cur.parent_id);
      if (!parent) break;
      chain.unshift(parent);
      cur = parent;
      if (chain.length > 32) break;
    }
    return chain;
  }, [albums, albumId]);

  function handleBack() {
    if (album?.parent_id != null) navigate(`/albums/${album.parent_id}`);
    else navigate('/albums');
  }

  const dateSections = useMemo(() => {
    if (sortMode !== 'date') return [];
    const raw = groupPhotosByDate(orderedPhotos, groupBy, 'Unknown date');
    let offset = 0;
    return raw.map(s => {
      const out = { ...s, startIndex: offset };
      offset += s.photos.length;
      return out;
    });
  }, [orderedPhotos, groupBy, sortMode]);

  function invalidateAlbumQueries() {
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    queryClient.invalidateQueries({ queryKey: ['album-photos'] });
  }

  function clearSelection() {
    setSelection(new Set());
    setSelectionMode(false);
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

  const removeBatchMutation = useMutation({
    mutationFn: async (ids) => {
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map(pid => removeAlbumPhoto(id, pid)));
      }
    },
    onSuccess: () => {
      setLocalPhotos(null);
      invalidateAlbumQueries();
      clearSelection();
    },
  });

  const coverMutation = useMutation({
    mutationFn: (photoId) => setAlbumCover(id, photoId),
    onSuccess: async () => {
      setCoverFeedback({ type: 'success', text: 'Cover updated' });
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      await queryClient.invalidateQueries({ queryKey: ['albums'], refetchType: 'all' });
    },
    onError: (err) => {
      setCoverFeedback({ type: 'error', text: `Failed to set cover: ${err?.message || 'unknown error'}` });
    },
  });

  const sortMutation = useMutation({
    mutationFn: (photoIds) => sortAlbumPhotos(id, photoIds),
    onSuccess: () => {
      setLocalPhotos(null);
      setDropIndex(null);
      queryClient.invalidateQueries({ queryKey: ['album-photos', albumId] });
    },
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ id: photoId, data }) => updatePhoto(photoId, data),
    onSuccess: (_res, { data }) => {
      if (data.tags) {
        queryClient.invalidateQueries({ queryKey: ['tags'] });
        window.dispatchEvent(new Event('refresh-tags'));
      }
      invalidateAlbumQueries();
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

  const handleRemovePhoto = useCallback((photoId) => {
    if (window.confirm('Remove this photo from the album? The photo itself will not be deleted.')) {
      removeMutation.mutate(photoId);
    }
  }, [removeMutation.mutate]);

  const handleSetCover = useCallback((photoId) => {
    coverMutation.mutate(photoId);
  }, [coverMutation.mutate]);

  function toggleSelectionMode() {
    setSelectionMode(prev => !prev);
    setSelection(new Set());
  }

  function handleBatchEdit() {
    const selected = displayPhotos.filter(p => selection.has(p.id));
    if (selected.length === 0) return;
    setBatchEditPhotos(selected);
  }

  function handleBatchRemove() {
    const ids = [...selection];
    if (ids.length === 0) return;
    let msg = `Remove ${ids.length} photo(s) from this album? The photos themselves will not be deleted.`;
    if (orderDirty) msg += ' Unsaved order changes will also be discarded.';
    if (window.confirm(msg)) {
      removeBatchMutation.mutate(ids);
    }
  }

  function handleSaveOrder() {
    if (!localPhotos || localPhotos.length === 0) return;
    sortMutation.mutate(localPhotos.map(p => p.id));
  }

  function handleCancelOrder() {
    setLocalPhotos(null);
    setDropIndex(null);
    dragIndexRef.current = null;
  }

  function changeSortMode(next) {
    if (next === sortMode) return;
    if (orderDirty && !window.confirm('Discard unsaved order changes?')) return;
    setSortMode(next);
  }

  const handleDragStart = useCallback((idx) => (e) => {
    dragIndexRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((idx) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(prev => prev === idx ? prev : idx);
  }, []);

  const handleDrop = useCallback((idx) => (e) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    setDropIndex(null);
    dragIndexRef.current = null;
    if (from == null || from === idx) return;
    setLocalPhotos(prev => {
      const base = (prev || photosRef.current).slice();
      const [moved] = base.splice(from, 1);
      const insertAt = from < idx ? idx - 1 : idx;
      base.splice(insertAt, 0, moved);
      return base;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDropIndex(null);
  }, []);

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      <button
        onClick={handleBack}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Albums
      </button>

      {ancestors.length > 0 && (
        <nav className="flex items-center flex-wrap gap-1 text-sm text-zinc-500 dark:text-zinc-400 mb-2">
          <button
            onClick={() => navigate('/albums')}
            className="hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            相册
          </button>
          {ancestors.map(a => (
            <React.Fragment key={a.id}>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
              <button
                onClick={() => navigate(`/albums/${a.id}`)}
                className="hover:text-zinc-700 dark:hover:text-zinc-200 truncate max-w-[12rem]"
              >
                {a.title}
              </button>
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{album?.title || '...'}</h2>
          {album?.description && (
            <p className="text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">{album.description}</p>
          )}
          <p className="text-zinc-400 dark:text-zinc-500 mt-1">{displayPhotos.length} photos</p>
        </div><div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
            <Button
              size="sm"
              radius="sm"
              variant={sortMode === 'manual' ? 'solid' : 'light'}
              color={sortMode === 'manual' ? 'primary' : 'default'}
              onPress={() => changeSortMode('manual')}
            >
              <ArrowDownUp className="w-3.5 h-3.5" /> Manual
            </Button>
            <Button
              size="sm"
              radius="sm"
              variant={sortMode === 'date' ? 'solid' : 'light'}
              color={sortMode === 'date' ? 'primary' : 'default'}
              onPress={() => changeSortMode('date')}
            >
              By date
            </Button>
          </div>
          <Button
            size="sm"
            variant="flat"
            color={reversed ? 'primary' : 'default'}
            isIconOnly
            onPress={() => setReversed(v => !v)}
            title="逆序"
          >
            <ArrowDownUp className="w-4 h-4" />
          </Button>
          {sortMode === 'date' && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
              <Button
                size="sm"
                radius="sm"
                variant={groupBy === 'month' ? 'solid' : 'light'}
                color={groupBy === 'month' ? 'primary' : 'default'}
                onPress={() => setGroupBy('month')}
              >
                Month
              </Button>
              <Button
                size="sm"
                radius="sm"
                variant={groupBy === 'day' ? 'solid' : 'light'}
                color={groupBy === 'day' ? 'primary' : 'default'}
                onPress={() => setGroupBy('day')}
              >
                Day
              </Button>
            </div>
          )}
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
          <Button
            size="sm"
            variant={selectionMode ? 'solid' : 'flat'}
            color={selectionMode ? 'primary' : 'default'}
            onPress={toggleSelectionMode}
          >
            {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />} Select
          </Button>
          <Button color="primary" variant="flat" size="sm" onPress={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" /> Add photos
          </Button>
          <Button variant="flat" size="sm" onPress={() => navigate(`/digital-import?album=${albumId}`)}>
            <Upload className="w-4 h-4" /> Import
          </Button>
          <Button variant="flat" size="sm" onPress={() => setShowEdit(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="flat" color="danger" size="sm" onPress={handleDelete} isLoading={deleteMutation.isPending}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      {coverFeedback && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            coverFeedback.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
        >
          {coverFeedback.text}
        </div>
      )}

      {album && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 mb-3 flex items-center gap-2">
            Sub-albums
            {children.length > 0 && (
              <span className="text-zinc-400 dark:text-zinc-500 font-normal">· {children.length}</span>
            )}
            <Button
              size="sm"
              variant="flat"
              onPress={() => setShowCreateSub(true)}
              className="ml-2 h-6 px-2 text-xs"
            >
              <Plus className="w-3.5 h-3.5" /> 新建子相册
            </Button>
          </h3>
          {children.length > 0 && (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {children.map(child => (
                <div key={child.id} className="w-40 shrink-0">
                  <AlbumCard album={child} onClick={() => navigate(`/albums/${child.id}`)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            <Button color="primary" variant="flat" onPress={() => navigate(`/digital-import?album=${albumId}`)}>
              <Upload className="w-4 h-4" /> Import Photos
            </Button>
          </div>
        </div>
      ) : selectionMode ? (
        <PhotoGrid
          photos={orderedPhotos}
          selection={selection}
          onSelectionChange={setSelection}
        />
      ) : sortMode === 'date' ? (
        <div>
          {dateSections.flatMap(section => [
            <h3
              key={`${section.key}-h`}
              className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 mt-6 mb-3 first:mt-0"
            >
              {section.label}
              <span className="ml-1.5 text-zinc-400 dark:text-zinc-500 font-normal">· {section.photos.length}</span>
            </h3>,
            <div key={`${section.key}-g`} className="photo-grid mb-6">
              {section.photos.map((p, i) => (
                <PhotoItem
                  key={p.id}
                  p={p}
                  index={section.startIndex + i}
                  viewMode="positive"
                  onSelect={(idx) => setViewerIndex(idx)}
                  onSetCover={handleSetCover}
                  onDeletePhoto={handleRemovePhoto}
                  onUpdatePhoto={(photoId, data) => updatePhotoMutation.mutate({ id: photoId, data })}
                  onEditTags={(photo) => setEditingTagsPhoto(photo)}
                  deleteLabel="Remove"
                />
              ))}
            </div>,
          ])}
        </div>
      ) : (
        <div className="photo-grid">
          {orderedPhotos.map((p, idx) => (
            <PhotoItem
              key={p.id}
              p={p}
              index={idx}
              viewMode="positive"
              onSelect={(i) => setViewerIndex(i)}
              onSetCover={handleSetCover}
              onDeletePhoto={handleRemovePhoto}
              onUpdatePhoto={(photoId, data) => updatePhotoMutation.mutate({ id: photoId, data })}
              onEditTags={(photo) => setEditingTagsPhoto(photo)}
              deleteLabel="Remove"
              draggable={dragEnabled}
              onDragStart={dragEnabled ? handleDragStart(idx) : undefined}
              onDragOver={dragEnabled ? handleDragOver(idx) : undefined}
              onDrop={dragEnabled ? handleDrop(idx) : undefined}
              onDragEnd={dragEnabled ? handleDragEnd : undefined}
              dragOver={dragEnabled && dropIndex === idx}
            />
          ))}
        </div>
      )}

      {selectionMode && selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-white dark:bg-zinc-800 shadow-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-300 mr-1">{selection.size} selected</span>
          <Button size="sm" variant="flat" onPress={handleBatchEdit}>
            <Pencil className="w-4 h-4" /> Edit info
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            isLoading={removeBatchMutation.isPending}
            onPress={handleBatchRemove}
          >
            <Trash2 className="w-4 h-4" /> Remove from album
          </Button>
          <Button size="sm" variant="light" onPress={clearSelection}>
            Cancel
          </Button>
        </div>
      )}

      {batchEditPhotos && (
        <PhotoDetailsSidebar
          key={`batch-${batchEditPhotos.map(p => p.id).join(',')}`}
          photos={batchEditPhotos}
          onClose={() => setBatchEditPhotos(null)}
          onSaved={() => {
            setBatchEditPhotos(null);
            queryClient.invalidateQueries({ queryKey: ['album-photos'] });
            clearSelection();
          }}
        />
      )}

      {album && (
        <AlbumEditModal album={album} isOpen={showEdit} onClose={() => setShowEdit(false)} onSaved={handleSaved} />
      )}
      <AlbumEditModal
        parentAlbum={album}
        isOpen={showCreateSub}
        onClose={() => setShowCreateSub(false)}
        onSaved={handleSaved}
      />
      <AlbumAddPhotosModal
        albumId={albumId}
        existingIds={existingIds}
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
      />

      {editingTagsPhoto && (
        <TagEditModal
          photo={editingTagsPhoto}
          allTags={allTags}
          onClose={() => setEditingTagsPhoto(null)}
          onSave={async (photoId, newTags) => {
            try {
              await updatePhotoMutation.mutateAsync({ id: photoId, data: { tags: newTags } });
            } catch (err) {
              console.error('[AlbumDetail] Failed to save tags:', err);
            }
            setEditingTagsPhoto(null);
          }}
        />
      )}

      {viewerIndex !== null && (
        <ImageViewer images={orderedPhotos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}
