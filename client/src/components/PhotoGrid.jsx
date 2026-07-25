import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Check } from 'lucide-react';
import VirtualPhotoGrid from './VirtualPhotoGrid';
import { buildUploadUrl } from '../api';
import HorizontalScroller from './HorizontalScroller';
import ImageViewer from './common/LazyImageViewer';

function GridTile({ photo, index, onClick, renderTile, selection }) {
  const tile = <PhotoThumb photo={photo} index={index} onClick={onClick} />;
  const content = renderTile ? renderTile(photo, index, tile) : tile;
  if (!selection) return content;
  const selected = selection.has(photo.id);
  return (
    <div className="relative w-full h-full group/select">
      {content}
      <div
        className={`pointer-events-none absolute inset-0 rounded-[4px] transition-shadow ${selected ? 'ring-2 ring-inset ring-primary' : ''}`}
      />
      <div
        className={[
          'absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full border flex items-center justify-center transition-opacity',
          selected
            ? 'bg-primary border-primary text-white opacity-100'
            : 'bg-black/40 border-white/70 text-transparent opacity-0 group-hover/select:opacity-100',
        ].join(' ')}
      >
        <Check className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}

function PhotoGridInner({ photos = [], horizontal = false, renderTile, selection = null, onSelectionChange }) {
  const [viewerIndex, setViewerIndex] = useState(null);

  const liveRef = useRef({ photos, selection, onSelectionChange });
  liveRef.current = { photos, selection, onSelectionChange };

  // 稳定回调：PhotoThumb 的 React.memo 依赖此引用稳定性
  const handleThumbClick = useCallback((idx) => {
    const { photos: list, selection: sel, onSelectionChange: onChange } = liveRef.current;
    if (sel) {
      const photo = list[idx];
      if (!photo || !onChange) return;
      const next = new Set(sel);
      if (next.has(photo.id)) next.delete(photo.id);
      else next.add(photo.id);
      onChange(next);
      return;
    }
    setViewerIndex(idx);
  }, []);
  const handleViewerClose = useCallback(() => setViewerIndex(null), []);

  // 虚拟滚动 render 函数稳定化（VirtualPhotoGrid 通过 itemData 传递）
  const renderThumb = useCallback((p, idx) => (
    <div style={{ width: '100%', height: '100%' }} key={p.id || idx}>
      <GridTile photo={p} index={idx} onClick={handleThumbClick} renderTile={renderTile} selection={selection} />
    </div>
  ), [handleThumbClick, renderTile, selection]);

  if (!Array.isArray(photos) || photos.length === 0) {
    return <div className="text-zinc-500 dark:text-zinc-400">No photos found.</div>;
  }

  if (horizontal) {
    return (
      <div>
        <HorizontalScroller height={220} padding={8} loop={photos.length >= 4} showEdges={photos.length >= 4}>
          {photos.map((p, idx) => (
            <div key={p.id || idx} style={{ width: 220, minWidth: 220, height: '100%' }}>
              <PhotoThumb photo={p} index={idx} onClick={handleThumbClick} />
            </div>
          ))}
        </HorizontalScroller>
        {viewerIndex !== null && (
          <ImageViewer images={photos} index={viewerIndex} onClose={handleViewerClose} />
        )}
      </div>
    );
  }

  const useVirtual = photos.length > 400;
  return (
    <div>
      {useVirtual ? (
        <VirtualPhotoGrid
          items={photos}
          itemSize={180}
          gap={12}
          render={renderThumb}
        />
      ) : (
        <div className="grid">
          {photos.map((p, idx) => (
            <GridTile key={p.id || idx} photo={p} index={idx} onClick={handleThumbClick} renderTile={renderTile} selection={selection} />
          ))}
        </div>
      )}
      {viewerIndex !== null && (
        <ImageViewer images={photos} index={viewerIndex} onClose={handleViewerClose} />
      )}
    </div>
  );
}

const PhotoThumb = React.memo(function PhotoThumb({ photo, index, onClick }) {
  const url = useMemo(() => {
    let candidate = null;
    if (photo.positive_thumb_rel_path) candidate = `/uploads/${photo.positive_thumb_rel_path}`;
    else if (photo.thumb_rel_path) candidate = `/uploads/${photo.thumb_rel_path}`;
    else if (photo.positive_rel_path) candidate = `/uploads/${photo.positive_rel_path}`;
    else if (photo.full_rel_path) candidate = `/uploads/${photo.full_rel_path}`;
    else if (photo.filename) candidate = photo.filename;
    return buildUploadUrl(candidate);
  }, [photo]);

  const handleClick = useCallback(() => onClick(index), [onClick, index]);

  return (
    <div className="photo-item" onClick={handleClick} style={{ width: '100%', height: '100%' }}>
      <div className="photo-thumb" style={{ width: '100%', height: '100%' }}>
        <img src={url} alt={photo.caption || ''} loading="lazy" decoding="async" draggable={false} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
      </div>
    </div>
  );
});

export default React.memo(PhotoGridInner);
