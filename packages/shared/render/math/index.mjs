import colorSpace from './color-space.mjs';
import exposure from './exposure.mjs';
import toneCurves from './tone-curves.mjs';

const _sharedExports = {
    ...colorSpace,
    ...exposure,
    ...toneCurves
};

export default _sharedExports;
