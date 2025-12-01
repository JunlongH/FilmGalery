import React, { useState, useMemo, Suspense } from 'react';
import VirtualPhotoGrid from './VirtualPhotoGrid';
import { buildUploadUrl } from '../api';
import HorizontalScroller from './HorizontalScroller';
const ImageViewer = React.lazy(() => import('./ImageViewer'));

function PhotoGridInner({ photos = [], horizontal = false }) {
  const [viewerIndex, setViewerIndex] = useState(null);
  if (!Array.isArray(photos) || photos.length === 0) return <div style={{ color:'#666' }}>No photos found.</div>;
  if (horizontal) {
    return (
      <div>
        <HorizontalScroller height={220} padding={8} loop={photos.length >= 4} showEdges={photos.length >= 4}>
          {photos.map((p, idx) => (
            <div key={p.id || idx} style={{ width: 220, minWidth: 220, height: '100%' }}>
              <PhotoThumb photo={p} onClick={() => setViewerIndex(idx)} />
            </div>
          ))}
        </HorizontalScroller>
        {viewerIndex !== null && (
          <Suspense fallback={null}>
            <ImageViewer images={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
          </Suspense>
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
          render={(p, idx) => (
            <div style={{ width: '100%', height: '100%' }} key={p.id || idx}>
              <PhotoThumb photo={p} onClick={() => setViewerIndex(idx)} />
            </div>
          )}
        />
      ) : (
        <div className="grid">
          {photos.map((p, idx) => (
            <PhotoThumb key={p.id || idx} photo={p} onClick={() => setViewerIndex(idx)} />
          ))}
        </div>
      )}
      {viewerIndex !== null && (
        <Suspense fallback={null}>
          <ImageViewer images={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
        </Suspense>
      )}
    </div>
  );
}

const PhotoThumb = React.memo(function PhotoThumb({ photo, onClick }) {
  const url = useMemo(() => {
    let candidate = null;
    if (photo.positive_thumb_rel_path) candidate = `/uploads/${photo.positive_thumb_rel_path}`;
    else if (photo.thumb_rel_path) candidate = `/uploads/${photo.thumb_rel_path}`;
    else if (photo.positive_rel_path) candidate = `/uploads/${photo.positive_rel_path}`;
    else if (photo.full_rel_path) candidate = `/uploads/${photo.full_rel_path}`;
    else if (photo.filename) candidate = photo.filename;
    return buildUploadUrl(candidate);
  }, [photo]);
  return (
    <div className="photo-item" onClick={onClick} style={{ width: '100%', height: '100%' }}>
      <div className="photo-thumb" style={{ width: '100%', height: '100%' }}>
        <img src={url} alt={photo.caption || ''} loading="lazy" decoding="async" draggable={false} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
      </div>
    </div>
  );
});

export default React.memo(PhotoGridInner);
