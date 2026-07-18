import { useTheme } from '../providers/HeroUIProvider';

/**
 * useIsDarkMode — 全应用唯一的暗色判定入口
 *
 * 基于 HeroUIProvider 的 theme context（localStorage 优先 → data-theme → 系统偏好），
 * 替代各组件复制粘贴的 MutationObserver / classList.contains('dark') 检测。
 * 判定结果与 Tailwind 的 .dark class 策略严格一致。
 *
 * @returns {boolean} 当前是否为暗色模式
 */
export default function useIsDarkMode() {
  const { theme } = useTheme();
  return theme === 'dark';
}
