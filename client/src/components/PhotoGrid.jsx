import React, { useState, useMemo, useCallback } from 'react';
import VirtualPhotoGrid from './VirtualPhotoGrid';
import { buildUploadUrl } from '../api';
import HorizontalScroller from './HorizontalScroller';
import ImageViewer from './common/LazyImageViewer';

function PhotoGridInner({ photos = [], horizontal = false }) {
  const [viewerIndex, setViewerIndex] = useState(null);

  // 稳定回调：PhotoThumb 的 React.memo 依赖此引用稳定性
  const handleThumbClick = useCallback((idx) => setViewerIndex(idx), []);
  const handleViewerClose = useCallback(() => setViewerIndex(null), []);

  // 虚拟滚动 render 函数稳定化（VirtualPhotoGrid 通过 itemData 传递）
  const renderThumb = useCallback((p, idx) => (
    <div style={{ width: '100%', height: '100%' }} key={p.id || idx}>
      <PhotoThumb photo={p} index={idx} onClick={handleThumbClick} />
    </div>
  ), [handleThumbClick]);

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
            <PhotoThumb key={p.id || idx} photo={p} index={idx} onClick={handleThumbClick} />
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
