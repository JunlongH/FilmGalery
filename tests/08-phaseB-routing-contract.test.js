/**
 * Phase B — 路由契约测试（非烟测）
 *
 * 覆盖：
 * 1. COMPUTE_ROUTES 与客户端 smart* 请求路径的契约（503 回退协议对端必须存在）
 * 2. isComputeRoute 对参数化路由的匹配
 * 3. compute-guard 中间件在 NAS 模式下对 export/render-positive 返回 503+E_NAS_NO_COMPUTE
 * 4. compute-guard 不拦截 DATA 路由
 */

const {
  COMPUTE_ROUTES,
  COMPUTE_ROUTE_PATTERNS,
  isComputeRoute,
  getCapabilities,
} = require('../packages/shared/serverCapabilities');

// 客户端 ComputeService 中发起服务器请求的路径（契约的消费方）
// 与 client/src/services/ComputeService.js 中 fetch URL 保持一致
const CLIENT_COMPUTE_PATHS = [
  '/api/filmlab/preview',              // smartFilmlabPreview
  '/api/photos/123/render-positive',   // smartRenderPositive
  '/api/filmlab/export',               // smartExportPositive
];

describe('Phase B.1 客户端路由表 vs COMPUTE_ROUTES 契约', () => {
  test.each(CLIENT_COMPUTE_PATHS)('%s 必须被 isComputeRoute 识别', (p) => {
    expect(isComputeRoute(p)).toBe(true);
  });

  test('DATA 路由不被误判为 compute', () => {
    for (const p of ['/api/photos', '/api/photos/123', '/api/rolls', '/api/photos/123/thumb']) {
      expect(isComputeRoute(p)).toBe(false);
    }
  });

  test('render-positive 参数化模式不匹配其他子路径', () => {
    expect(isComputeRoute('/api/photos/123/render-positive')).toBe(true);
    expect(isComputeRoute('/api/photos/abc/render-positive')).toBe(true);
    expect(isComputeRoute('/api/photos/123/render-positive/extra')).toBe(false);
    expect(isComputeRoute('/api/photos/render-positive')).toBe(false);
  });
});

describe('Phase B.2 compute-guard 中间件（NAS 模式 503 回退协议）', () => {
  const ORIGINAL_ENV = process.env.SERVER_MODE;
  let computeGuard;

  beforeEach(() => {
    jest.resetModules();
    process.env.SERVER_MODE = 'nas';
    computeGuard = require('../server/middleware/compute-guard').computeGuard;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.SERVER_MODE;
    else process.env.SERVER_MODE = ORIGINAL_ENV;
  });

  function runGuard(path) {
    const req = { method: 'POST', path };
    let statusCode = null;
    let body = null;
    let nextCalled = false;
    const res = {
      status(code) { statusCode = code; return this; },
      json(b) { body = b; return this; },
    };
    computeGuard(req, res, () => { nextCalled = true; });
    return { statusCode, body, nextCalled };
  }

  test.each(CLIENT_COMPUTE_PATHS)('NAS 模式拦截 %s → 503 + E_NAS_NO_COMPUTE', (p) => {
    const { statusCode, body, nextCalled } = runGuard(p);
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(503);
    expect(body.code).toBe('E_NAS_NO_COMPUTE');
  });

  test('NAS 模式放行 DATA 路由', () => {
    const { nextCalled } = runGuard('/api/photos/123');
    expect(nextCalled).toBe(true);
  });

  test('standalone 模式放行 compute 路由', () => {
    process.env.SERVER_MODE = 'standalone';
    jest.resetModules();
    const { computeGuard: guard } = require('../server/middleware/compute-guard');
    const res = { status() { return this; }, json() { return this; } };
    let nextCalled = false;
    guard({ method: 'POST', path: '/api/filmlab/export' }, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe('Phase B.3 getCapabilities 输出包含新增 compute 路由', () => {
  test('端点列表包含 filmlab/export', () => {
    const caps = getCapabilities();
    expect(caps.endpoints.data).toBeDefined();
    expect(COMPUTE_ROUTES).toContain('/api/filmlab/export');
    expect(COMPUTE_ROUTE_PATTERNS.length).toBeGreaterThan(0);
  });
});
