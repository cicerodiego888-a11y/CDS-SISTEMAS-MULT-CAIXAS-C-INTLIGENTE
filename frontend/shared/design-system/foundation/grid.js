(function (global) {
  'use strict';

  const CDSGridFoundation = Object.freeze({
    kpiMin: '180px',
    widgetMin: '260px',
    gap: '0.75rem',
    className: 'cds-ui-grid',
    kpiClass: 'cds-ui-grid cds-ui-grid--kpi',
    widgetClass: 'cds-ui-grid cds-ui-grid--widgets'
  });
  global.CDSGridFoundation = CDSGridFoundation;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSGridFoundation;
})(typeof window !== 'undefined' ? window : global);
