/**
 * ExposureCalculations - 曝光计算核心逻辑
 * 
 * 基于 EV (Exposure Value) 系统的曝光计算
 * 
 * 核心公式：
 * EV = log2(N² / t)  其中 N=光圈, t=快门速度(秒)
 * 
 * 对于特定 ISO：
 * EV_scene = EV_100 + log2(ISO / 100)
 * 
 * 反向计算：
 * t = N² / 2^EV  (已知光圈，计算快门)
 * N = sqrt(t × 2^EV)  (已知快门，计算光圈)
 * 
 * VERSION: 2025-12-11
 */

// 标准光圈档位 (1/3 档，覆盖 f/1.0 到 f/32)
export const STANDARD_APERTURES = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8,
  3.2, 3.5, 4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0, 9.0, 
  10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32
];

// 标准快门档位 (1/3 档，从 30" 到 1/8000)
export const STANDARD_SHUTTERS = [
  { display: '30"', value: 30 },
  { display: '25"', value: 25 },
  { display: '20"', value: 20 },
  { display: '15"', value: 15 },
  { display: '13"', value: 13 },
  { display: '10"', value: 10 },
  { display: '8"', value: 8 },
  { display: '6"', value: 6 },
  { display: '5"', value: 5 },
  { display: '4"', value: 4 },
  { display: '3"', value: 3.2 },
  { display: '2.5"', value: 2.5 },
  { display: '2"', value: 2 },
  { display: '1.6"', value: 1.6 },
  { display: '1.3"', value: 1.3 },
  { display: '1"', value: 1 },
  { display: '0.8"', value: 0.8 },
  { display: '0.6"', value: 0.6 },
  { display: '1/2', value: 0.5 },
  { display: '1/3', value: 1/3 },
  { display: '1/4', value: 0.25 },
  { display: '1/5', value: 0.2 },
  { display: '1/6', value: 1/6 },
  { display: '1/8', value: 0.125 },
  { display: '1/10', value: 0.1 },
  { display: '1/13', value: 1/13 },
  { display: '1/15', value: 1/15 },
  { display: '1/20', value: 1/20 },
  { display: '1/25', value: 1/25 },
  { display: '1/30', value: 1/30 },
  { display: '1/40', value: 1/40 },
  { display: '1/50', value: 1/50 },
  { display: '1/60', value: 1/60 },
  { display: '1/80', value: 1/80 },
  { display: '1/100', value: 1/100 },
  { display: '1/125', value: 1/125 },
  { display: '1/160', value: 1/160 },
  { display: '1/200', value: 1/200 },
  { display: '1/250', value: 1/250 },
  { display: '1/320', value: 1/320 },
  { display: '1/400', value: 1/400 },
  { display: '1/500', value: 1/500 },
  { display: '1/640', value: 1/640 },
  { display: '1/800', value: 1/800 },
  { display: '1/1000', value: 1/1000 },
  { display: '1/1250', value: 1/1250 },
  { display: '1/1600', value: 1/1600 },
  { display: '1/2000', value: 1/2000 },
  { display: '1/2500', value: 1/2500 },
  { display: '1/3200', value: 1/3200 },
  { display: '1/4000', value: 1/4000 },
  { display: '1/5000', value: 1/5000 },
  { display: '1/6400', value: 1/6400 },
  { display: '1/8000', value: 1/8000 },
];

/**
 * 将快门字符串解析为秒数
 * @param {string} shutterStr - 如 "1/125" 或 "2""
 * @returns {number} - 秒数
 */
export function parseShutterToSeconds(shutterStr: string): number {
  if (typeof shutterStr === 'number') return shutterStr;
  
  const str = String(shutterStr).trim();
  
  // 处理带引号的秒数 (如 "2"")
  if (str.endsWith('"') || str.endsWith('s')) {
    return parseFloat(str);
  }
  
  // 处理分数 (如 "1/125")
  if (str.includes('/')) {
    const [num, denom] = str.split('/').map(Number);
    return num / denom;
  }
  
  return parseFloat(str) || 1/125;
}

/**
 * 将秒数转换为快门显示字符串
 * @param {number} seconds - 快门速度(秒)
 * @returns {string} - 显示字符串
 */
