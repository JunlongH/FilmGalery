/**
 * HeroUI Tailwind 插件桥接（供 Tailwind v4 的 @plugin 指令加载）
 *
 * primary 色阶对齐应用品牌蓝（blue-600 #2563eb），
 * 保证 bg-primary / text-primary-foreground 等语义类与设计系统一致。
 */

const { heroui } = require('@heroui/theme/plugin');

const primaryScale = {
  50: '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
};

module.exports = heroui({
  themes: {
    light: {
      colors: {
        primary: { ...primaryScale, DEFAULT: '#2563eb', foreground: '#ffffff' },
      },
    },
    dark: {
      colors: {
        primary: { ...primaryScale, DEFAULT: '#3b82f6', foreground: '#ffffff' },
      },
    },
  },
});
