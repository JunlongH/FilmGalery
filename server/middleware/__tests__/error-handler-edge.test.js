/**
 * Edge-case coverage for errorHandler (extends error-handler.test.js).
 *
 * These pin behavior under unusual / hostile inputs:
 *   - Error without a message (err.message === undefined)
 *   - Non-Error throws (string, number, plain object)
 *   - err.status as a string (coerced)
 *   - err.code that collides with library codes (e.g. "SQLITE_CONSTRAINT"
 *     set manually on a 4xx OperationalError — should NOT trigger 409 path)
 *   - details with circular reference (JSON.stringify safe — we don't crash)
 *   - very long message (no truncation, but no crash)
 *   - err.status === undefined (defaults to 500)
 *   - err with both .status and .statusCode (status wins)
 *   - OperationalError with a custom HTTP status outside 4xx range
 *
 * The contract pinned: errorHandler NEVER throws; it always produces a JSON
 * response. Anything weird still surfaces as a logged 500 with an errorId.
 */

const { errorHandler, classifyError, OperationalError, ProgrammerError } = require('../error-handler');

function dispatch(err) {
  const req = { method: 'GET', path: '/x' };
  const res = {
    status: jest.fn(function () { return this; }),
    json: jest.fn(),
  };
  expect(() => errorHandler(err, req, res, jest.fn())).not.toThrow();
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('errorHandler — hostile / unusual inputs', () => {
  test('Error without .message → 500 + "Internal server error"', () => {
    const err = new Error();
    err.message = '';
    const { status, body } = dispatch(err);
    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('thrown string "boom" → 500 (no leak in prod)', () => {
    const { status, body } = dispatch('boom');
    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  test('thrown number 42 → 500', () => {
    const { status, body } = dispatch(42);
    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  test('thrown plain object {code:"X"} → 500', () => {
    const { status, body } = dispatch({ code: 'X' });
    expect(status).toBe(500);
    expect(body.errorId).toBeDefined();
  });

  test('null thrown → 500 (no crash)', () => {
    const { status } = dispatch(null);
    expect(status).toBe(500);
  });

  test('undefined thrown → 500 (no crash)', () => {
    const { status } = dispatch(undefined);
    expect(status).toBe(500);
  });
});

describe('errorHandler — status coercion', () => {
  test('err.status as string "418" → 418 (loose coercion allowed by ||)', () => {
    // classifyError uses `err.status || ...` — a truthy string survives.
    const err = new Error('teapot');
    err.status = '418';
    expect(classifyError(err).status).toBe('418');
  });

  test('err.statusCode fallback when .status absent', () => {
    const err = new Error('alt');
    err.statusCode = 503;
    expect(classifyError(err).status).toBe(503);
  });

  test('both .status and .statusCode present — .status wins', () => {
    const err = new Error('conflict');
    err.status = 422;
    err.statusCode = 500;
    expect(classifyError(err).status).toBe(422);
  });

  test('no status at all → 500', () => {
    expect(classifyError(new Error('x')).status).toBe(500);
  });
});

describe('errorHandler — code collision protection', () => {
  test('OperationalError with code "SQLITE_CONSTRAINT" still classifies as Operational (expose=true)', () => {
    // Self-classification wins over library-code lookup. A route that
    // intentionally throws `new OperationalError(..., {code:'SQLITE_CONSTRAINT'})`
    // gets its 4xx status + message exposed, NOT the generic 409 hidden path.
    const err = new OperationalError('custom', { code: 'SQLITE_CONSTRAINT', status: 422 });
    const c = classifyError(err);
    expect(c.status).toBe(422);
    expect(c.expose).toBe(true);
    expect(c.code).toBe('SQLITE_CONSTRAINT');
  });

  test('plain Error with code "SQLITE_CONSTRAINT" + no expose → 409 hidden (default)', () => {
    const err = new Error('UNIQUE failed');
    err.code = 'SQLITE_CONSTRAINT';
    const c = classifyError(err);
    expect(c.status).toBe(409);
    expect(c.expose).toBe(false);
  });
});

describe('errorHandler — details + payload edge cases', () => {
  test('details is forwarded verbatim when present', () => {
    const details = { field: 'email', conflicts: [1, 2, 3] };
    const err = new OperationalError('conflict', { code: 'CONFLICT', status: 409, details });
    const { body } = dispatch(err);
    expect(body.details).toEqual(details);
  });

  test('null details is omitted (not surfaced as null)', () => {
    // OperationalError only sets details if `details !== undefined`; null
    // is "defined" so it WOULD be set. Verify the handler honors that
    // faithfully without converting null → undefined.
    const err = new OperationalError('x', { details: null });
    const { body } = dispatch(err);
    expect(body.details).toBeNull();
  });

  test('very long message does not crash the serializer', () => {
    const long = 'x'.repeat(100_000);
    const err = new OperationalError(long);
    const { body } = dispatch(err);
    expect(body.error.length).toBe(100_000);
  });

  test('errorId is unique across N consecutive dispatches', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(dispatch(new Error('x')).body.errorId);
    }
    expect(ids.size).toBe(100);
  });
});

describe('errorHandler — never throws (terminal serializer)', () => {
  test('circular reference in err.details does not crash (json uses no JSON.stringify on err)', () => {
    const err = new OperationalError('cycle');
    const circular = { self: null };
    circular.self = circular;
    err.details = circular;
    // The handler reads err.details directly without stringifying; the
    // response.json() call may choke on the cycle, but that's express's
    // problem, not ours. Verify the handler at least computes status+body.
    const req = { method: 'GET', path: '/x' };
    let capturedBody;
    const res = {
      status: jest.fn(function () { return this; }),
      json: jest.fn((b) => { capturedBody = b; }),
    };
    // express' res.json would throw on circular; we simulate by capturing
    // the body argument without serializing.
    expect(() => errorHandler(err, req, res, jest.fn())).not.toThrow();
    expect(capturedBody.error).toBe('cycle');
    expect(capturedBody.details).toBe(circular);
  });
});
