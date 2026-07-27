/**
 * Tests for digital-mode-migration log() — read-only dir resilience (D-P2-6).
 *
 * Locks:
 *   - log() never throws, even when fs.appendFileSync fails (EACCES/ENOENT
 *     on a read-only or non-existent DB dir, e.g. mounted NAS volume).
 *   - On append failure, log() falls back to console.warn with a clear prefix
 *     AND still emits the original message via console.log (format unchanged).
 *   - On append success, console.log is called exactly once and console.warn
 *     is NOT called (no spurious fallback).
 */

jest.mock('../../config/db-config', () => ({
  getDbPath: () => '/tmp/digital-mode-migration-test/film.db',
}));

const fs = require('fs');

describe('digital-mode-migration log() — read-only dir resilience (D-P2-6)', () => {
  let warnSpy;
  let logSpy;
  let appendSpy;

  beforeEach(() => {
    jest.resetModules();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    if (appendSpy) appendSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    jest.resetModules();
  });

  test('appendFileSync throwing EACCES → log() does NOT throw, console fallback fires', () => {
    appendSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      const err = new Error("EACCES: permission denied, access '/tmp/digital-mode-migration-test/digital-mode-migration.log'");
      err.code = 'EACCES';
      throw err;
    });

    const { _log } = require('../digital-mode-migration');

    // Must not throw.
    expect(() => _log('Starting digital-mode migration on: /x/film.db')).not.toThrow();

    // Fallback warn fired with the expected prefix + error code mention.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('[DIGITAL-MIGRATION]');
    expect(String(warnSpy.mock.calls[0][0])).toContain('EACCES');

    // Original message still goes to console.log (format unchanged).
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toBe('[DIGITAL-MIGRATION] Starting digital-mode migration on: /x/film.db');

    // appendFileSync was attempted (not skipped).
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  test('appendFileSync throwing ENOENT → same fallback path, no throw', () => {
    appendSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      const err = new Error("ENOENT: no such file or directory");
      err.code = 'ENOENT';
      throw err;
    });

    const { _log } = require('../digital-mode-migration');

    expect(() => _log('Tables ensured: app_config.')).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('ENOENT');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('Tables ensured: app_config.');
  });

  test('appendFileSync succeeds → console.log only, no fallback warn', () => {
    appendSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

    const { _log } = require('../digital-mode-migration');

    expect(() => _log('Backfill complete.')).not.toThrow();

    expect(appendSpy).toHaveBeenCalledTimes(1);
    // File-line format unchanged: [${ts}] ${msg}\n
    const [logPath, line] = appendSpy.mock.calls[0];
    expect(logPath).toBe('/tmp/digital-mode-migration-test/digital-mode-migration.log');
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] Backfill complete\.\n$/);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
