/**
 * Service Discovery Utility for Mobile App
 * 
 * 支持两种发现模式:
 * 1. mDNS (Bonjour/Zeroconf) - 局域网零配置自动发现
 * 2. HTTP 端口扫描 - 适用于公网 IP 或 mDNS 不可用的场景
 * 
 * @module mobile/utils/portDiscovery
 */

import Zeroconf from 'react-native-zeroconf';

// ==================== 配置常量 + 纯工具函数 ====================
// Constants and pure helpers come from @filmgallery/shared so server/mobile/watch
// agree (single source). The fully-qualified mDNS service name is derived here
// (trailing dot, RFC 6763). Only the runtime scanning/mDNS logic below is
// mobile-specific.
import {
  PORT_SCAN_RANGE,
  DISCOVERY_TIMEOUT,
  APP_IDENTIFIER,
  DISCOVERY_MODE,
  MDNS_CONFIG,
  cleanIpAddress,
  extractPort,
  buildUrl,
  isPrivateIp,
} from '@filmgallery/shared/portDiscovery';
export { DISCOVERY_MODE, cleanIpAddress, extractPort, buildUrl, isPrivateIp };

const MDNS_SERVICE_TYPE = `_${MDNS_CONFIG.SERVICE_TYPE}._${MDNS_CONFIG.PROTOCOL}.`;
const MDNS_BROWSE_TIMEOUT = MDNS_CONFIG.BROWSE_TIMEOUT;



// ==================== HTTP 端口扫描 ====================

/**
 * Try to discover FilmGallery server on a specific port
 * @param {string} ip - Server IP address
 * @param {number} port - Port to try
 * @returns {Promise<{port: number, version: string}|null>}
 */
async function probePort(ip, port) {
  try {
    const url = `http://${ip}:${port}/api/discover`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT);
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.app === APP_IDENTIFIER) {
        return {
          port: data.port || port,
          version: data.version || 'unknown'
        };
      }
    }
  } catch (e) {
    // Port not reachable or not FilmGallery, silently ignore
  }
  return null;
}

/**
 * Discover FilmGallery server port by scanning common ports
 * @param {string} ip - Server IP address (without port)
 * @returns {Promise<{port: number, fullUrl: string, version: string, method: string}|null>}
 */
export async function discoverByPortScan(ip) {
  const cleanIp = cleanIpAddress(ip);
  if (!cleanIp) return null;
  
  // Scan all ports in parallel for speed
  const promises = PORT_SCAN_RANGE.map(port => probePort(cleanIp, port));
  const results = await Promise.all(promises);
  
  // Find first successful result
  for (let i = 0; i < results.length; i++) {
    if (results[i]) {
      return {
        port: results[i].port,
        fullUrl: `http://${cleanIp}:${results[i].port}`,
        version: results[i].version,
        method: 'portscan',
        ip: cleanIp
      };
    }
  }
  
  return null;
}

// ==================== mDNS 发现 ====================

// Zeroconf 单例
let zeroconfInstance = null;

/**
 * 获取或创建 Zeroconf 实例
 */
function getZeroconf() {
  if (!zeroconfInstance) {
    try {
      zeroconfInstance = new Zeroconf();
    } catch (e) {
      console.warn('[mDNS] Zeroconf not available:', e.message);
      return null;
    }
  }
  return zeroconfInstance;
}

/**
 * 通过 mDNS 发现局域网内的 FilmGallery 服务
 * @param {number} timeout - 超时时间 (ms)
 * @returns {Promise<Array<{name: string, ip: string, port: number, fullUrl: string, version: string, device: string, method: string}>>}
 */
export function discoverByMdns(timeout = MDNS_BROWSE_TIMEOUT) {
  return new Promise((resolve) => {
    const zeroconf = getZeroconf();
    
    if (!zeroconf) {
      console.log('[mDNS] Zeroconf not available, skipping mDNS discovery');
      resolve([]);
      return;
    }
    
    const services = [];
    let timeoutId = null;
    let resolved = false;
    
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      try {
        zeroconf.stop();
        zeroconf.removeAllListeners();
      } catch (e) {
        // Ignore cleanup errors
      }
    };
    
    // 发现服务
    zeroconf.on('resolved', (service) => {
      console.log('[mDNS] Service resolved:', service.name);
      
      // 提取 TXT 记录
      const txt = service.txt || {};
      const ip = service.addresses?.[0] || service.host;
      const port = service.port || parseInt(txt.port, 10) || 4000;
      
      if (ip) {
        services.push({
          name: service.name,
          ip: ip,
          port: port,
          fullUrl: `http://${ip}:${port}`,
          version: txt.version || 'unknown',
          device: txt.device || service.name,
          method: 'mdns'
        });
      }
    });
    
    zeroconf.on('error', (err) => {
      console.warn('[mDNS] Error:', err);
    });
    
    // 超时处理
    timeoutId = setTimeout(() => {
      console.log(`[mDNS] Browse timeout (${timeout}ms), found ${services.length} services`);
      cleanup();
      resolve(services);
    }, timeout);
    
    // 开始扫描
    try {
      console.log(`[mDNS] Starting browse for ${MDNS_SERVICE_TYPE}`);
      zeroconf.scan(MDNS_SERVICE_TYPE.slice(0, -1)); // 移除末尾的点
    } catch (e) {
      console.warn('[mDNS] Scan failed:', e.message);
      cleanup();
      resolve([]);
    }
  });
}

