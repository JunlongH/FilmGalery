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
export const { RenderCore, DEFAULT_FILM_CURVE, DEFAULT_CROP_RECT } = _sharedExports;
export default _sharedExports;