export function secondsToShutterDisplay(seconds: number): string {
  if (seconds >= 1) {
    return `${Math.round(seconds)}"`;
  }
  
  // 找到最接近的标准快门
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

/**
 * 找到最接近的标准快门
 * @param {number} targetSeconds - 目标快门速度(秒)
 * @returns {{ display: string, value: number }} - 最接近的标准快门
 */
export function findClosestStandardShutter(targetSeconds: number): any {
  let closest = STANDARD_SHUTTERS[0];
  let minDiff = Math.abs(Math.log2(targetSeconds) - Math.log2(closest.value));
  
  for (const shutter of STANDARD_SHUTTERS) {
    const diff = Math.abs(Math.log2(targetSeconds) - Math.log2(shutter.value));
    if (diff < minDiff) {
      minDiff = diff;
      closest = shutter;
    }
  }
  
  return closest;
}

/**
 * 找到最接近的标准光圈
 * @param {number} targetAperture - 目标光圈值
 * @returns {number} - 最接近的标准光圈
 */
export function findClosestStandardAperture(targetAperture: number): any {
  let closest = STANDARD_APERTURES[0];
  let minDiff = Math.abs(Math.log2(targetAperture) - Math.log2(closest));
  
  for (const aperture of STANDARD_APERTURES) {
    const diff = Math.abs(Math.log2(targetAperture) - Math.log2(aperture));
    if (diff < minDiff) {
      minDiff = diff;
      closest = aperture;
    }
  }
  
  return closest;
}

/**
 * 根据场景 EV 和 ISO 计算曝光参数
 * 
 * @param {number} sceneEV - 场景 EV 值 (从亮度分析获得)
 * @param {number} filmISO - 胶片 ISO
 * @param {string} mode - 'av' (光圈优先) | 'tv' (快门优先) | 'ps' (程序)
 * @param {number|string} fixedValue - 固定值 (Av模式下是光圈, Tv模式下是快门)
 * @returns {object} - { ev, aperture, shutter, shutterDisplay, isValid }
 */
export function calculateExposure(sceneEV: any, filmISO: any, mode: any, fixedValue: any, options: any = {}): any {
  // 验证输入
  if (sceneEV === null || sceneEV === undefined || isNaN(sceneEV)) {
    return {
      ev: null,
      aperture: null,
      shutter: null,
      shutterDisplay: '--',
      isValid: false,
      error: 'Invalid scene EV'
    };
  }

  // 场景 EV 已经是基于当前测量的值
  // 我们需要根据胶片 ISO 调整
  // EV_film = EV_scene + log2(filmISO / 100)
  // 但实际上，场景 EV 是固定的，我们只需要用它来计算曝光组合
  
  // 对于 ISO 100: EV = log2(N² / t)
  // 对于其他 ISO: 需要调整
  // 如果 ISO 更高，可以用更快的快门或更小的光圈
  // ISO 调整: 每倍 ISO = 1 档 EV
  
  const isoAdjustment = Math.log2(filmISO / 100);
  const effectiveEV = sceneEV + isoAdjustment;

  let aperture, shutter, shutterDisplay, useFlash = false;

  if (mode === 'av') {
    // 光圈优先: 用户设置光圈，计算快门
    aperture = typeof fixedValue === 'number' ? fixedValue : parseFloat(fixedValue);
    
    if (!aperture || aperture <= 0) {
      aperture = 5.6; // 默认值
    }
    
    // t = N² / 2^EV
    shutter = (aperture * aperture) / Math.pow(2, effectiveEV);
    
    // 限制在合理范围内
    shutter = Math.max(1/8000, Math.min(30, shutter));
    
    const closestShutter = findClosestStandardShutter(shutter);
    shutterDisplay = closestShutter.display;
    shutter = closestShutter.value;
    
  } else if (mode === 'tv') {
    // 快门优先: 用户设置快门，计算光圈
    shutter = parseShutterToSeconds(fixedValue);
    
    if (!shutter || shutter <= 0) {
      shutter = 1/125; // 默认值
    }
    
    // N = sqrt(t × 2^EV)
    const apertureSquared = shutter * Math.pow(2, effectiveEV);
    aperture = Math.sqrt(apertureSquared);
    
    // 限制在合理范围内
    aperture = Math.max(1.0, Math.min(22, aperture));
    aperture = findClosestStandardAperture(aperture);
    
    shutterDisplay = secondsToShutterDisplay(shutter);
    
  } else {
    // 程序模式 (ps): Point & Shoot 自动曝光算法
    // 注意：测光始终使用 flash OFF，然后根据环境光 EV 值推算是否需要闪光灯
    // 这样可以避免打开手机闪光灯，纯粹通过算法推算 PS 机的曝光策略
    const maxAperture = options.maxAperture || 2.8;
    const flashMode = options.flashMode || 'off'; // 用户设置: 'auto' | 'on' | 'off'
    
    // 定义阈值 (基于环境光 effectiveEV)
    const BRIGHT_THRESHOLD = 12;  // 光线充足阈值
    const DARK_THRESHOLD = 8;     // 光线不足阈值
    const MIN_SHUTTER = 1/30;     // 最慢快门速度（手持防抖）
    const SYNC_SHUTTER = 1/60;    // 闪光同步速度
    
    let useFlash = false;
    
    if (effectiveEV >= BRIGHT_THRESHOLD) {
      // 场景1：光线充足 (EV >= 12)
      // 收小光圈以获得更大景深，快门较快
      aperture = 8;
      shutter = (aperture * aperture) / Math.pow(2, effectiveEV);
      
      // 如果快门过快，可以进一步缩小光圈
      if (shutter < 1/1000) {
        aperture = 11;
        shutter = (aperture * aperture) / Math.pow(2, effectiveEV);
      }
      useFlash = false;
      
    } else if (effectiveEV >= DARK_THRESHOLD) {
      // 场景2：光线不足但尚可 (8 <= EV < 12)
      // 开大光圈，降低快门
      aperture = Math.min(maxAperture, 4);
      shutter = (aperture * aperture) / Math.pow(2, effectiveEV);
      
      // 检查是否需要/使用闪光灯
      if (flashMode === 'on' || (flashMode === 'auto' && shutter > MIN_SHUTTER)) {
        useFlash = true;
        shutter = SYNC_SHUTTER;
        // 闪光灯补光，可以收小光圈增加景深
        aperture = 5.6;
      } else {
        // 不用闪光灯，确保快门不低于手持极限
        if (shutter > MIN_SHUTTER) {
          shutter = MIN_SHUTTER;
          // 反推所需光圈
          aperture = Math.sqrt(shutter * Math.pow(2, effectiveEV));
          aperture = Math.max(maxAperture, Math.min(aperture, 5.6));
        }
      }
      
    } else {
      // 场景3：光线严重不足 (EV < 8)
      if (flashMode === 'auto' || flashMode === 'on') {
        // 使用闪光灯
        useFlash = true;
        shutter = SYNC_SHUTTER;
        aperture = 5.6; // 闪光灯模式下的标准光圈
      } else {
        // 禁止闪光：只能延长快门或开大光圈
        aperture = maxAperture;
        shutter = (aperture * aperture) / Math.pow(2, effectiveEV);
        
        // 快门可能会很慢，需要提示用户使用三脚架
        if (shutter > 1) {
          // 限制在 1 秒以内（除非特殊情况）
          shutter = Math.min(shutter, 1);
        }
        useFlash = false;
      }
    }
    
    // 限制在合理范围内
    shutter = Math.max(1/8000, Math.min(30, shutter));
    aperture = Math.max(1.0, Math.min(22, aperture));
    aperture = findClosestStandardAperture(aperture);
    
    const closestShutter = findClosestStandardShutter(shutter);
    shutterDisplay = closestShutter.display;
    shutter = closestShutter.value;
  }

  return {
    ev: effectiveEV,
    sceneEV: sceneEV,
    aperture: aperture,
    shutter: shutter,
    shutterDisplay: shutterDisplay,
    // 兼容旧 UI 的字段名
    targetAperture: aperture,
    targetShutter: shutterDisplay,
    isValid: true,
    filmISO: filmISO,
    mode: mode,
    useFlash: useFlash  // PS 模式下的闪光灯使用建议
  };
}

/**
 * 格式化曝光参数用于显示
 * @param {object} exposure - calculateExposure 的返回值
 * @returns {object} - 格式化的显示字符串
 */
export function formatExposureForDisplay(exposure: any): any {
  if (!exposure || !exposure.isValid) {
    return {
      ev: '--',
      aperture: 'f/--',
      shutter: '--',
      iso: '--'
    };
  }

  return {
    ev: `EV ${exposure.ev?.toFixed(1) || '--'}`,
    aperture: `f/${exposure.aperture?.toFixed(1) || '--'}`,
    shutter: exposure.shutterDisplay || '--',
    iso: `ISO ${exposure.filmISO || '--'}`
  };
}
