(function (global) {
  'use strict';

  const CDSLayout = Object.freeze({
    pageMax: '100%',
    shellNavWidth: '220px',
    shellMinHeight: '520px',
    pageHeader: 'cds-ui-page-header',
    breadcrumb: 'cds-ui-breadcrumb',
    toolbar: 'cds-ui-toolbar',
    sectionHeader: 'cds-ui-section-header',
    quickActions: 'cds-ui-quick-actions'
  });
  global.CDSLayout = CDSLayout;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSLayout;
})(typeof window !== 'undefined' ? window : global);
