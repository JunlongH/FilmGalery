/**
 * Tests for D-M1: AI photo tools must respect the session's photographyMode.
 *
 * search_photos / get_photo_detail / get_photo_neighbors receive a second
 * `context` arg ({ mode }) from ai-orchestrator and inject a source_type
 * filter built by packages/shared/photographyMode.buildSourceTypeClause:
 *   - film     → (p.source_type = 'film' OR p.source_type IS NULL)
 *   - digital  → p.source_type = 'digital'
 *   - all/undef→ '' (no filter; NULL-tolerance preserved on film branch only)
 *
 * The source clause is param-free, so existing param orderings are unchanged.
 *
 * db-helpers is mocked so no SQLite connection is opened
 * (digital-develop-service.test.js pattern).
 */

jest.mock('../../utils/db-helpers', () => ({
  runAsync: jest.fn(),
  allAsync: jest.fn().mockResolvedValue([]),
  getAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../db', () => ({}));

const PHOTO_TOOLS = require('../ai-tools/photo-tools');
const { getToolSchemas } = require('../ai-tools/index');
const { allAsync, getAsync } = require('../../utils/db-helpers');

beforeEach(() => {
  jest.clearAllMocks();
  allAsync.mockResolvedValue([]);
  getAsync.mockResolvedValue(null);
});

describe('photo-tools photographyMode filtering (D-M1)', () => {

  describe('search_photos', () => {
    test("film mode adds (p.source_type = 'film' OR p.source_type IS NULL)", async () => {
      await PHOTO_TOOLS.search_photos.handler({}, { mode: 'film' });
      const sql = allAsync.mock.calls[0][0];
      expect(sql).toMatch(/p\.source_type = 'film' OR p\.source_type IS NULL/);
    });

    test("digital mode adds p.source_type = 'digital' (no NULL tolerance)", async () => {
      await PHOTO_TOOLS.search_photos.handler({}, { mode: 'digital' });
      const sql = allAsync.mock.calls[0][0];
      expect(sql).toMatch(/p\.source_type = 'digital'/);
      expect(sql).not.toMatch(/IS NULL/);
    });

    test("no context arg → keeps 1=1, no source_type filter", async () => {
      await PHOTO_TOOLS.search_photos.handler({});
      const sql = allAsync.mock.calls[0][0];
      expect(sql).toMatch(/1=1/);
      expect(sql).not.toMatch(/source_type = 'digital'/);
      expect(sql).not.toMatch(/source_type IS NULL/);
    });

    test("context without mode → no source_type filter", async () => {
      await PHOTO_TOOLS.search_photos.handler({}, {});
      const sql = allAsync.mock.calls[0][0];
      expect(sql).not.toMatch(/source_type/);
    });

    test("'all' mode → no source_type filter", async () => {
      await PHOTO_TOOLS.search_photos.handler({}, { mode: 'all' });
      const sql = allAsync.mock.calls[0][0];
      expect(sql).not.toMatch(/source_type/);
    });

    test('film-mode clause adds no params (param order/length preserved)', async () => {
      await PHOTO_TOOLS.search_photos.handler({ roll_id: 9, limit: 5 }, { mode: 'film' });
      const params = allAsync.mock.calls[0][1];
      expect(params).toEqual([9, 5]);
    });
  });

  describe('get_photo_detail', () => {
    test("film mode adds film clause to WHERE", async () => {
      getAsync.mockResolvedValue({ id: 1, source_type: 'film' });
      await PHOTO_TOOLS.get_photo_detail.handler({ photo_id: 1 }, { mode: 'film' });
      const sql = getAsync.mock.calls[0][0];
      expect(sql).toMatch(/p\.source_type = 'film' OR p\.source_type IS NULL/);
    });

    test("digital mode adds digital clause to WHERE", async () => {
      await PHOTO_TOOLS.get_photo_detail.handler({ photo_id: 1 }, { mode: 'digital' });
      const sql = getAsync.mock.calls[0][0];
      expect(sql).toMatch(/p\.source_type = 'digital'/);
      expect(sql).not.toMatch(/IS NULL/);
    });

    test('no context → no source_type filter, params unchanged', async () => {
      await PHOTO_TOOLS.get_photo_detail.handler({ photo_id: 42 });
      const [sql, params] = getAsync.mock.calls[0];
      expect(sql).not.toMatch(/source_type/);
      expect(params).toEqual([42]);
    });

    test('film-mode clause adds no params', async () => {
      getAsync.mockResolvedValue({ id: 1, source_type: 'film' });
      await PHOTO_TOOLS.get_photo_detail.handler({ photo_id: 7 }, { mode: 'film' });
      const params = getAsync.mock.calls[0][1];
      expect(params).toEqual([7]);
    });
  });

  describe('get_photo_neighbors', () => {
    test('film mode applies clause to target lookup AND both neighbor queries', async () => {
      getAsync.mockResolvedValue({ roll_id: 3, frame_number: 5, display_seq: null });
      await PHOTO_TOOLS.get_photo_neighbors.handler({ photo_id: 1 }, { mode: 'film' });

      const targetSql = getAsync.mock.calls[0][0];
      expect(targetSql).toMatch(/photos\.source_type = 'film' OR photos\.source_type IS NULL/);

      const beforeSql = allAsync.mock.calls[0][0];
      const afterSql = allAsync.mock.calls[1][0];
      expect(beforeSql).toMatch(/photos\.source_type = 'film' OR photos\.source_type IS NULL/);
      expect(afterSql).toMatch(/photos\.source_type = 'film' OR photos\.source_type IS NULL/);
    });

    test('digital mode → target anchor cannot be a film photo', async () => {
      getAsync.mockResolvedValue(null);
      await PHOTO_TOOLS.get_photo_neighbors.handler({ photo_id: 1 }, { mode: 'digital' });
      const targetSql = getAsync.mock.calls[0][0];
      expect(targetSql).toMatch(/photos\.source_type = 'digital'/);
      expect(targetSql).not.toMatch(/IS NULL/);
    });

    test('no context → none of the three queries filter on source_type', async () => {
      getAsync.mockResolvedValue({ roll_id: 3, frame_number: 5, display_seq: null });
      await PHOTO_TOOLS.get_photo_neighbors.handler({ photo_id: 1 });

      expect(getAsync.mock.calls[0][0]).not.toMatch(/source_type/);
      expect(allAsync.mock.calls[0][0]).not.toMatch(/source_type/);
      expect(allAsync.mock.calls[1][0]).not.toMatch(/source_type/);
    });

    test('film-mode clause adds no params to any of the three queries', async () => {
      getAsync.mockResolvedValue({ roll_id: 3, frame_number: 5, display_seq: null });
      await PHOTO_TOOLS.get_photo_neighbors.handler({ photo_id: 1, count: 3 }, { mode: 'film' });

      expect(getAsync.mock.calls[0][1]).toEqual([1]);
      expect(allAsync.mock.calls[0][1]).toEqual([3, 5, 3]);
      expect(allAsync.mock.calls[1][1]).toEqual([3, 5, 3]);
    });
  });

  describe('non-photo tools are unaffected by the extra context arg', () => {
    test('get_roll_photos still works when called with a context arg', async () => {
      await PHOTO_TOOLS.get_roll_photos.handler({ roll_id: 4 }, { mode: 'film' });
      const [sql, params] = allAsync.mock.calls[0];
      expect(sql).not.toMatch(/source_type/);
      expect(params).toEqual([4]);
    });
  });

  describe("getToolSchemas hides get_roll_photos in digital mode (W2)", () => {
    const schemaNames = (mode) => getToolSchemas(mode).map(s => s.function.name);

    test("digital mode excludes get_roll_photos (roll-based, film-only data model)", () => {
      const names = schemaNames('digital');
      expect(names).not.toContain('get_roll_photos');
    });

    test("film mode includes get_roll_photos", () => {
      const names = schemaNames('film');
      expect(names).toContain('get_roll_photos');
    });

    test("'all' mode includes get_roll_photos", () => {
      const names = schemaNames('all');
      expect(names).toContain('get_roll_photos');
    });

    test("undefined mode includes get_roll_photos (defaults to all)", () => {
      const names = schemaNames(undefined);
      expect(names).toContain('get_roll_photos');
    });
  });
});
