/**
 * FilmLab Hooks Index
 *
 * 统一导出所有 FilmLab 自定义 Hooks
 *
 * P1-29: useFilmLabState / useFilmLabPipeline 已删除（1062 行死代码 + schema 不兼容）
 * - useFilmLabState: DEFAULT_DENSITY_LEVELS 扁平结构 vs FilmLab.jsx 嵌套 {red:{min,max}}
 * - useFilmLabState: DEFAULT_CURVES 0-1 范围 vs FilmLab.jsx 0-255
 * - useFilmLabPipeline: eventDependencies 只定义 4 个事件级联
 * 如需恢复，应先修复 schema 不一致并真正重构 FilmLab.jsx 使用它们
 *
 * @module hooks
 */


