import { configureApi, api } from '../src/api/client';

describe('api/client', () => {
  test('api is defined after module load', () => {
    expect(api).toBeDefined();
    expect(api.http).toBeDefined();
    expect(typeof api.http.get).toBe('function');
  });

  test('configureApi does not throw', () => {
    expect(() => configureApi('http://localhost:4000')).not.toThrow();
    expect(() => configureApi('http://localhost:4000', 'http://backup:4000')).not.toThrow();
    expect(() => configureApi('')).not.toThrow();
  });

  test('api.equipment has expected resource methods', () => {
    expect(api.equipment).toBeDefined();
    expect(typeof api.equipment.cameras.list).toBe('function');
    expect(typeof api.equipment.lenses.list).toBe('function');
  });

  test('api.rolls has expected methods', () => {
    expect(api.rolls).toBeDefined();
    expect(typeof api.rolls.list).toBe('function');
  });

  test('api.photos has expected methods', () => {
    expect(api.photos).toBeDefined();
    expect(typeof api.photos.getRandom).toBe('function');
  });
});
