/**
 * mDNS Service for FilmGallery Server
 * 
 * 提供局域网零配置服务发现功能 (Bonjour/Zeroconf)
 * 使用 bonjour-service 包实现跨平台 mDNS 广播
 * 
 * @module server/services/mdns-service
 */

const os = require('os');
// mDNS identity is shared with mobile/watch via @filmgallery/shared so all
// clients agree on the service type/name. (The previous "hardcoded to avoid
// circular dependency" note is obsolete — portDiscovery has no back-edges.)
const { MDNS_CONFIG } = require('@filmgallery/shared/portDiscovery');

// 全局状态
let bonjourInstance = null;
let publishedService = null;
let isEnabled = false;

/**
 * 获取主机名（用于服务标识）
 */
function getHostname() {
  return os.hostname() || 'filmgallery-server';
}

/**
 * 获取所有局域网 IPv4 地址
 */
function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过 IPv6 和内部地址
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          name,
          address: iface.address
        });
      }
    }
  }
  
  return addresses;
}

/**
 * 初始化 mDNS 服务
 * 
 * @param {Object} options
 * @param {number} options.port - 服务端口
 * @param {string} options.version - 应用版本
 * @returns {Promise<boolean>} 是否成功初始化
 */
async function initialize(options = {}) {
  const { port = 4000, version = '1.0.0' } = options;
  
  try {
    // 动态导入 bonjour-service（可能未安装）
    let Bonjour;
    try {
      Bonjour = require('bonjour-service').Bonjour;
    } catch (e) {
      console.log('[mDNS] bonjour-service not installed, mDNS disabled');
      console.log('[mDNS] To enable: npm install bonjour-service');
      return false;
    }
    
    // 创建 Bonjour 实例
    bonjourInstance = new Bonjour();
    
    const hostname = getHostname();
    const addresses = getLocalIPv4Addresses();
    
    // 发布服务
    publishedService = bonjourInstance.publish({
      name: `${MDNS_CONFIG.SERVICE_NAME} (${hostname})`,
      type: MDNS_CONFIG.SERVICE_TYPE,
      port: port,
      txt: {
        app: 'FilmGallery',
        version: version,
        port: String(port),
        device: hostname,
        // 额外信息
        platform: process.platform,
        arch: process.arch
      }
    });
    
    publishedService.on('up', () => {
      console.log(`[mDNS] ✅ Service published: ${MDNS_CONFIG.FULL_SERVICE_TYPE}`);
      console.log(`[mDNS]    Name: ${MDNS_CONFIG.SERVICE_NAME} (${hostname})`);
      console.log(`[mDNS]    Port: ${port}`);
      if (addresses.length > 0) {
        console.log(`[mDNS]    Addresses: ${addresses.map(a => a.address).join(', ')}`);
      }
    });
    
    publishedService.on('error', (err) => {
      console.error('[mDNS] Service error:', err.message);
    });
    
    isEnabled = true;
    return true;
    
  } catch (error) {
    console.error('[mDNS] Failed to initialize:', error.message);
    return false;
  }
}

/**
 * 更新服务端口（服务器端口变更时调用）
 * 
 * @param {number} newPort - 新端口
 */
function updatePort(newPort) {
  if (!isEnabled || !bonjourInstance) {
    return false;
  }
  
  try {
    // 取消现有服务
    if (publishedService) {
      publishedService.stop(() => {
        console.log('[mDNS] Previous service unpublished');
      });
    }
    
    // 重新发布新端口
    const hostname = getHostname();
    const appInfo = require('../constants/app-info');
    
    publishedService = bonjourInstance.publish({
      name: `${MDNS_CONFIG.SERVICE_NAME} (${hostname})`,
      type: MDNS_CONFIG.SERVICE_TYPE,
      port: newPort,
      txt: {
        app: 'FilmGallery',
        version: appInfo.APP_VERSION,
        port: String(newPort),
        device: hostname,
        platform: process.platform,
        arch: process.arch
      }
    });
    
    console.log(`[mDNS] Service updated to port ${newPort}`);
    return true;
    
  } catch (error) {
    console.error('[mDNS] Failed to update port:', error.message);
    return false;
  }
}

/**
 * 停止 mDNS 服务
 */
function shutdown() {
  if (!isEnabled) {
    return;
  }
  
  try {
    if (publishedService) {
      publishedService.stop(() => {
        console.log('[mDNS] Service stopped');
      });
      publishedService = null;
    }
    
    if (bonjourInstance) {
      bonjourInstance.destroy();
      bonjourInstance = null;
    }
    
    isEnabled = false;
    console.log('[mDNS] Shutdown complete');
    
  } catch (error) {
    console.error('[mDNS] Error during shutdown:', error.message);
  }
}

/**
 * 获取服务状态
 */
function getStatus() {
  return {
    enabled: isEnabled,
    serviceType: MDNS_CONFIG.FULL_SERVICE_TYPE,
    hostname: getHostname(),
    addresses: getLocalIPv4Addresses()
  };
}

/**
 * 检查 mDNS 是否可用
 */
function isAvailable() {
  try {
    require('bonjour-service');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  initialize,
  updatePort,
  shutdown,
  getStatus,
  isAvailable,
  getLocalIPv4Addresses,
  MDNS_CONFIG
};
