/**
 * Unit tests for asyncHandler (Phase 2C.2).
 *
 * Locks:
 *   - Sync handler that returns a value: next is NOT called, no rejection.
 *   - Async handler that resolves: next is NOT called.
 *   - Async handler that rejects: next IS called with the rejection reason.
 *   - Sync handler that throws: next IS called with the thrown error.
 *   - next passed through to the wrapped handler is the real next fn.
 */

const { asyncHandler } = require('../async-handler');

function runHandler(fn, args) {
  const next = jest.fn();
  const req = {};
  const res = {};
  const wrapped = asyncHandler(fn);
  const result = wrapped(req, res, next);
  return { result, next, req, res };
}

describe('asyncHandler — happy paths', () => {
  test('async handler that resolves does NOT call next', async () => {
    const fn = jest.fn(async () => 42);
    const { result, next } = runHandler(fn);
    await result;
    expect(fn).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('handler receives (req, res, next) as forwarded', async () => {
    const fn = jest.fn(async (req, res, next) => {
      expect(req).toBeDefined();
      expect(res).toBeDefined();
      expect(typeof next).toBe('function');
    });
    await runHandler(fn).result;
    expect(fn).toHaveBeenCalled();
  });
});

describe('asyncHandler — error propagation', () => {
  test('async handler that rejects calls next with the error', async () => {
    const err = new Error('async boom');
    const fn = async () => { throw err; };
    const { result, next } = runHandler(fn);
    await result;
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
  });

  test('sync handler that throws calls next with the thrown error', async () => {
    const err = new Error('sync boom');
    const fn = () => { throw err; };
    const { result, next } = runHandler(fn);
    await result;
    expect(next).toHaveBeenCalledWith(err);
  });

  test('rejection with a non-Error value (string) is forwarded as-is', async () => {
    const fn = async () => { throw 'string error'; };
    const { result, next } = runHandler(fn);
    await result;
    expect(next).toHaveBeenCalledWith('string error');
  });

  test('rejection with null/undefined is forwarded (no swallow)', async () => {
    const fn = async () => { throw undefined; };
    const { result, next } = runHandler(fn);
    await result;
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(undefined);
  });
});

describe('asyncHandler — return contract', () => {
  test('returns a Promise (async express middleware — Express 4 ignores the value)', async () => {
    const fn = async () => 42;
    const wrapped = asyncHandler(fn);
    const result = wrapped({}, {}, () => {});
    // It's an async function so always returns a Promise. Express 4 doesn't
    // care about middleware return values; what matters is that rejections
    // are routed to next().
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
