(function (global) {
  'use strict';


  function esc(v) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(v ?? ''));
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function iconHtml(name) {
    const resolved = global.CDSIcons?.resolve?.(name) || global.IconResolver?.resolve?.(name) || name || 'fa-circle';
    const cls = String(resolved).includes('fa-') ? resolved : 'fa-' + resolved;
    return '<i class="fas ' + esc(cls) + '" aria-hidden="true"></i>';
  }
  function labelOr(text, domain) {
    if (domain && global.AdaptiveLabelService?.getLabel) {
      return global.AdaptiveLabelService.getLabel(domain);
    }
    return text || '';
  }

  const CDSUIHelpers = { esc, iconHtml, labelOr };
  global.CDSUIHelpers = CDSUIHelpers;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSUIHelpers;
})(typeof window !== 'undefined' ? window : global);
