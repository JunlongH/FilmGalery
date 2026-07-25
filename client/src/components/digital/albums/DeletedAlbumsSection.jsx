import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { getAlbums, deleteAlbum, restoreAlbum } from '../../../api';
import { getCacheStrategy } from '../../../lib';

export default function DeletedAlbumsSection() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: allAlbums = [] } = useQuery({
    queryKey: ['albums', 'with-deleted'],
    queryFn: () => getAlbums({ include_deleted: 'true' }),
    ...getCacheStrategy('digitalAlbums'),
  });

  const deleted = allAlbums.filter(a => a.deleted_at);

  function invalidate(albumId) {
    queryClient.invalidateQueries({ queryKey: ['albums'] });
    if (albumId != null) {
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    }
  }

  const restoreMutation = useMutation({
    mutationFn: (albumId) => restoreAlbum(albumId),
    onSuccess: (_data, albumId) => invalidate(albumId),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (albumId) => deleteAlbum(albumId, true),
    onSuccess: (_data, albumId) => invalidate(albumId),
  });

  function handleHardDelete(album) {
    if (window.confirm(`Permanently delete album "${album.title}"? This cannot be undone; photos will not be deleted.`)) {
      hardDeleteMutation.mutate(album.id);
    }
  }

  if (deleted.length === 0) return null;

  const busy = restoreMutation.isPending || hardDeleteMutation.isPending;

  return (
    <div className="mt-10">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Deleted ({deleted.length})
      </button>

      {open && (
        <ul className="mt-3 space-y-2 max-w-2xl">
          {deleted.map(album => (
            <li
              key={album.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{album.title}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {album.photo_count || 0} photos
                  {album.deleted_at && ` · deleted ${album.deleted_at.slice(0, 10)}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="flat"
                  isDisabled={busy}
                  onPress={() => restoreMutation.mutate(album.id)}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="danger"
                  isDisabled={busy}
                  onPress={() => handleHardDelete(album)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete forever
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
