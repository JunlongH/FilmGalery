import React, { useEffect, useState, useMemo } from 'react';
import { createLocation, searchLocations } from '../api';

// Location selector backed by DB (seed-locations + user additions)
export default function LocationSelect({ value, onChange }) {
  const [all, setAll] = useState([]); // full list from DB
  const [countryCode, setCountryCode] = useState('');
  const [cityName, setCityName] = useState('');
  const [newCity, setNewCity] = useState('');
  const countries = useMemo(() => {
    const map = new Map();
    for (const r of all) {
      if (!r.country_code) continue; // skip blank codes to avoid 'Unknown'
      const code = r.country_code;
      const name = r.country_name || r.country_code;
      if (!map.has(code)) map.set(code, name);
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a,b)=>a.name.localeCompare(b.name));
  }, [all]);
  const cities = useMemo(() => all.filter(r => countryCode ? r.country_code === countryCode : false), [all, countryCode]);
  const selectedCity = useMemo(() => cities.find(c => c.city_name === cityName), [cities, cityName]);

  useEffect(() => {
    // initial load
    searchLocations({}).then(rows => setAll(Array.isArray(rows) ? rows : [])).catch(console.error);
  }, []);

  useEffect(() => {
    if (!value || !all.length) return;
    const match = all.find(r => r.id === value);
    if (match) {
      setCountryCode(match.country_code || '');
      setCityName(match.city_name || '');
    }
  }, [value, all]);

  useEffect(() => {
    if (selectedCity && onChange) {
      onChange({
        location_id: selectedCity.id,
        country_code: selectedCity.country_code,
        country_name: selectedCity.country_name,
        city_name: selectedCity.city_name,
        latitude: selectedCity.city_lat,
        longitude: selectedCity.city_lng
      });
    }
  }, [selectedCity, onChange]);

  async function handleAddCity() {
    if (!countryCode || !newCity.trim()) return;
    try {
      const countryName = countries.find(c => c.code === countryCode)?.name || countryCode;
      const resp = await createLocation({ country_code: countryCode, country_name: countryName, city_name: newCity.trim() });
      if (resp && resp.id) {
        // reload list
        const rows = await searchLocations({});
        setAll(Array.isArray(rows) ? rows : []);
        setCityName(newCity.trim());
        setNewCity('');
      }
    } catch (e) {
      console.error('Add city failed', e);
    }
  }

  return (
    <div className="fg-location-select" style={{ display: 'flex', flexDirection:'column', gap: 10 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <select className="fg-select" value={countryCode} onChange={e => { setCountryCode(e.target.value); setCityName(''); }} style={{ minWidth: 0 }}>
          <option value="">Country</option>
          {countries.map(c => <option key={c.code || c.name} value={c.code}>{c.name || c.code}</option>)}
        </select>
        <select className="fg-select" value={cityName} onChange={e => setCityName(e.target.value)} disabled={!countryCode} style={{ minWidth: 0 }}>
          <option value="">City</option>
          {cities.map(ct => <option key={ct.id} value={ct.city_name}>{ct.city_name}</option>)}
        </select>
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'stretch' }}>
        <input className="fg-input" placeholder="Add city" value={newCity} onChange={e=>setNewCity(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="fg-btn fg-btn-secondary" onClick={handleAddCity} disabled={!countryCode || !newCity.trim()} style={{ flexShrink: 0 }}>Add</button>
      </div>
      {selectedCity && (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Lat: {selectedCity.city_lat ?? '—'} Lng: {selectedCity.city_lng ?? '—'}</div>
      )}
    </div>
  );
}
