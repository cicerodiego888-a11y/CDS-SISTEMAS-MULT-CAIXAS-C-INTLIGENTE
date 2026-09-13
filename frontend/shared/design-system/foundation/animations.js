(function (global) {
  'use strict';

  const CDSAnimations = Object.freeze({
    fade: 'cds-ui-anim--fade',
    slide: 'cds-ui-anim--slide',
    scale: 'cds-ui-anim--scale',
    collapse: 'cds-ui-anim--collapse',
    expand: 'cds-ui-anim--expand'
  });
  global.CDSAnimations = CDSAnimations;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSAnimations;
})(typeof window !== 'undefined' ? window : global);
