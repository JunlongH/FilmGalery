import { FILM_ITEM_STATUSES, type FilmItemStatusMobile } from '../src/constants/filmItemStatus';
import type { Film, Roll, Photo, Camera, Lens } from '../src/types';

describe('types/index (façade)', () => {
  test('Film type allows partial fields', () => {
    const film: Film = { name: 'Portra 400', iso: 400, format: '35mm' };
    expect(film.name).toBe('Portra 400');
  });

  test('Roll type allows partial fields', () => {
    const roll: Roll = { title: 'Summer 2024', date_loaded: '2024-06-01' };
    expect(roll.title).toBe('Summer 2024');
  });

  test('Photo type allows partial fields', () => {
    const photo: Photo = { filename: 'IMG_001.jpg', aperture: 2.8 };
    expect(photo.filename).toBe('IMG_001.jpg');
  });

  test('Camera type allows partial fields', () => {
    const camera: Camera = { brand: 'Leica', model: 'M6' };
    expect(camera.brand).toBe('Leica');
  });

  test('Lens type allows partial fields', () => {
    const lens: Lens = { brand: 'Voigtländer', model: 'Nokton 35/1.4' };
    expect(lens.brand).toBe('Voigtländer');
  });

  test('FilmItemStatusMobile union covers all statuses', () => {
    const statuses: FilmItemStatusMobile[] = FILM_ITEM_STATUSES;
    expect(statuses).toContain('loaded');
    expect(statuses).toContain('developed');
  });
});
