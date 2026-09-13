(function (global) {
  'use strict';

  const CDSIcons = Object.freeze({
    library: 'fontawesome',
    prefix: 'fas',
    map: Object.freeze({
      ok: 'fa-check-circle',
      warn: 'fa-exclamation-triangle',
      error: 'fa-times-circle',
      info: 'fa-info-circle',
      loading: 'fa-spinner fa-spin',
      empty: 'fa-inbox',
      offline: 'fa-plug',
      online: 'fa-wifi',
      refresh: 'fa-sync-alt',
      bolt: 'fa-bolt',
      chart: 'fa-chart-bar',
      brain: 'fa-brain',
      tasks: 'fa-tasks',
      history: 'fa-history',
      stream: 'fa-stream',
      sitemap: 'fa-sitemap',
      home: 'fa-home'
    }),
    resolve(name) {
      const key = String(name || '').replace(/^fa-/, '');
      const mapped = this.map[key] || this.map[name];
      if (mapped) return mapped.startsWith('fa-') ? mapped : 'fa-' + mapped;
      if (String(name || '').startsWith('fa-')) return name;
      return 'fa-' + (key || 'circle');
    },
    /** Emojis NÃO são ícones oficiais de UI */
    forbidEmojiAsIcon: true
  });
  global.CDSIcons = CDSIcons;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSIcons;
})(typeof window !== 'undefined' ? window : global);
