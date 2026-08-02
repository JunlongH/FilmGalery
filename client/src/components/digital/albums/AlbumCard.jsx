import React from 'react';
import { BookMarked, Folders } from 'lucide-react';
import { buildUploadUrl } from '../../../api';

export default function AlbumCard({ album, onClick, subCount = 0 }) {
  const coverUrl = album.cover_thumb ? buildUploadUrl(album.cover_thumb) : null;
  const hasSub = subCount > 0;

  const card = (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-xl overflow-hidden bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 hover:shadow-lg transition-shadow duration-200"
    >
      <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
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
        {hasSub && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-medium">
            <Folders className="w-3 h-3" /> {subCount}
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm truncate">{album.title}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          {album.total_photo_count ?? album.photo_count ?? 0} photos
          {album.date_range_start && ` · ${album.date_range_start.slice(0, 7)}`}
        </p>
      </div>
    </div>
  );

  if (!hasSub) return card;

  return (
    <div className="relative">
      <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800" />
      <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-xl overflow-hidden bg-zinc-200 dark:bg-zinc-700" />
      <div className="relative">{card}</div>
    </div>
  );
}
