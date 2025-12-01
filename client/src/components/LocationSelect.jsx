import React, { useEffect, useState } from 'react';
import { createLocation, searchLocations, getCountries, getLocation } from '../api';

// Location selector backed by DB (seed-locations + user additions)
export default function LocationSelect({ value, onChange }) {
  const [countries, setCountries] = useState([]);
  const [cities, setCities] = useState([]);
  
  const [countryCode, setCountryCode] = useState('');
  const [countryInput, setCountryInput] = useState('');
  const [cityName, setCityName] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [newCity, setNewCity] = useState('');

  // Load countries on mount
  useEffect(() => {
    getCountries().then(rows => {
      // rows is [{country_code, country_name}]
      // Sort by name
      const sorted = (Array.isArray(rows) ? rows : []).sort((a, b) => (a.country_name || '').localeCompare(b.country_name || ''));
      setCountries(sorted);
    });
  }, []);

  // Load cities when country changes
  useEffect(() => {
    if (!countryCode) {
      setCities([]);
      return;
    }
    console.log('[LocationSelect] Loading cities for country:', countryCode);
    searchLocations({ country: countryCode }).then(rows => {
      console.log('[LocationSelect] Received cities:', rows?.length || 0);
      setCities(Array.isArray(rows) ? rows : []);
    }).catch(err => {
      console.error('[LocationSelect] Error loading cities:', err);
      setCities([]);
    });
  }, [countryCode]);

  // Handle initial value
  useEffect(() => {
    if (!value) return;
    getLocation(value).then(loc => {
      if (loc && loc.country_code) {
        setCountryCode(loc.country_code);
        const countryObj = countries.find(c => c.country_code === loc.country_code);
        setCountryInput(countryObj ? countryObj.country_name : loc.country_code);
        setCityName(loc.city_name);
        setCityInput(loc.city_name);
      }
    });
  }, [value, countries]);

  // Notify parent when selection changes
  useEffect(() => {
    // Find the selected city object
    const selected = cities.find(c => c.city_name === cityName);
    if (selected && onChange) {
       // Avoid infinite loop if value matches
       if (selected.id === value) return; 
       
       onChange({
        location_id: selected.id,
        country_code: selected.country_code,
        country_name: selected.country_name,
        city_name: selected.city_name,
        latitude: selected.city_lat,
        longitude: selected.city_lng
      });
    }
  }, [cityName, cities, onChange, value]);

  async function handleAddCity() {
    if (!countryCode || !newCity.trim()) return;
    try {
      const countryObj = countries.find(c => c.country_code === countryCode);
      const countryName = countryObj ? countryObj.country_name : countryCode;
      
      const resp = await createLocation({ 
        country_code: countryCode, 
        country_name: countryName, 
        city_name: newCity.trim() 
      });
      
      if (resp && resp.id) {
        // Reload cities
        const rows = await searchLocations({ country: countryCode });
        setCities(Array.isArray(rows) ? rows : []);
        setCityName(newCity.trim());
        setCityInput(newCity.trim());
        setNewCity('');
      }
    } catch (e) {
      console.error('Add city failed', e);
    }
  }

  function handleCountryInputChange(e) {
    const input = e.target.value;
    setCountryInput(input);
    
    // Find matching country
    const match = countries.find(c => 
      c.country_name.toLowerCase() === input.toLowerCase()
    );
    
    if (match) {
      setCountryCode(match.country_code);
      setCityName('');
      setCityInput('');
    } else {
      // Clear selection if no exact match
      if (countryCode) {
        setCountryCode('');
        setCityName('');
        setCityInput('');
      }
    }
  }

  function handleCityInputChange(e) {
    const input = e.target.value;
    setCityInput(input);
    
    // Find matching city
    const match = cities.find(c => 
      c.city_name.toLowerCase() === input.toLowerCase()
    );
    
    if (match) {
      setCityName(match.city_name);
    } else {
      // Clear selection if no exact match
      if (cityName) {
        setCityName('');
      }
    }
  }
  
  // Filter countries and cities based on input
  const filteredCountries = countries.filter(c =>
    c.country_name.toLowerCase().startsWith(countryInput.toLowerCase())
  );
  
  const filteredCities = cities.filter(c =>
    c.city_name.toLowerCase().startsWith(cityInput.toLowerCase())
  );
  
  const selectedCity = cities.find(c => c.city_name === cityName);

  return (
    <div className="fg-location-select" style={{ display: 'flex', flexDirection:'column', gap: 10 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div style={{ position: 'relative' }}>
          <input
            className="fg-input"
            list="country-list"
            value={countryInput}
            onChange={handleCountryInputChange}
            placeholder="Country"
            autoComplete="off"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <datalist id="country-list">
            {filteredCountries.slice(0, 100).map(c => (
              <option key={c.country_code} value={c.country_name} />
            ))}
          </datalist>
        </div>
        
        <div style={{ position: 'relative' }}>
          <input
            className="fg-input"
            list="city-list"
            value={cityInput}
            onChange={handleCityInputChange}
            placeholder="City"
            autoComplete="off"
            disabled={!countryCode}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <datalist id="city-list">
            {filteredCities.slice(0, 100).map(ct => (
              <option key={ct.id} value={ct.city_name} />
            ))}
          </datalist>
        </div>
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