/**
 * 停止 mDNS 扫描
 */
export function stopMdnsDiscovery() {
  const zeroconf = getZeroconf();
  if (zeroconf) {
    try {
      zeroconf.stop();
      zeroconf.removeAllListeners();
    } catch (e) {
      // Ignore
    }
  }
}

// ==================== 统一发现接口 ====================

/**
 * 自动发现 FilmGallery 服务
 * 
 * @param {Object} options
 * @param {string} options.mode - 发现模式 (auto/mdns/portscan)
 * @param {string} options.ip - IP 地址 (portscan 模式必需)
 * @param {number} options.timeout - 超时时间 (ms)
 * @param {function} options.onProgress - 进度回调
 * @returns {Promise<{services: Array, primaryService: Object|null}>}
 */
export async function discoverServices(options = {}) {
  const {
    mode = DISCOVERY_MODE.AUTO,
    ip = null,
    timeout = MDNS_BROWSE_TIMEOUT,
    onProgress = null
  } = options;
  
  const services = [];
  let primaryService = null;
  
  // 模式选择
  const shouldTryMdns = mode === DISCOVERY_MODE.AUTO || mode === DISCOVERY_MODE.MDNS_ONLY;
  const shouldTryPortScan = mode === DISCOVERY_MODE.AUTO || mode === DISCOVERY_MODE.PORT_SCAN;
  
  // Step 1: 尝试 mDNS 发现
  if (shouldTryMdns) {
    if (onProgress) onProgress({ step: 'mdns', status: 'scanning' });
    
    try {
      const mdnsServices = await discoverByMdns(timeout);
      services.push(...mdnsServices);
      
      if (mdnsServices.length > 0) {
        console.log(`[Discovery] Found ${mdnsServices.length} services via mDNS`);
        primaryService = mdnsServices[0]; // 使用第一个发现的服务
      }
    } catch (e) {
      console.warn('[Discovery] mDNS discovery failed:', e.message);
    }
    
    if (onProgress) {
      onProgress({ 
        step: 'mdns', 
        status: 'complete', 
        found: services.length 
      });
    }
  }
  
  // Step 2: 端口扫描 (如果有 IP 且需要)
  if (shouldTryPortScan && ip) {
    // 如果已经通过 mDNS 找到且 IP 匹配，跳过端口扫描
    const cleanIp = cleanIpAddress(ip);
    const alreadyFound = services.some(s => s.ip === cleanIp);
    
    if (!alreadyFound) {
      if (onProgress) onProgress({ step: 'portscan', status: 'scanning', ip: cleanIp });
      
      try {
        const portScanResult = await discoverByPortScan(cleanIp);
        
        if (portScanResult) {
          services.push(portScanResult);
          if (!primaryService) {
            primaryService = portScanResult;
          }
          console.log(`[Discovery] Found service via port scan: ${portScanResult.fullUrl}`);
        }
      } catch (e) {
        console.warn('[Discovery] Port scan failed:', e.message);
      }
      
      if (onProgress) {
        onProgress({ 
          step: 'portscan', 
          status: 'complete', 
          found: services.length 
        });
      }
    }
  }
  
  return {
    services,
    primaryService
  };
}

// ==================== 兼容性接口 ====================

/**
 * 发现服务端口（兼容旧 API）
 * @param {string} ip - Server IP address (without port)
 * @returns {Promise<{port: number, fullUrl: string, version: string}|null>}
 */
export async function discoverPort(ip) {
  const cleanIp = cleanIpAddress(ip);
  
  // 判断是否为局域网 IP
  if (isPrivateIp(cleanIp)) {
    // 局域网：先尝试 mDNS，再尝试端口扫描
    const result = await discoverServices({
      mode: DISCOVERY_MODE.AUTO,
      ip: cleanIp,
      timeout: 3000
    });
    
    if (result.primaryService) {
      return {
        port: result.primaryService.port,
        fullUrl: result.primaryService.fullUrl,
        version: result.primaryService.version,
        method: result.primaryService.method
      };
    }
  } else {
    // 公网：仅端口扫描
    return await discoverByPortScan(cleanIp);
  }
  
  return null;
}

/**
 * Validate if a URL points to a FilmGallery server
 * @param {string} url - Full URL to validate
 * @returns {Promise<{valid: boolean, version?: string}>}
 */
export async function validateServer(url) {
  try {
    const cleanUrl = url.replace(/\/$/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT);
    
    const response = await fetch(`${cleanUrl}/api/discover`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.app === APP_IDENTIFIER) {
        return { valid: true, version: data.version };
      }
    }
  } catch (e) {
    // Not reachable or not valid
  }
  return { valid: false };
}

// ==================== 默认导出 ====================

export default {
  // 发现函数
  discoverServices,
  discoverPort,
  discoverByMdns,
  discoverByPortScan,
  stopMdnsDiscovery,
  validateServer,
  
  // 工具函数
  cleanIpAddress,
  extractPort,
  buildUrl,
  isPrivateIp,
  
  // 常量
  DISCOVERY_MODE,
  PORT_SCAN_RANGE,
  DISCOVERY_TIMEOUT,
  MDNS_BROWSE_TIMEOUT
};
