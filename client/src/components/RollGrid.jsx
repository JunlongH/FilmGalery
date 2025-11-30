import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';
import { buildUploadUrl, deleteRoll } from '../api';
import { useQueryClient } from '@tanstack/react-query';

export default function RollGrid({ rolls = [] }) {
  const nav = useNavigate();
  const queryClient = useQueryClient();

  function resolveFilmName(roll) {
    if (!roll) return 'Unknown film';
    const name = roll.film_name_joined || (roll.film && roll.film.name) || roll.film_type || roll.filmName || (typeof roll.film === 'string' ? roll.film : null) || null;
    return name || 'Unknown film';
  }

  async function onDeleteRoll(id, e) {
    e && e.stopPropagation();
    if (!confirm('Delete this roll and its files? This cannot be undone.')) return;
    try {
      const res = await deleteRoll(id);
      if (res && (res.deleted || res.ok || res.success !== false)) {
        queryClient.invalidateQueries(['rolls']);
      } else {
        alert('Delete failed');
      }
    } catch (err) {
      console.error(err);
      alert('Delete failed: ' + (err.message || err));
    }
  }

  if (!rolls || rolls.length === 0) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>No rolls found.</div>;
  }

  return (
    <div className="card-grid">
      {rolls.map(r => (
        <div key={r.id} className="card" onClick={()=>nav(`/rolls/${r.id}`)}>
          <button className="card-delete btn btn-danger btn-sm" onClick={(e)=>onDeleteRoll(r.id, e)} aria-label={`Delete roll ${r.title || 'Untitled'}`}>Delete</button>
          <div className="card-cover">
            {(r.coverPath || r.cover_photo) ? (
              (() => {
                const cover = r.coverPath || r.cover_photo;
                const url = buildUploadUrl(cover);
                return (
                  <LazyLoadImage
                    src={url}
                    alt="cover"
                    effect="opacity"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                );
              })()
            ) : (
              <div style={{ color:'#999' }}>No cover</div>
            )}
            <div className="card-overlay">
              <div className="card-title">{r.title || 'Untitled'}</div>
              <div className="card-meta">{(r.start_date ? r.start_date : '')}{r.end_date && r.end_date !== r.start_date ? ` — ${r.end_date}` : ''}</div>
              <div className="card-meta muted">{resolveFilmName(r)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
