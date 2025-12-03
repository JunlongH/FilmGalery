import React, { useState, useEffect, useRef } from 'react';

export default function TagEditModal({ photo, allTags, onClose, onSave }) {
  const [input, setInput] = useState('');
  const [currentTags, setCurrentTags] = useState(photo.tags ? photo.tags.map(t => t.name || t) : []);
  const [suggestions, setSuggestions] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    const lower = input.toLowerCase().trim();
    const filtered = allTags
      .filter(t => t.photos_count > 0) // Hide tags with no photos
      .filter(t => !currentTags.includes(t.name))
      .filter(t => !lower || t.name.toLowerCase().includes(lower));
    setSuggestions(filtered);
  }, [input, allTags, currentTags]);

  const addTag = (name) => {
    if (!name.trim()) return;
    if (currentTags.includes(name.trim())) return;
    setCurrentTags([...currentTags, name.trim()]);
    setInput('');
    // Keep suggestions open or refresh them? 
    // The useEffect will run and remove the added tag from suggestions.
    if (inputRef.current) inputRef.current.focus();
  };

  const removeTag = (name) => {
    setCurrentTags(currentTags.filter(t => t !== name));
  };

  const handleSave = () => {
    let finalTags = [...currentTags];
    if (input.trim() && !finalTags.includes(input.trim())) {
      finalTags.push(input.trim());
    }
    console.log('[TagEditModal] Saving tags:', finalTags, 'for photo:', photo.id);
    onSave(photo.id, finalTags);
    onClose();
  };

  return (
    <div className="iv-overlay" onClick={onClose} style={{ background: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#fff', color: '#333', padding: 20, borderRadius: 8, width: 400, maxWidth: '90%' }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Edit Tags</h3>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {currentTags.map(t => (
            <span key={t} style={{ background: '#eef8ee', color: '#2f7d32', padding: '4px 8px', borderRadius: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              {t}
              <button onClick={() => removeTag(t)} style={{ border: 'none', background: 'transparent', color: '#2f7d32', cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>

        <div style={{ position: 'relative', marginBottom: 20 }}>
          <input 
            ref={inputRef}
            value={input} 
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag(input);
              }
            }}
            placeholder="Type to add tag..."
            style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc' }}
          />
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, maxHeight: 200, overflowY: 'auto' }}>
              {suggestions.map(s => (
                <div 
                  key={s.id} 
                  onClick={() => addTag(s.name)}
                  style={{ 
                    padding: '6px 12px', 
                    background: '#f5f5f5', 
                    borderRadius: 20, 
                    cursor: 'pointer', 
                    fontSize: 13, 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 6,
                    border: '1px solid #e0e0e0',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#e8f5e9'; e.currentTarget.style.borderColor = '#c8e6c9'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.borderColor = '#e0e0e0'; }}
                >
                  <span style={{ color: '#333' }}>{s.name}</span>
                  <span style={{ color: '#2f7d32', fontWeight: 'bold', fontSize: 15, lineHeight: 1 }}>+</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', background: '#2f7d32', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
        </div>
      </div>
    </div>
  );
}
