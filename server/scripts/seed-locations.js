const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getDbPath } = require('../config/db-config');

const CITIES_URL = 'https://raw.githubusercontent.com/lutangar/cities.json/master/cities.json';
const COUNTRIES_URL = 'https://raw.githubusercontent.com/umpirsky/country-list/master/data/en/country.json';

function fetchJson(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (attemptsLeft) => {
      console.log(`Fetching ${url} (${4 - attemptsLeft}/3 attempts)...`);
      
      https.get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          if (attemptsLeft > 0) {
            console.log(`Failed with status ${res.statusCode}, retrying...`);
            setTimeout(() => attempt(attemptsLeft - 1), 2000);
          } else {
            return reject(new Error(`Request Failed. Status Code: ${res.statusCode}`));
          }
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            if (attemptsLeft > 0) {
              console.log(`Parse error, retrying...`);
              setTimeout(() => attempt(attemptsLeft - 1), 2000);
            } else {
              reject(e);
            }
          }
        });
      }).on('error', (e) => {
        if (attemptsLeft > 0) {
          console.log(`Network error: ${e.message}, retrying in 2s...`);
          setTimeout(() => attempt(attemptsLeft - 1), 2000);
        } else {
          reject(e);
        }
      }).on('timeout', () => {
        if (attemptsLeft > 0) {
          console.log(`Timeout, retrying...`);
          setTimeout(() => attempt(attemptsLeft - 1), 2000);
        } else {
          reject(new Error('Request timeout'));
        }
      });
    };
    
    attempt(retries);
  });
}

async function seedLocations() {
  const dbPath = getDbPath();
  console.log(`Seeding locations into: ${dbPath}`);
  
  const db = new sqlite3.Database(dbPath);
  
  const run = (sql, params = []) => new Promise((res, rej) => {
    db.run(sql, params, function(err) {
      if (err) rej(err);
      else res(this);
    });
  });

  try {
    console.log('Fetching country list...');
    const countries = await fetchJson(COUNTRIES_URL);
    console.log(`Loaded ${Object.keys(countries).length} countries.`);

    console.log('Fetching city list (this may take a moment)...');
    const cities = await fetchJson(CITIES_URL);
    console.log(`Loaded ${cities.length} cities.`);

    console.log('Beginning database insertion...');
    
    await run('BEGIN TRANSACTION');
    
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO locations (country_code, country_name, city_name, city_lat, city_lng)
      VALUES (?, ?, ?, ?, ?)
    `);

    let count = 0;
    const total = cities.length;
    
    // Filter for major cities to keep DB size reasonable? 
    // The user asked for "as many as possible". 
    // But 129k rows might slow down the UI dropdown if not handled well.
    // For now, we insert all. The UI should use search/autocomplete.
    
    for (const city of cities) {
      const cCode = city.country;
      const cName = countries[cCode] || cCode;
      const lat = parseFloat(city.lat);
      const lng = parseFloat(city.lng);
      
      stmt.run(cCode, cName, city.name, lat, lng);
      
      count++;
      if (count % 5000 === 0) {
        console.log(`Processed ${count}/${total} cities...`);
      }
    }

    stmt.finalize();
    await run('COMMIT');
    
    console.log(`Successfully seeded ${count} locations.`);
    
  } catch (err) {
    console.error('Seeding failed:', err);
    try { await run('ROLLBACK'); } catch (e) {}
  } finally {
    db.close();
  }
}

seedLocations();
