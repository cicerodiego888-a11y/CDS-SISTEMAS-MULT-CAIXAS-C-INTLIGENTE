(function (global) {
  'use strict';

  const ColorResolver = {
    get(key) { return (global.CDSColorTokens || {})[key] || key; },
    statusTone(status) {
      const s = String(status || '').toUpperCase();
      return (global.CDSColors?.status || {})[s] || 'neutral';
    },
    badgeTone(tone) {
      return (global.CDSColors?.badgeTone || {})[tone] || tone || 'neutral';
    }
  };
  global.ColorResolver = ColorResolver;

  if (typeof module !== 'undefined' && module.exports) module.exports = ColorResolver;
})(typeof window !== 'undefined' ? window : global);
