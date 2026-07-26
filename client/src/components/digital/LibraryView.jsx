import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Select, SelectItem, Spinner,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
} from '@heroui/react';
import {
  Images, Search, Heart, ChevronDown, ChevronRight, X,
  History, CheckSquare, Square, BookMarked, Trash2,
} from 'lucide-react';
import {
  searchPhotos, getPhotoFacets, getDigitalSessions,
  getAlbums, addAlbumPhotos, updatePhoto, deletePhoto, getTags,
} from '../../api';
import { getCacheStrategy } from '../../lib';
import PhotoGrid from '../PhotoGrid';
import PhotoItem from '../PhotoItem';
import TagEditModal from '../TagEditModal';
import ImageViewer from '../common/LazyImageViewer';

const PAGE_SIZE = 100;

const SORT_OPTIONS = [
  { key: 'date_desc', label: 'Date taken (new→old)', sort: 'date_taken', order: 'desc' },
  { key: 'date_asc', label: 'Date taken (old→new)', sort: 'date_taken', order: 'asc' },
  { key: 'import_desc', label: 'Import time', sort: 'id', order: 'desc' },
];

export default function LibraryView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('date_desc');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [yearsSel, setYearsSel] = useState([]);
  const [monthsSel, setMonthsSel] = useState([]);
  const [camerasSel, setCamerasSel] = useState([]);
  const [lensesSel, setLensesSel] = useState([]);
  const [sessionFilter, setSessionFilter] = useState(() => {
    const sid = searchParams.get('session_id');
    return sid ? { id: Number(sid), label: null } : null;
  });
  const [page, setPage] = useState(1);
  const [pagesMap, setPagesMap] = useState(() => new Map());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [editingTagsPhoto, setEditingTagsPhoto] = useState(null);

  const searchRef = useRef('');

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = keyword.trim();
      if (next !== searchRef.current) {
        searchRef.current = next;
        resetPages();
        setSearch(next);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const resetPages = useCallback(() => {
    setPage(1);
    setPagesMap(new Map());
  }, []);

  function toggleValue(list, setList, value) {
    resetPages();
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  }

  const sortSpec = SORT_OPTIONS.find(o => o.key === sortKey) || SORT_OPTIONS[0];
  const monthParams = useMemo(
    () => [...new Set(monthsSel.map(k => k.split('-')[1]))],
    [monthsSel]
  );

  const filtersKey = useMemo(() => JSON.stringify({
    q: search,
    sort: sortSpec.sort,
    order: sortSpec.order,
    favorite: favoriteOnly,
    year: [...yearsSel].sort(),
    month: [...monthParams].sort(),
    camera: [...camerasSel].sort(),
    lens: [...lensesSel].sort(),
    session_id: sessionFilter?.id || null,
  }), [search, sortSpec, favoriteOnly, yearsSel, monthParams, camerasSel, lensesSel, sessionFilter]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['library-photos', filtersKey, page],
    queryFn: () => searchPhotos({
      mode: 'digital',
      page,
      pageSize: PAGE_SIZE,
      q: search || undefined,
      sort: sortSpec.sort,
      order: sortSpec.order,
      favorite: favoriteOnly ? 'true' : undefined,
      year: yearsSel.length ? yearsSel.join(',') : undefined,
      month: monthParams.length ? monthParams.join(',') : undefined,
      camera: camerasSel.length ? camerasSel.join(',') : undefined,
      lens: lensesSel.length ? lensesSel.join(',') : undefined,
      session_id: sessionFilter?.id || undefined,
    }),
    ...getCacheStrategy('digitalPhotos'),
  });

  const { data: facets } = useQuery({
    queryKey: ['photo-facets', 'digital'],
    queryFn: () => getPhotoFacets({ mode: 'digital' }),
    ...getCacheStrategy('digitalPhotos'),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['digital-sessions'],
    queryFn: () => getDigitalSessions(),
    ...getCacheStrategy('digitalSessions'),
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
    ...getCacheStrategy('tags'),
  });

  useEffect(() => {
    if (!data || !Array.isArray(data.data)) return;
    setPagesMap(prev => {
      const next = new Map(prev);
      next.set(page, data.data);
      return next;
    });
  }, [data, page]);

  const photos = useMemo(() => {
    const seen = new Set();
    const arr = [];
    for (const p of [...pagesMap.keys()].sort((a, b) => a - b)) {
      for (const photo of pagesMap.get(p)) {
        if (!seen.has(photo.id)) {
          seen.add(photo.id);
          arr.push(photo);
        }
      }
    }
    return arr;
  }, [pagesMap]);

  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  const sessionLabel = useMemo(() => {
    if (!sessionFilter) return null;
    if (sessionFilter.label) return sessionFilter.label;
    const row = sessions.find(s => s.id === sessionFilter.id);
    return row?.label || row?.session_date || `Session #${sessionFilter.id}`;
  }, [sessionFilter, sessions]);

  const hasRailFilter = yearsSel.length > 0 || monthsSel.length > 0
    || camerasSel.length > 0 || lensesSel.length > 0 || favoriteOnly;

  function clearFilters() {
    resetPages();
    setYearsSel([]);
    setMonthsSel([]);
    setCamerasSel([]);
    setLensesSel([]);
    setFavoriteOnly(false);
  }

  function applyLastImport() {
    const latest = sessions[0];
    if (!latest) return;
    resetPages();
    setSessionFilter({ id: latest.id, label: latest.label || latest.session_date || `Session #${latest.id}` });
  }

  function toggleSelectionMode() {
    setSelectionMode(prev => !prev);
    setSelection(new Set());
  }

  function invalidateLibrary({ albums = false, facets = false } = {}) {
    queryClient.invalidateQueries({ queryKey: ['library-photos'] });
    if (albums) queryClient.invalidateQueries({ queryKey: ['albums'] });
    if (facets) queryClient.invalidateQueries({ queryKey: ['photo-facets'] });
  }

  const favoriteMutation = useMutation({
    mutationFn: async ({ ids, rating }) => {
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map(id => updatePhoto(id, { rating })));
      }
    },
    onSuccess: () => {
      resetPages();
      invalidateLibrary();
      setSelection(new Set());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map(id => deletePhoto(id)));
      }
    },
    onSuccess: () => {
      resetPages();
      invalidateLibrary({ albums: true, facets: true });
      setSelection(new Set());
    },
  });

  const addToAlbumMutation = useMutation({
    mutationFn: ({ albumId, ids }) => addAlbumPhotos(albumId, ids),
    onSuccess: () => {
      resetPages();
      invalidateLibrary({ albums: true });
      setSelection(new Set());
      setShowAlbumPicker(false);
    },
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ id, data }) => updatePhoto(id, data),
    onSuccess: (_res, { id, data }) => {
      if (data.tags) {
        invalidateLibrary();
        queryClient.invalidateQueries({ queryKey: ['tags'] });
        window.dispatchEvent(new Event('refresh-tags'));
      } else {
        setPagesMap(prev => {
          const next = new Map(prev);
          for (const [pg, arr] of next) {
            next.set(pg, arr.map(p => (p.id === id ? { ...p, ...data } : p)));
          }
          return next;
        });
        invalidateLibrary();
      }
    },
  });

  const singleDeleteMutation = useMutation({
    mutationFn: (id) => deletePhoto(id),
    onSuccess: (_res, id) => {
      setPagesMap(prev => {
        const next = new Map();
        for (const [pg, arr] of prev) next.set(pg, arr.filter(p => p.id !== id));
        return next;
      });
      invalidateLibrary({ albums: true, facets: true });
    },
  });

  function handleDeleteOne(photoId) {
    if (window.confirm('Delete this photo? It will be removed from the library (disk files are kept).')) {
      singleDeleteMutation.mutate(photoId);
    }
  }

  function handleBatchDelete() {
    const ids = [...selection];
    if (ids.length === 0) return;
    if (window.confirm(`Delete the ${ids.length} selected photo(s)? They will be removed from the library (disk files are kept).`)) {
      deleteMutation.mutate(ids);
    }
  }

  const isEmptyLibrary = !isLoading && total === 0 && photos.length === 0
    && !hasRailFilter && !sessionFilter && !search;

  if (isEmptyLibrary) {
    return (
      <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight">Library</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">Your digital photo collection</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
            <Images className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No Photos Yet</h3>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-6">
            Import your first digital photos to get started.
          </p>
          <Button color="primary" variant="flat" onPress={() => navigate('/digital-import')}>
            Import Digital Photos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Library</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{total} photos</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Input
            value={keyword}
            onValueChange={setKeyword}
            placeholder="Search photos"
            startContent={<Search className="w-4 h-4 text-zinc-400" />}
            isClearable
            size="sm"
            className="w-52"
          />
          <Select
            size="sm"
            aria-label="Sort"
            className="w-44"
            selectedKeys={[sortKey]}
            onSelectionChange={(keys) => {
              const key = [...keys][0];
              if (!key || key === sortKey) return;
              resetPages();
              setSortKey(key);
            }}
          >
            {SORT_OPTIONS.map(o => (
              <SelectItem key={o.key} textValue={o.label}>{o.label}</SelectItem>
            ))}
          </Select>
          <Button
            size="sm"
            variant={favoriteOnly ? 'solid' : 'flat'}
            color={favoriteOnly ? 'danger' : 'default'}
            onPress={() => {
              resetPages();
              setFavoriteOnly(v => !v);
            }}
          >
            <Heart className={`w-4 h-4 ${favoriteOnly ? 'fill-current' : ''}`} /> Favorites
          </Button>
          <Button
            size="sm"
            variant="flat"
            isDisabled={sessions.length === 0}
            onPress={applyLastImport}
          >
            <History className="w-4 h-4" /> Last import
          </Button>
          <Button
            size="sm"
            variant={selectionMode ? 'solid' : 'flat'}
            color={selectionMode ? 'primary' : 'default'}
            onPress={toggleSelectionMode}
          >
            {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />} Select
          </Button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <aside className="w-56 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Filters</span>
            {hasRailFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
          <FilterSection title="Date" defaultOpen>
            {(facets?.years || []).map(y => (
              <YearGroup
                key={y.year}
                year={y}
                yearsSel={yearsSel}
                monthsSel={monthsSel}
                onToggleYear={() => toggleValue(yearsSel, setYearsSel, y.year)}
                onToggleMonth={(m) => toggleValue(monthsSel, setMonthsSel, `${y.year}-${m.month}`)}
              />
            ))}
            {facets && (facets.years || []).length === 0 && (
              <div className="text-xs text-zinc-400 dark:text-zinc-500 px-1">No date taken info</div>
            )}
          </FilterSection>
          <FilterSection title="Camera">
            <FacetValueList
              rows={facets?.cameras || []}
              selected={camerasSel}
              onToggle={(v) => toggleValue(camerasSel, setCamerasSel, v)}
            />
          </FilterSection>
          <FilterSection title="Lens">
            <FacetValueList
              rows={facets?.lenses || []}
              selected={lensesSel}
              onToggle={(v) => toggleValue(lensesSel, setLensesSel, v)}
            />
          </FilterSection>
        </aside>

        <main className="flex-1 min-w-0">
          {sessionFilter && (
            <div className="mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs">
                Last import: {sessionLabel}
                <button
                  type="button"
                  aria-label="Clear session filter"
                  onClick={() => {
                    resetPages();
                    setSessionFilter(null);
                  }}
                  className="hover:text-primary/70"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" color="primary" />
            </div>
          ) : photos.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No matching photos — try adjusting your filters.
            </div>
          ) : (
            <>
              {selectionMode ? (
                <PhotoGrid
                  photos={photos}
                  selection={selection}
                  onSelectionChange={setSelection}
                />
              ) : (
                <div className="photo-grid">
                  {photos.map((p, idx) => (
                    <PhotoItem
                      key={p.id}
                      p={p}
                      index={idx}
                      viewMode="positive"
                      onSelect={(i) => setViewerIndex(i)}
                      onUpdatePhoto={(photoId, data) => updatePhotoMutation.mutate({ id: photoId, data })}
                      onEditTags={(photo) => setEditingTagsPhoto(photo)}
                      onDeletePhoto={handleDeleteOne}
                    />
                  ))}
                </div>
              )}
              <div className="flex flex-col items-center gap-2 mt-6">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {photos.length} / {total} loaded
                </span>
                {hasMore && (
                  <Button
                    size="sm"
                    variant="flat"
                    isLoading={isFetching}
                    onPress={() => setPage(p => p + 1)}
                  >
                    Load more
                  </Button>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {selectionMode && selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-white dark:bg-zinc-800 shadow-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-300 mr-1">{selection.size} selected</span>
          <Button size="sm" variant="flat" onPress={() => setShowAlbumPicker(true)}>
            <BookMarked className="w-4 h-4" /> Add to album
          </Button>
          <Button
            size="sm"
            variant="flat"
            isLoading={favoriteMutation.isPending}
            onPress={() => favoriteMutation.mutate({ ids: [...selection], rating: 1 })}
          >
            <Heart className="w-4 h-4" /> Favorite
          </Button>
          <Button
            size="sm"
            variant="flat"
            isLoading={favoriteMutation.isPending}
            onPress={() => favoriteMutation.mutate({ ids: [...selection], rating: 0 })}
          >
            <Heart className="w-4 h-4" /> Unfavorite
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            isLoading={deleteMutation.isPending}
            onPress={handleBatchDelete}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
          <Button size="sm" variant="light" onPress={() => setSelection(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {editingTagsPhoto && (
        <TagEditModal
          photo={editingTagsPhoto}
          allTags={allTags}
          onClose={() => setEditingTagsPhoto(null)}
          onSave={async (photoId, newTags) => {
            try {
              await updatePhotoMutation.mutateAsync({ id: photoId, data: { tags: newTags } });
            } catch (err) {
              console.error('[LibraryView] Failed to save tags:', err);
            }
            setEditingTagsPhoto(null);
          }}
        />
      )}

      {viewerIndex !== null && (
        <ImageViewer images={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}

      <AlbumPickerModal
        isOpen={showAlbumPicker}
        onClose={() => setShowAlbumPicker(false)}
        count={selection.size}
        isPending={addToAlbumMutation.isPending}
        onPick={(album) => addToAlbumMutation.mutate({ albumId: album.id, ids: [...selection] })}
      />
    </div>
  );
}

function FilterSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 w-full text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 py-1"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <div className="mt-1 pl-1 max-h-64 overflow-y-auto">{children}</div>}
    </div>
  );
}

function YearGroup({ year, yearsSel, monthsSel, onToggleYear, onToggleMonth }) {
  const [open, setOpen] = useState(false);
  const yearActive = yearsSel.includes(year.year);
  return (
    <div>
      <div className="flex items-center gap-1 py-0.5">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={onToggleYear}
          className={`flex-1 flex items-center justify-between rounded px-1.5 py-0.5 text-xs ${yearActive ? 'bg-primary/10 text-primary font-medium' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
        >
          <span>{year.year}</span>
          <span className="text-zinc-400 dark:text-zinc-500">{year.count}</span>
        </button>
      </div>
      {open && (
        <div className="pl-6">
          {(year.months || []).map(m => {
            const key = `${year.year}-${m.month}`;
            const active = monthsSel.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleMonth(m)}
                className={`w-full flex items-center justify-between rounded px-1.5 py-0.5 text-xs ${active ? 'bg-primary/10 text-primary font-medium' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              >
                <span>{Number(m.month)}</span>
                <span className="text-zinc-400 dark:text-zinc-500">{m.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FacetValueList({ rows, selected, onToggle }) {
  if (!rows.length) {
    return <div className="text-xs text-zinc-400 dark:text-zinc-500 px-1">No data</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 py-0.5">
      {rows.map(row => {
        const active = selected.includes(row.value);
        return (
          <button
            key={row.value}
            type="button"
            onClick={() => onToggle(row.value)}
            className={`rounded-full border px-2 py-0.5 text-xs ${active ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500'}`}
          >
            {row.value} <span className="text-zinc-400 dark:text-zinc-500">{row.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function AlbumPickerModal({ isOpen, onClose, count, isPending, onPick }) {
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    enabled: isOpen,
    ...getCacheStrategy('digitalAlbums'),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>Add to album</ModalHeader>
        <ModalBody>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" color="primary" />
            </div>
          ) : albums.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No albums yet — create one on the Albums page first.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {albums.map(album => (
                <button
                  key={album.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => onPick(album)}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <span className="truncate">{album.title}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0 ml-2">
                    {album.photo_count ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
