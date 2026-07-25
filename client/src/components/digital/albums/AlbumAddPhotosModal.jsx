import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Spinner,
} from '@heroui/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { searchPhotos, addAlbumPhotos, buildUploadUrl } from '../../../api';
import { getCacheStrategy } from '../../../lib';

const PAGE_SIZE = 60;

function thumbUrl(photo) {
  const candidate = photo.positive_thumb_rel_path
    || photo.thumb_rel_path
    || photo.positive_rel_path
    || photo.full_rel_path
    || photo.filename
    || null;
  return buildUploadUrl(candidate);
}

export default function AlbumAddPhotosModal({ albumId, existingIds, isOpen, onClose }) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (isOpen) {
      setKeyword('');
      setSearch('');
      setPage(1);
      setSelected(new Set());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setTimeout(() => {
      setSearch(keyword.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword, isOpen]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['album-photo-picker', search, page],
    queryFn: () => searchPhotos({ mode: 'digital', page, pageSize: PAGE_SIZE, q: search || undefined }),
    enabled: isOpen,
    ...getCacheStrategy('digitalPhotos'),
  });

  const photos = useMemo(() => (data && Array.isArray(data.data) ? data.data : []), [data]);
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  const addMutation = useMutation({
    mutationFn: (photoIds) => addAlbumPhotos(albumId, photoIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      queryClient.invalidateQueries({ queryKey: ['album-photos', albumId] });
      onClose();
    },
  });

  function toggle(photo) {
    if (existingIds?.has(photo.id)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(photo.id)) {
        next.delete(photo.id);
      } else {
        next.add(photo.id);
      }
      return next;
    });
  }

  function handleSubmit() {
    if (selected.size === 0) return;
    addMutation.mutate([...selected]);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>Add photos</ModalHeader>
        <ModalBody>
          <Input
            value={keyword}
            onValueChange={setKeyword}
            placeholder="Search photos (filename / caption / location)"
            startContent={<Search className="w-4 h-4 text-zinc-400" />}
            isClearable
            className="mb-3"
          />
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" color="primary" />
            </div>
          ) : photos.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {search ? `No photos matching "${search}"` : 'No digital photos yet — import some first.'}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {photos.map(photo => {
                const disabled = !!existingIds?.has(photo.id);
                const checked = selected.has(photo.id);
                const url = thumbUrl(photo);
                return (
                  <button
                    key={photo.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(photo)}
                    className={[
                      'relative aspect-square rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-800',
                      disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-90',
                      checked ? 'ring-2 ring-primary ring-offset-1 ring-offset-white dark:ring-offset-zinc-900' : '',
                    ].join(' ')}
                  >
                    {url && (
                      <img
                        src={url}
                        alt={photo.caption || ''}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {disabled && (
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        Added
                      </span>
                    )}
                    {checked && (
                      <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-white">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ModalBody>
        <ModalFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="flat"
              isDisabled={page <= 1 || isFetching}
              onPress={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              Page {page} · {total} photos
            </span>
            <Button
              size="sm"
              variant="flat"
              isDisabled={!hasMore || isFetching}
              onPress={() => setPage(p => p + 1)}
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button
              color="primary"
              isLoading={addMutation.isPending}
              isDisabled={selected.size === 0}
              onPress={handleSubmit}
            >
              {selected.size > 0 ? `Add ${selected.size} photos` : 'Add photos'}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
