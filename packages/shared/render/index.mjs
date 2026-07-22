/**
 * FilmLab 渲染模块入口
 * 
 * @module render
 */

'use strict';

import { RenderCore, DEFAULT_FILM_CURVE, DEFAULT_CROP_RECT } from './RenderCore.mjs';

const _sharedExports = {
  RenderCore,
  DEFAULT_FILM_CURVE,
  DEFAULT_CROP_RECT,
};
const _e_RenderCore = _sharedExports.RenderCore;
export { _e_RenderCore as RenderCore };
const _e_DEFAULT_FILM_CURVE = _sharedExports.DEFAULT_FILM_CURVE;
export { _e_DEFAULT_FILM_CURVE as DEFAULT_FILM_CURVE };
const _e_DEFAULT_CROP_RECT = _sharedExports.DEFAULT_CROP_RECT;
export { _e_DEFAULT_CROP_RECT as DEFAULT_CROP_RECT };
export default _sharedExports;
