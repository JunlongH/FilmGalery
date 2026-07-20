/**
 * Tests for recomputeRollSequence — Phase 2C.1.3 contract.
 *
 * Locks the post-refactor behavior:
 *   - Schema (display_seq, start_date) is owned by schema-migration.js, NOT
 *     by runtime ensure-column checks. roll-service.js no longer exports
 *     ensureDisplaySeqColumn / ensureStartDateColumn.
 *   - recomputeRollSequence is a single window-function UPDATE wrapped in
 *     BEGIN/COMMIT, replacing the previous N+1 JS loop.
 *
 * Tested at the logic level by stubbing db-helpers. The contract pinned:
 *   - SELECT COUNT(*) gates the empty-table case
 *   - BEGIN → UPDATE … ROW_NUMBER() OVER (…) → COMMIT sequence
 *   - failure between BEGIN and COMMIT triggers ROLLBACK and re-throws
 */

jest.mock('../../utils/db-helpers', () => ({
  runAsync: jest.fn(),
  allAsync: jest.fn(),
  getAsync: jest.fn(),
}));

const dbHelpers = require('../../utils/db-helpers');
const { recomputeRollSequence } = require('../roll-service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recomputeRollSequence — 2C.1.3 window-function contract', () => {
  test('empty rolls table → no-op (no transaction started)', async () => {
    dbHelpers.getAsync.mockResolvedValueOnce({ count: 0 });

    const result = await recomputeRollSequence();

    expect(result).toEqual({ count: 0 });
    expect(dbHelpers.runAsync).not.toHaveBeenCalled();
  });

  test('non-empty table → BEGIN → window UPDATE → COMMIT', async () => {
    dbHelpers.getAsync.mockResolvedValueOnce({ count: 42 });
    dbHelpers.runAsync.mockResolvedValue();

    const result = await recomputeRollSequence();

    expect(result).toEqual({ count: 42 });
    expect(dbHelpers.runAsync).toHaveBeenCalledTimes(3);
    expect(dbHelpers.runAsync.mock.calls[0][0]).toBe('BEGIN');
    expect(dbHelpers.runAsync.mock.calls[1][0]).toMatch(/ROW_NUMBER\(\)\s+OVER/);
    expect(dbHelpers.runAsync.mock.calls[1][0]).toMatch(/PARTITION BY|ORDER BY/);
    expect(dbHelpers.runAsync.mock.calls[2][0]).toBe('COMMIT');
  });

  test('UPDATE failure → ROLLBACK + re-throw', async () => {
    dbHelpers.getAsync.mockResolvedValueOnce({ count: 5 });
    dbHelpers.runAsync
      .mockResolvedValueOnce() // BEGIN
      .mockRejectedValueOnce(new Error('disk I/O')); // UPDATE fails
    dbHelpers.runAsync.mockResolvedValue(); // ROLLBACK

    await expect(recomputeRollSequence()).rejects.toThrow('disk I/O');

    // Last run call must be ROLLBACK (best-effort recovery).
    const lastCall = dbHelpers.runAsync.mock.calls.at(-1);
    expect(lastCall[0]).toBe('ROLLBACK');
  });

  test('ROLLBACK itself failing is swallowed (primary error still propagates)', async () => {
    dbHelpers.getAsync.mockResolvedValueOnce({ count: 5 });
    dbHelpers.runAsync
      .mockResolvedValueOnce() // BEGIN
      .mockRejectedValueOnce(new Error('primary')) // UPDATE fails
      .mockRejectedValueOnce(new Error('rollback failed')); // ROLLBACK fails too

    await expect(recomputeRollSequence()).rejects.toThrow('primary');
  });
});

describe('roll-service public surface (2C.1.3)', () => {
  test('does NOT export runtime ensure-column fallbacks', () => {
    const svc = require('../roll-service');
    expect(svc.ensureDisplaySeqColumn).toBeUndefined();
    expect(svc.ensureStartDateColumn).toBeUndefined();
    expect(typeof svc.recomputeRollSequence).toBe('function');
  });
});
