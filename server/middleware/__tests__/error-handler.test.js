/**
 * Unit tests for the centralized errorHandler (Phase 2C.2.1).
 *
 * Locks:
 *   - errorId is a UUID (crypto.randomUUID format), unique per request.
 *   - OperationalError (and subclasses ValidationError/NotFoundError) expose
 *     their message; ProgrammerError hides it in production.
 *   - Special cases (SQLite/Multer) get a stable `code` with generic text.
 *   - Auth-style status<500 (set by auth.js) exposes message.
 *   - 5xx default hides err.message and emits "Internal server error".
 *   - Production mode stripping works (NODE_ENV !== 'development').
 *
 * The handler is a pure serializer — we feed it Error objects and assert on
 * res.json payload + res.status. No supertest needed.
 */

const { errorHandler, classifyError, OperationalError, ProgrammerError, ValidationError, NotFoundError } = require('../error-handler');

function runHandler(err, { nodeEnv = 'test' } = {}) {
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  const req = { method: 'GET', path: '/x' };
  const status = jest.fn();
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })) };
  // The above line shape: res.status(N) returns { json }.
  // Refine: simpler chain.
  const res2 = { status: jest.fn(function () { return this; }), json: jest.fn() };
  // Use res2.
  errorHandler(err, req, res2, jest.fn());
  process.env.NODE_ENV = origEnv;
  return { status: res2.status.mock.calls[0][0], body: res2.json.mock.calls[0][0] };
}

describe('classifyError — self-classified (subclasses)', () => {
  test('OperationalError exposes message + code + status', () => {
    const err = new OperationalError('bad input', { code: 'BAD_INPUT', status: 422 });
    expect(classifyError(err)).toMatchObject({
      status: 422, code: 'BAD_INPUT', expose: true,
    });
  });

  test('ValidationError → 400 + VALIDATION_ERROR', () => {
    const err = new ValidationError('missing field');
    expect(classifyError(err)).toMatchObject({
      status: 400, code: 'VALIDATION_ERROR', expose: true,
    });
  });

  test('NotFoundError → 404 + NOT_FOUND', () => {
    const err = new NotFoundError('Photo not found');
    expect(classifyError(err)).toMatchObject({
      status: 404, code: 'NOT_FOUND', expose: true,
    });
  });

  test('ProgrammerError hides message, 5xx', () => {
    const err = new ProgrammerError('null deref', { code: 'INTERNAL' });
    expect(classifyError(err)).toMatchObject({
      status: 500, code: 'INTERNAL', expose: false,
    });
  });

  test('details pass-through', () => {
    const err = new OperationalError('conflict', { code: 'CONFLICT', status: 409, details: { field: 'name' } });
    expect(classifyError(err).details).toEqual({ field: 'name' });
  });
});

describe('classifyError — library-special', () => {
  test('SQLITE_CONSTRAINT → 409 hidden', () => {
    const err = new Error('UNIQUE constraint failed: photos.id');
    err.code = 'SQLITE_CONSTRAINT';
    expect(classifyError(err)).toMatchObject({ status: 409, code: 'DB_CONSTRAINT', expose: false });
  });

  test('SQLITE_BUSY → 503 hidden', () => {
    const err = new Error('database is locked');
    err.code = 'SQLITE_BUSY';
    expect(classifyError(err)).toMatchObject({ status: 503, code: 'DB_BUSY', expose: false });
  });

  test('LIMIT_FILE_SIZE (Multer) → 413 hidden', () => {
    const err = new Error('File too large');
    err.code = 'LIMIT_FILE_SIZE';
    expect(classifyError(err)).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE', expose: false });
  });
});

describe('classifyError — auth-style status<500', () => {
  test('err.status=401 with code → exposed (set by auth.js)', () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    expect(classifyError(err)).toMatchObject({ status: 401, code: 'UNAUTHORIZED', expose: true });
  });

  test('err.status=423 (pairing locked) → exposed', () => {
    const err = new Error('locked');
    err.status = 423;
    expect(classifyError(err)).toMatchObject({ status: 423, expose: true });
  });

  test('err.status=500 without expose → hidden', () => {
    const err = new Error('boom');
    err.status = 500;
    expect(classifyError(err)).toMatchObject({ status: 500, expose: false });
  });
});

describe('classifyError — plain Error fallback', () => {
  test('plain Error → 500 hidden', () => {
    const err = new Error('unexpected');
    expect(classifyError(err)).toMatchObject({ status: 500, expose: false });
    expect(classifyError(err).code).toBeUndefined();
  });
});

describe('errorHandler — response shape', () => {
  test('errorId is a UUID (36 chars, v4 format)', () => {
    const { body } = runHandler(new Error('x'));
    expect(body.errorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('successive calls produce distinct errorIds', () => {
    const a = runHandler(new Error('a')).body.errorId;
    const b = runHandler(new Error('b')).body.errorId;
    expect(a).not.toBe(b);
  });

  test('ValidationError → 400 with message exposed in production', () => {
    const { status, body } = runHandler(new ValidationError('name is required'), { nodeEnv: 'production' });
    expect(status).toBe(400);
    expect(body.error).toBe('name is required');
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.ok).toBe(false);
  });

  test('NotFoundError → 404 with custom message', () => {
    const { status, body } = runHandler(new NotFoundError('Photo not found'), { nodeEnv: 'production' });
    expect(status).toBe(404);
    expect(body.error).toBe('Photo not found');
    expect(body.code).toBe('NOT_FOUND');
  });

  test('ProgrammerError in production → 500 generic message (no leak)', () => {
    const { status, body } = runHandler(new ProgrammerError('cannot read undefined.x'), { nodeEnv: 'production' });
    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('ProgrammerError in development → exposes real message', () => {
    const { body } = runHandler(new ProgrammerError('cannot read undefined.x'), { nodeEnv: 'development' });
    expect(body.error).toBe('cannot read undefined.x');
  });

  test('plain Error → 500 generic in production, real in dev', () => {
    const prod = runHandler(new Error('boom'), { nodeEnv: 'production' });
    expect(prod.body.error).toBe('Internal server error');

    const dev = runHandler(new Error('boom'), { nodeEnv: 'development' });
    expect(dev.body.error).toBe('boom');
  });

  test('SQLITE_CONSTRAINT → 409 generic, stable code', () => {
    const err = new Error('UNIQUE constraint failed');
    err.code = 'SQLITE_CONSTRAINT';
    const { status, body } = runHandler(err, { nodeEnv: 'production' });
    expect(status).toBe(409);
    expect(body.code).toBe('DB_CONSTRAINT');
    expect(body.error).toBe('Internal server error');
  });

  test('auth.js-style 401 → message exposed', () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    const { status, body } = runHandler(err, { nodeEnv: 'production' });
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('OperationalError with details → details surfaced', () => {
    const err = new OperationalError('conflict', {
      code: 'CONFLICT', status: 409,
      details: { conflictingIds: [1, 2, 3] },
    });
    const { body } = runHandler(err, { nodeEnv: 'production' });
    expect(body.details).toEqual({ conflictingIds: [1, 2, 3] });
  });
});
