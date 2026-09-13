(function (global) {
  'use strict';

  const IconResolver = {
    resolve(name) { return global.CDSIcons?.resolve?.(name) || String(name || 'fa-circle'); },
    html(name) { return (global.CDSUIHelpers || {}).iconHtml?.(name) || ''; },
    isEmoji(str) { return /[\u{1F300}-\u{1FAFF}]/u.test(String(str || '')); }
  };
  global.IconResolver = IconResolver;

  if (typeof module !== 'undefined' && module.exports) module.exports = IconResolver;
})(typeof window !== 'undefined' ? window : global);
