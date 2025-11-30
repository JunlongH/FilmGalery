#!/usr/bin/env node
// Run database migration to rename shooter to photographer

const path = require('path');
const migration = require('./migrations/2025-11-30-rename-shooter-to-photographer');

async function runMigration() {
  console.log('[MIGRATE] Starting migration: rename shooter to photographer');
  try {
    await migration.up();
    console.log('[MIGRATE] Migration completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATE] Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
