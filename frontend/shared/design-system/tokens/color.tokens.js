(function (global) {
  'use strict';

  const CDSColorTokens = Object.freeze({
    ink: '#1f2937',
    muted: '#6b7280',
    border: 'rgba(15, 23, 42, 0.08)',
    surface: '#f8fafc',
    bg: '#f5f7fa',
    white: '#ffffff',
    brand: '#1a5fb4',
    brandStrong: '#0d6efd',
    heroFrom: '#0f172a',
    heroMid: '#1e3a5f',
    heroTo: '#0d6efd',
    success: '#1f7a4c',
    successBg: '#e6f5ee',
    warning: '#8a6a08',
    warningBg: '#fbf3dc',
    danger: '#c62828',
    dangerBg: '#fdecea',
    info: '#1a5fb4',
    infoBg: '#e8f1fb',
    neutral: '#6b7280',
    neutralBg: '#f3f4f6',
    processing: '#4338ca',
    processingBg: '#eef2ff',
    online: '#16a34a',
    offline: '#94a3b8'
  });
  global.CDSColorTokens = CDSColorTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSColorTokens;
})(typeof window !== 'undefined' ? window : global);
