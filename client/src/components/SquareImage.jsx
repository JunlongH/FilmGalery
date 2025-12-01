import React from 'react';

// Reusable square, center-cropped image that fills its container
// Props:
// - src: image url
// - alt: alt text
// - className: optional wrapper classes
// - style: optional wrapper styles (merged)
// - radius: border radius (default 4)
// - aspect: string aspect ratio, default '1 / 1'
export default function SquareImage({ src, alt, className, style, radius = 4, aspect = '1 / 1' }) {
  return (
    <div
      className={className}
      style={{
        aspectRatio: aspect,
        background: '#eee',
        borderRadius: `${radius}px`,
        overflow: 'hidden',
        position: 'relative',
        ...style
      }}
    >
      {src ? (
        <img
          src={src}
          alt={alt || ''}
          loading="lazy"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center center',
            display: 'block'
          }}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#999', fontSize: 12
        }}>
          No Image
        </div>
      )}
    </div>
  );
}
