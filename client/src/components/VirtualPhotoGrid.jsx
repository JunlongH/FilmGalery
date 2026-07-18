import React, { useMemo, useRef, useState, useLayoutEffect, memo } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';

/**
 * 模块级 Cell 组件（关键：在渲染体外定义，配合 itemData 传参）。
 * 若在组件内联定义，每次父渲染都会产生新组件类型，
 * react-window 会把所有 cell 当作新组件卸载重挂载，虚拟化形同虚设。
 */
function Cell({ columnIndex, rowIndex, style: cellStyle, data }) {
  const { items, render, columnCount, itemW, itemH, gap } = data;
  const index = rowIndex * columnCount + columnIndex;
  if (index >= items.length) return null;
  const child = render(items[index], index);
  return (
    <div style={{ ...cellStyle, left: cellStyle.left + gap, top: cellStyle.top + gap, width: itemW - gap, height: itemH - gap }}>
      {child}
    </div>
  );
}

// A responsive virtualized grid for square thumbnails
// Props: items, render(item, index), itemSize (px), gap (px)
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

  const itemData = useMemo(
    () => ({ items, render, columnCount, itemW, itemH, gap }),
    [items, render, columnCount, itemW, itemH, gap]
  );

  return (
    <div ref={containerRef} style={{ width: '100%', height: '70vh', ...style }}>
      <Grid
        columnCount={columnCount}
        columnWidth={itemW}
        height={dims.height}
        rowCount={rowCount}
        rowHeight={itemH}
        width={dims.width}
        itemData={itemData}
      >
        {Cell}
      </Grid>
    </div>
  );
});
