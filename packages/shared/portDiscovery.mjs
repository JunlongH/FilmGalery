/**
 * 共享的服务发现配置
 * Shared service discovery configuration for server/mobile/watch/client
 * 
 * 支持两种发现模式:
 * 1. mDNS (Bonjour/Zeroconf) - 局域网零配置自动发现
 * 2. HTTP 端口扫描 - 适用于公网 IP 或 mDNS 不可用的场景
 */

// ==================== 通用配置 ====================

const APP_IDENTIFIER = 'FilmGallery';
const DISCOVERY_ENDPOINT = '/api/discover';
const DEFAULT_PORT = 4000;

// 端口扫描范围（按优先级排序）
const PORT_SCAN_RANGE = [4000, 4001, 4002, 4003, 4004, 4005, 4010, 4020, 4100];

// 发现请求超时时间 (ms)
const DISCOVERY_TIMEOUT = 2000;

// ==================== mDNS 配置 ====================

const MDNS_CONFIG = {
  // mDNS 服务类型 (遵循 RFC 6763 命名规范)
  SERVICE_TYPE: 'filmgallery',
  
  // 服务协议
  PROTOCOL: 'tcp',
  
  // 完整服务标识符
  get FULL_SERVICE_TYPE() {
    return `_${this.SERVICE_TYPE}._${this.PROTOCOL}`;
  },
  
  // mDNS 服务名称 (用户可见)
  SERVICE_NAME: 'FilmGallery Server',
  
  // mDNS 发现超时 (ms) - 局域网通常很快
  BROWSE_TIMEOUT: 5000,
  
  // TXT 记录字段
  TXT_RECORDS: {
    APP: 'app',
    VERSION: 'version',
    PORT: 'port',
    DEVICE: 'device'  // 用于区分多台设备
  }
};

// ==================== 发现模式 ====================

const DISCOVERY_MODE = {
  AUTO: 'auto',           // 自动选择（优先 mDNS，回退端口扫描）
  MDNS_ONLY: 'mdns',      // 仅 mDNS
  PORT_SCAN: 'portscan',  // 仅端口扫描（适用于公网）
  MANUAL: 'manual'        // 手动配置
};

// ==================== 工具函数 ====================

/**
 * 构建发现 URL
 */
function buildDiscoverUrl(host, port) {
  return `http://${host}:${port}${DISCOVERY_ENDPOINT}`;
}

/**
 * 清理 IP 地址输入（移除协议和端口）
 */
function cleanIpAddress(input) {
  if (!input) return '';
  let clean = String(input).trim();
  clean = clean.replace(/^https?:\/\//, '');
  clean = clean.replace(/:\d+$/, '');
  clean = clean.replace(/\/$/, '');
  return clean;
}

/**
 * 从 URL 提取端口号
 */
function extractPort(url) {
  if (!url) return null;
  const match = String(url).match(/:(\d+)(?:\/|$)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 构建完整 URL
 */
function buildUrl(ip, port) {
  const cleanIp = cleanIpAddress(ip);
  return `http://${cleanIp}:${port}`;
}

/**
 * 判断是否为局域网 IP
 */
function isPrivateIp(ip) {
  const cleanIp = cleanIpAddress(ip);
  // 10.x.x.x
  if (/^10\./.test(cleanIp)) return true;
  // 172.16.x.x - 172.31.x.x
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(cleanIp)) return true;
  // 192.168.x.x
  if (/^192\.168\./.test(cleanIp)) return true;
  // 169.254.x.x (Link-local)
  if (/^169\.254\./.test(cleanIp)) return true;
  // localhost
  if (cleanIp === 'localhost' || cleanIp === '127.0.0.1') return true;
  return false;
}

/**
 * 推荐发现模式（基于 IP 类型）
 */
function recommendDiscoveryMode(ip) {
  if (!ip) return DISCOVERY_MODE.AUTO;
  return isPrivateIp(ip) ? DISCOVERY_MODE.AUTO : DISCOVERY_MODE.PORT_SCAN;
}

// ==================== 导出 ====================

const _sharedExports = {
  // 常量
  APP_IDENTIFIER,
  DISCOVERY_ENDPOINT,
  DEFAULT_PORT,
  PORT_SCAN_RANGE,
  DISCOVERY_TIMEOUT,
  MDNS_CONFIG,
  DISCOVERY_MODE,
  
  // 工具函数
  buildDiscoverUrl,
  cleanIpAddress,
  extractPort,
  buildUrl,
  isPrivateIp,
  recommendDiscoveryMode
};
export const { APP_IDENTIFIER, DISCOVERY_ENDPOINT, DEFAULT_PORT, PORT_SCAN_RANGE, DISCOVERY_TIMEOUT, MDNS_CONFIG, DISCOVERY_MODE, buildDiscoverUrl, cleanIpAddress, extractPort, buildUrl, isPrivateIp, recommendDiscoveryMode } = _sharedExports;
export default _sharedExports;
