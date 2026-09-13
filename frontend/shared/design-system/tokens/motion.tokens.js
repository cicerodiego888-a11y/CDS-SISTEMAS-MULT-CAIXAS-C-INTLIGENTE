(function (global) {
  'use strict';

  const CDSMotionTokens = Object.freeze({
    durationFast: '120ms',
    durationBase: '180ms',
    durationSlow: '280ms',
    ease: 'ease',
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    fade: 'cds-ui-fade',
    slide: 'cds-ui-slide',
    scale: 'cds-ui-scale',
    collapse: 'cds-ui-collapse',
    expand: 'cds-ui-expand'
  });
  global.CDSMotionTokens = CDSMotionTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSMotionTokens;
})(typeof window !== 'undefined' ? window : global);
