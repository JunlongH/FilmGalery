import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@heroui/react';
import { BookMarked, Plus, Search, ChevronRight, ChevronDown } from 'lucide-react';
import { getAlbums } from '../../../api';
import { getCacheStrategy } from '../../../lib';
import AlbumEditModal from './AlbumEditModal';
import AlbumCard from './AlbumCard';
import DeletedAlbumsSection from './DeletedAlbumsSection';

const GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4';

function AlbumNode({ album, childrenByParent, expandedIds, toggleExpand, navigate }) {
  const children = childrenByParent.get(album.id) || [];
  const subCount = children.length;
  const isExpanded = expandedIds.has(album.id);

  return (
    <>
      <div className="relative">
        <AlbumCard
          album={album}
          subCount={subCount}
          onClick={() => navigate(`/albums/${album.id}`)}
        />
        {subCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(album.id);
            }}
            className="absolute bottom-2 left-2 flex items-center justify-center w-6 h-6 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {isExpanded && subCount > 0 && (
        <div className="col-span-full ml-2 pl-4 border-l-2 border-zinc-200 dark:border-zinc-700">
          <div className={GRID_CLASS}>
            {children.map(child => (
              <AlbumNode
                key={child.id}
                album={child}
                childrenByParent={childrenByParent}
                expandedIds={expandedIds}
                toggleExpand={toggleExpand}
                navigate={navigate}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function AlbumLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [keyword, setKeyword] = useState('');

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    ...getCacheStrategy('digitalAlbums'),
  });

  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { roots, childrenByParent } = useMemo(() => {
    const ids = new Set(albums.map(a => a.id));
    const roots = [];
    const childrenByParent = new Map();
    for (const a of albums) {
      if (a.parent_id != null && ids.has(a.parent_id)) {
        const list = childrenByParent.get(a.parent_id) || [];
        list.push(a);
        childrenByParent.set(a.parent_id, list);
      } else {
        roots.push(a);
      }
    }
    return { roots, childrenByParent };
  }, [albums]);

  const trimmed = keyword.trim().toLowerCase();
  const isSearching = trimmed.length > 0;
  const searchMatches = useMemo(() => {
    if (!isSearching) return [];
    return albums.filter(a => (a.title || '').toLowerCase().includes(trimmed));
  }, [albums, trimmed, isSearching]);

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
        <DeletedAlbumsSection />
        <AlbumEditModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSaved={handleSaved} />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Albums</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{albums.length} albums</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={keyword}
            onValueChange={setKeyword}
            placeholder="Search albums"
            startContent={<Search className="w-4 h-4 text-zinc-400" />}
            isClearable
            size="sm"
            className="w-52"
          />
          <Button color="primary" variant="flat" size="sm" onPress={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Album
          </Button>
        </div>
      </div>

      {isSearching ? (
        searchMatches.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-zinc-400 dark:text-zinc-500">
            <Search className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">No albums match “{keyword.trim()}”.</p>
          </div>
        ) : (
          <div className={GRID_CLASS}>
            {searchMatches.map(album => (
              <AlbumCard
                key={album.id}
                album={album}
                subCount={childrenByParent.get(album.id)?.length || 0}
                onClick={() => navigate(`/albums/${album.id}`)}
              />
            ))}
          </div>
        )
      ) : (
        <div className={GRID_CLASS}>
          {roots.map(album => (
            <AlbumNode
              key={album.id}
              album={album}
              childrenByParent={childrenByParent}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              navigate={navigate}
            />
          ))}
        </div>
      )}

      <DeletedAlbumsSection />

      <AlbumEditModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSaved={handleSaved} />
    </div>
  );
}
