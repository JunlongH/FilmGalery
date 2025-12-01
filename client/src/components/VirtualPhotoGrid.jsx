import React, { useMemo, useRef, useState, useLayoutEffect, memo } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';

// A responsive virtualized grid for square thumbnails
// Props: photos, render(item, index), itemSize (px), gap (px)
export default memo(function VirtualPhotoGrid({ items = [], render, itemSize = 180, gap = 12, style }) {
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setDims({ width: rect.width, height: rect.height || window.innerHeight * 0.7 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { columnCount, rowCount, itemW, itemH } = useMemo(() => {
    const total = Math.max(1, items.length);
    const w = Math.max(1, dims.width);
    const perCol = Math.max(1, Math.floor((w + gap) / (itemSize + gap)));
    const cols = perCol;
    const rows = Math.ceil(total / cols);
    return { columnCount: cols, rowCount: rows, itemW: itemSize + gap, itemH: itemSize + gap };
  }, [dims.width, items.length, itemSize, gap]);

  const Cell = ({ columnIndex, rowIndex, style: cellStyle }) => {
    const index = rowIndex * columnCount + columnIndex;
    if (index >= items.length) return null;
    const child = render(items[index], index);
    return (
      <div style={{ ...cellStyle, left: cellStyle.left + gap, top: cellStyle.top + gap, width: itemW - gap, height: itemH - gap }}>
        {child}
      </div>
    );
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '70vh', ...style }}>
      <Grid
        columnCount={columnCount}
        columnWidth={itemW}
        height={dims.height}
        rowCount={rowCount}
        rowHeight={itemH}
        width={dims.width}
      >
        {Cell}
      </Grid>
    </div>
  );
});
