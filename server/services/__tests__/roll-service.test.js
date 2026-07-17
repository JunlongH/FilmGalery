/**
 * Tests for the start_date column migration in server/services/roll-service.js
 *
 * Locks the Phase 0–1 fix: on a fresh install the `start_date` column is added
 * by a migration that is currently disabled, so `recomputeRollSequence`
 * (which ORDER BY start_date) crashed at first run. `ensureStartDateColumn`
 * makes that add idempotent and backfills from date_loaded.
 *
 * Tested at the logic level by stubbing the data-access layer (db-helpers).
 * This precisely pins the migration's decision contract:
 *   - PRAGMA table_info(rolls) is consulted first
 *   - when start_date is absent: ALTER + backfill UPDATE run exactly once
 *   - when start_date is present: no ALTER, no UPDATE (idempotent, no crash)
 *
 * A real-sqlite integration variant can be layered on once the server's native
 * deps are installed in CI; the logic contract above is what this guard locks.
 */

jest.mock('../../utils/db-helpers', () => ({
  runAsync: jest.fn(),
  allAsync: jest.fn(),
  getAsync: jest.fn(),
}));

const { runAsync, allAsync } = require('../../utils/db-helpers');
const { ensureStartDateColumn } = require('../roll-service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureStartDateColumn — Phase 0–1 first-install fix', () => {
  test('adds start_date and backfills from date_loaded when absent', async () => {
    // Fresh install: rolls exists but has no start_date column.
    allAsync.mockResolvedValueOnce([{ name: 'id' }, { name: 'date_loaded' }]);
    runAsync.mockResolvedValue({}); // ALTER + UPDATE both succeed

    await ensureStartDateColumn();

    expect(allAsync).toHaveBeenCalledWith('PRAGMA table_info(rolls)');
    expect(runAsync).toHaveBeenCalledTimes(2);
    expect(runAsync).toHaveBeenNthCalledWith(
      1,
      'ALTER TABLE rolls ADD COLUMN start_date DATE'
    );
    expect(runAsync).toHaveBeenNthCalledWith(
      2,
      'UPDATE rolls SET start_date = date_loaded WHERE start_date IS NULL AND date_loaded IS NOT NULL'
    );
  });

  test('is a no-op when start_date already exists (idempotent — no crash on rerun)', async () => {
    allAsync.mockResolvedValueOnce([
      { name: 'id' },
      { name: 'start_date' },
      { name: 'date_loaded' },
    ]);

    await ensureStartDateColumn();

    expect(allAsync).toHaveBeenCalledWith('PRAGMA table_info(rolls)');
    // No ALTER, no UPDATE — the guard short-circuits.
    expect(runAsync).not.toHaveBeenCalled();
  });

  test('re-throws if the ALTER fails (does not silently swallow)', async () => {
    allAsync.mockResolvedValueOnce([{ name: 'id' }]);
    runAsync.mockRejectedValueOnce(new Error('ALTER failed: duplicate column'));

    await expect(ensureStartDateColumn()).rejects.toThrow('ALTER failed');
  });
});
