const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { addOrUpdateGear } = require('./server/services/gear-service');

// Mock the DB connection for the service
const dbPath = path.join(__dirname, 'server/film.db');
const db = new sqlite3.Database(dbPath);

// Mock the global db object that the service expects (if it relies on a global, 
// but looking at the code it imports db from ../db.js usually, let's check how the service gets the db)
// The service imports `runAsync` and `queryAsync` from `../db`. 
// I need to make sure the service uses the actual DB.

async function testDeduplication() {
  console.log('Starting deduplication test...');

  // 1. Setup: Create a dummy roll and insert "Junlong" and "Junlong Huang"
  // We need a valid roll_id. Let's pick one or create one.
  // To be safe, let's create a temporary entry in roll_gear directly if we can't easily create a roll.
  // But roll_gear has a foreign key constraint probably.
  
  // Let's find a valid roll ID first.
  const getRoll = () => new Promise((resolve, reject) => {
    db.get("SELECT id FROM rolls LIMIT 1", (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.id : null);
    });
  });

  const rollId = await getRoll();
  if (!rollId) {
    console.error("No rolls found to test with.");
    return;
  }
  console.log(`Testing with Roll ID: ${rollId}`);

  const type = 'photographer';

  // Clean up first
  const run = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  await run("DELETE FROM roll_gear WHERE roll_id = ? AND type = ?", [rollId, type]);

  // Scenario 1: DB has "Junlong Huang". We add "Junlong".
  console.log('\n--- Scenario 1: "Junlong Huang" exists. Add "Junlong" ---');
  await run("INSERT INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)", [rollId, type, 'Junlong Huang']);
  
  await addOrUpdateGear(rollId, type, 'Junlong');
  
  let rows = await new Promise((resolve, reject) => {
    db.all("SELECT value FROM roll_gear WHERE roll_id = ? AND type = ?", [rollId, type], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  console.log('Result:', rows.map(r => r.value));
  if (rows.length === 1 && rows[0].value === 'Junlong') {
    console.log('PASS: "Junlong Huang" was replaced by "Junlong"');
  } else {
    console.log('FAIL: Expected only "Junlong"');
  }

  // Scenario 2: DB has BOTH "Junlong" and "Junlong Huang". We add "Junlong" again (simulating user action or re-save).
  console.log('\n--- Scenario 2: Both exist. Add "Junlong" ---');
  await run("DELETE FROM roll_gear WHERE roll_id = ? AND type = ?", [rollId, type]);
  await run("INSERT INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)", [rollId, type, 'Junlong']);
  await run("INSERT INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)", [rollId, type, 'Junlong Huang']);

  await addOrUpdateGear(rollId, type, 'Junlong');

  rows = await new Promise((resolve, reject) => {
    db.all("SELECT value FROM roll_gear WHERE roll_id = ? AND type = ?", [rollId, type], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  console.log('Result:', rows.map(r => r.value));
  if (rows.length === 1 && rows[0].value === 'Junlong') {
    console.log('PASS: "Junlong Huang" was removed, "Junlong" kept');
  } else {
    console.log('FAIL: Expected only "Junlong"');
  }

}

testDeduplication().catch(console.error).finally(() => db.close());
