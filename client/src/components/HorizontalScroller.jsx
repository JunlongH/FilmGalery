import React, { useRef, useEffect, useCallback, useLayoutEffect, useMemo, useState } from 'react';

function HorizontalScroller({ children, height = 260, padding = 12, gap = 16, background = 'transparent', style, loop = true, showEdges = true }) {
  const ref = useRef(null);
  const contentRef = useRef(null);
  const velocityRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const isDraggingRef = useRef(false);
  const rafRef = useRef(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const uid = useMemo(() => `hs-${Math.random().toString(36).slice(2)}`, []);
  const childCount = useMemo(() => React.Children.count(children), [children]);
  const shouldLoop = loop && childCount >= 4; // disable looping when few items remain

  const stopInertia = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const onPointerDown = useCallback((e) => {
    if (!shouldLoop) return; // disable drag when not looping
    // Middle mouse (1) or left mouse (0) + modifier-less
    if (!(e.button === 1 || e.button === 0)) return;
    const el = ref.current;
    if (!el) return;
    isDraggingRef.current = true;
    stopInertia();
    lastXRef.current = e.clientX;
    lastTimeRef.current = performance.now();
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  }, [stopInertia, shouldLoop]);

  const onPointerMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    const el = ref.current;
    if (!el) return;
    const now = performance.now();
    const dx = e.clientX - lastXRef.current;
    el.scrollLeft -= dx; // invert to drag feel
    const dt = now - lastTimeRef.current || 16;
    velocityRef.current = (dx) / dt; // px per ms
    lastXRef.current = e.clientX;
    lastTimeRef.current = now;
  }, []);

  const normalize = useCallback(() => {
    if (!shouldLoop) return;
    const el = ref.current; if (!el) return;
    const seg = segmentWidth; if (!seg) return;
    if (el.scrollLeft < seg * 0.25) {
      el.scrollLeft += seg; // jump forward one segment
    } else if (el.scrollLeft > seg * 1.75) {
      el.scrollLeft -= seg; // jump backward one segment
    }
  }, [shouldLoop, segmentWidth]);

  const onPointerUp = useCallback((e) => {
    if (!isDraggingRef.current) return;
    const el = ref.current;
    if (!el) return;
    isDraggingRef.current = false;
    el.style.cursor = '';
    normalize();
    // inertia
    const decay = 0.95; // friction
    const step = () => {
      const v = velocityRef.current;
      if (Math.abs(v) < 0.01) { stopInertia(); return; }
      el.scrollLeft -= v * 16; // assume ~60fps
      velocityRef.current = v * decay;
      normalize();
      rafRef.current = requestAnimationFrame(step);
    };
    stopInertia();
    rafRef.current = requestAnimationFrame(step);
  }, [stopInertia, normalize]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!shouldLoop) return; // do not translate vertical wheel when not looping/few items
    const onWheel = (e) => {
      // translate vertical wheel to horizontal scroll
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
        // Keep within loop band
        if (shouldLoop) {
          if (el.scrollLeft < segmentWidth * 0.25) el.scrollLeft += segmentWidth;
          else if (el.scrollLeft > segmentWidth * 1.75) el.scrollLeft -= segmentWidth;
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [shouldLoop, segmentWidth]);

  useLayoutEffect(() => {
    // Measure segment width (original content width)
    const el = ref.current;
    const inner = contentRef.current;
    if (!el || !inner) return;
    const total = inner.scrollWidth;
    const seg = shouldLoop ? Math.round(total / 3) : total;
    setSegmentWidth(seg);
    if (shouldLoop) {
      // start from middle segment for seamless scroll
      el.scrollLeft = seg;
    }
  }, [children, shouldLoop]);

  const items = useMemo(() => {
    const arr = React.Children.toArray(children);
    if (!shouldLoop) return arr;
    const dup = [
      ...arr.map((c, i) => React.cloneElement(c, { key: `a-${i}` })),
      ...arr.map((c, i) => React.cloneElement(c, { key: `b-${i}` })),
      ...arr.map((c, i) => React.cloneElement(c, { key: `c-${i}` })),
    ];
    return dup;
  }, [children, shouldLoop]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Hide scrollbars for webkit */}
      <style>{`
        .${uid}::-webkit-scrollbar{ display:none; height:0; width:0 }
      `}</style>
      <div
        className={uid}
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          overflowX: 'hidden',
          overflowY: 'hidden',
          whiteSpace: 'nowrap',
          padding: padding,
          background,
          height,
          boxSizing: 'border-box',
          scrollBehavior: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          cursor: shouldLoop ? (isDraggingRef.current ? 'grabbing' : 'grab') : 'default',
          ...style
        }}
      >
        <div ref={contentRef} style={{ display: 'inline-flex', gap, alignItems: 'stretch', justifyContent: shouldLoop ? 'flex-start' : 'center', height: '100%', width: '100%' }}>
          {items}
        </div>
      </div>
      {(showEdges && shouldLoop) && (
        <>
          <div style={{ position:'absolute', inset:0, pointerEvents:'none',
            background: 'linear-gradient(90deg, rgba(248,249,250,0.9) 0%, rgba(248,249,250,0) 8%, rgba(248,249,250,0) 92%, rgba(248,249,250,0.9) 100%)', borderRadius: 12 }} />
        </>
      )}
    </div>
  );
}

export default React.memo(HorizontalScroller);
