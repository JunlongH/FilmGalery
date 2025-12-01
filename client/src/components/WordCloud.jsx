import React, { useMemo } from 'react';

// Simple spiral placement with AABB collision detection
export default function WordCloud({
  words = [], // [{ text, weight }]
  width = 600,
  height = 300,
  minSize = 12,
  maxSize = 48,
  palette = ['#334155'],
}) {
  const placed = useMemo(() => {
    const results = [];
    const maxW = Math.max(...words.map(w => w.weight || 1), 1);
    const centerX = width / 2;
    const centerY = height / 2;

    const measure = (text, size) => {
      // Approximate text box; 0.6em per char width heuristic
      const w = text.length * (size * 0.6);
      const h = size * 1.2;
      return { w, h };
    };

    const intersects = (a, b) => (
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    );

    const boxes = [];
    const sorted = [...words].sort((a, b) => (b.weight || 1) - (a.weight || 1));

    sorted.forEach((w, idx) => {
      const weight = Math.max(1, w.weight || 1);
      const size = minSize + ((weight / maxW) * (maxSize - minSize));
      const { w: bw, h: bh } = measure(w.text, size);

      // Spiral search for placement
      let angle = 0;
      let radius = 0;
      let placedBox = null;
      const maxTries = 2000;
      for (let i = 0; i < maxTries; i++) {
        const jitter = (idx % 2 === 0 ? 1 : -1) * (i % 3);
        const x = centerX + (radius + jitter) * Math.cos(angle) - bw / 2;
        const y = centerY + (radius + jitter) * Math.sin(angle) - bh / 2;
        const candidate = { x, y, w: bw, h: bh };
        if (
          x >= 0 && y >= 0 && x + bw <= width && y + bh <= height &&
          boxes.every(b => !intersects(candidate, b))
        ) {
          placedBox = candidate;
          break;
        }
        angle += 0.35;
        radius += 2;
      }

      if (placedBox) {
        boxes.push(placedBox);
        results.push({
          ...w,
          size,
          x: placedBox.x,
          y: placedBox.y,
        });
      }
    });

    return results;
  }, [words, width, height, minSize, maxSize]);

  return (
    <div style={{ position: 'relative', width, height }}>
      {placed.map((w, i) => (
        <span
          key={i}
          title={`${w.text}: ${w.weight}`}
          style={{
            position: 'absolute',
            left: Math.round(w.x),
            top: Math.round(w.y),
            fontSize: `${Math.round(w.size)}px`,
            fontWeight: 700,
            lineHeight: 1,
            color: palette[i % palette.length],
            whiteSpace: 'nowrap',
            userSelect: 'none',
            transform: `rotate(${(i % 5 === 0 ? -5 : i % 4 === 0 ? 5 : 0)}deg)`
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
