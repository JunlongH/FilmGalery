/**
 * Centralized Error Handling Middleware.
 *
 * Architecture (Phase 2C.2):
 *   - Errors flow as Error objects with structured properties: `status`,
 *     `code`, `expose`, optional `details`.
 *   - Routes/middleware either throw or `next(err)` — no inline
 *     `res.status(...).json(...)` for error paths (bucket-A rule).
 *   - This handler is the single serializer that maps any Error to a
 *     consistent JSON response.
 *
 * Classification contract:
 *   - `err.expose === true`  → message is safe to surface to the client
 *                              (4xx business errors: ValidationError,
 *                               NotFoundError, OperationalError subclass).
 *   - `err.expose === false` → hide message in production (5xx unexpected
 *                              failures: ProgrammerError, SQLite internal,
 *                              generic Error). Log + return generic text.
 *   - Special cases (SQLite, Multer) get a stable `code` even when hidden.
 *
 * Response shape:
 *   { ok:false, error:string, code?:string, details?:any, errorId:UUID }
 *
 * Mounted after all routes (server.js:301-303) — order regression covered by
 * server/middleware/__tests__/mount-order.test.js.
 */

const crypto = require('crypto');

/**
 * Base class for 4xx business errors whose message is safe for the client.
 * Subclass OperationalError to add a new operational category.
 */
class OperationalError extends Error {
  constructor(message, { code, status = 400, details } = {}) {
    super(message);
    this.name = 'OperationalError';
    this.status = status;
    this.code = code;
    this.expose = true;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Base class for 5xx unexpected failures. Message is never sent to the
 * client in production — the handler substitutes generic text and logs the
 * real message + stack with an errorId for correlation.
 */
class ProgrammerError extends Error {
  constructor(message, { code, status = 500 } = {}) {
    super(message);
    this.name = 'ProgrammerError';
    this.status = status;
    this.code = code;
    this.expose = false;
  }
}

class ValidationError extends OperationalError {
  constructor(message) {
    super(message, { code: 'VALIDATION_ERROR', status: 400 });
    this.name = 'ValidationError';
  }
}

class NotFoundError extends OperationalError {
  constructor(message = 'Resource not found') {
    super(message, { code: 'NOT_FOUND', status: 404 });
    this.name = 'NotFoundError';
  }
}

/**
 * Map any thrown error to { status, code, expose, details }.
 *
 * Order:
 *   1. Errors that carry `expose` (OperationalError/ProgrammerError or any
 *      error previously decorated by the throw site).
 *   2. Known DB/upload library codes (SQLite, Multer) — stable `code`,
 *      generic message to client.
 *   3. Auth failures (401/403/423) — message exposed (already safe).
 *   4. Fallback: 5xx hidden.
 */
function classifyError(err) {
  // 1. Self-classified (subclasses of Operational/ProgrammerError, or
  //    ad-hoc decorated errors with `expose` set).
  if (err.expose !== undefined) {
    return {
      status: err.status || err.statusCode || 500,
      code: err.code,
      expose: err.expose,
      details: err.details,
    };
  }

  // 2. SQLite
  if (err.code === 'SQLITE_CONSTRAINT') {
    return { status: 409, code: 'DB_CONSTRAINT', expose: false };
  }
  if (err.code === 'SQLITE_BUSY') {
    return { status: 503, code: 'DB_BUSY', expose: false };
  }

  // 3. Multer
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, code: 'FILE_TOO_LARGE', expose: false };
  }

  // 4. Auth-style status codes set by middleware (e.g. auth.js next(err)
  //    with err.status=401). Treat <500 as safe-to-expose by convention.
  if (err.status && err.status < 500) {
    return { status: err.status, code: err.code, expose: true };
  }

  // 5. Fallback: 5xx hidden
  return {
    status: err.status || err.statusCode || 500,
    code: err.code,
    expose: false,
  };
}

/**
 * Express error-handling middleware. Mounted after notFoundHandler so that
 * thrown errors from any route land here.
 *
 * Defensive: never throws itself. If a route throws a non-Error value
 * (string, null, plain object), we synthesize a 500 with an errorId so the
 * client still gets a stable JSON response and the operator still has a
 * log entry to grep.
 */
function errorHandler(err, req, res, next) {
  const errorId = crypto.randomUUID();
  const isDev = process.env.NODE_ENV === 'development';

  // Coerce hostile inputs (null/undefined/non-Error throws) into something
  // we can safely destructure. The original value is preserved in the log
  // for debugging.
  const safeErr = (err instanceof Error)
    ? err
    : new Error(typeof err === 'string' ? err : 'Non-Error throw');

  console.error(`[ERROR ${errorId}] ${req.method} ${req.path}:`, safeErr.stack || safeErr.message || err);

  const { status, code, expose, details } = classifyError(safeErr);
  const safeMessage = (expose || isDev)
    ? (safeErr.message || 'Error')
    : 'Internal server error';

  const body = {
    ok: false,
    error: safeMessage,
    errorId,
  };
  if (code) body.code = code;
  if (details !== undefined) body.details = details;

  res.status(status).json(body);
}

/**
 * 404 handler for unmatched routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: `Route not found: ${req.method} ${req.path}`,
    code: 'ROUTE_NOT_FOUND',
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  classifyError,
  OperationalError,
  ProgrammerError,
  ValidationError,
  NotFoundError,
};
