/**
 * Tests for the digital (RAW decoder) capability probe in serverCapabilities.
 *
 * Pins:
 *   - probe returns false + compute enabled (standalone) → digital: false
 *   - probe returns true  + compute enabled (standalone) → digital: true
 *   - no probe registered                              → digital: true (backward compat)
 *   - probe throws                                     → digital: false
 *   - SERVER_MODE=nas (compute disabled) + probe true  → digital: false
 */

const {
  getCapabilities,
  setDigitalAvailabilityProbe,
} = require('../serverCapabilities');

const ORIGINAL_SERVER_MODE = process.env.SERVER_MODE;

afterEach(() => {
  setDigitalAvailabilityProbe(null);
  if (ORIGINAL_SERVER_MODE === undefined) delete process.env.SERVER_MODE;
  else process.env.SERVER_MODE = ORIGINAL_SERVER_MODE;
});

describe('getCapabilities().capabilities.digital — RAW-decoder probe', () => {
  test('probe returns false + compute enabled (standalone) → digital: false', () => {
    process.env.SERVER_MODE = 'standalone';
    setDigitalAvailabilityProbe(() => false);
    expect(getCapabilities().capabilities.digital).toBe(false);
  });

  test('probe returns true + compute enabled (standalone) → digital: true', () => {
    process.env.SERVER_MODE = 'standalone';
    setDigitalAvailabilityProbe(() => true);
    expect(getCapabilities().capabilities.digital).toBe(true);
  });

  test('no probe registered → digital: true (backward compat)', () => {
    process.env.SERVER_MODE = 'standalone';
    expect(getCapabilities().capabilities.digital).toBe(true);
  });

  test('probe throws → digital: false', () => {
    process.env.SERVER_MODE = 'standalone';
    setDigitalAvailabilityProbe(() => { throw new Error('boom'); });
    expect(getCapabilities().capabilities.digital).toBe(false);
  });

  test('SERVER_MODE=nas (compute disabled) + probe true → digital: false', () => {
    process.env.SERVER_MODE = 'nas';
    setDigitalAvailabilityProbe(() => true);
    expect(getCapabilities().capabilities.digital).toBe(false);
    expect(getCapabilities().capabilities.compute).toBe(false);
  });

  test('setDigitalAvailabilityProbe(null) unregisters the probe', () => {
    process.env.SERVER_MODE = 'standalone';
    setDigitalAvailabilityProbe(() => false);
    expect(getCapabilities().capabilities.digital).toBe(false);
    setDigitalAvailabilityProbe(null);
    expect(getCapabilities().capabilities.digital).toBe(true);
  });
});
