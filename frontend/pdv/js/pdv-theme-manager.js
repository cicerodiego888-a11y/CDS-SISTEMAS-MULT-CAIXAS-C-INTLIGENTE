/**
 * ThemeManager exclusivo do PDV — Aparência Enterprise (Sprint P0.1).
 * Aplica classes/atributos CSS, preview ao vivo e persistência local.
 * Não altera regras de negócio, TEF, NFC-e ou fluxo de venda.
 */
(function (global) {
  'use strict';

  var STORAGE_PREFIX = 'cds.pdv.appearance.v1';
  var ROOT_ATTRS = ['data-pdv-theme', 'data-pdv-font', 'data-pdv-scale', 'data-pdv-intensity'];

  var DEFAULTS = Object.freeze({
    theme: 'claro',
    font: 'md',
    scale: '100',
    intensity: 'normal'
  });

  var THEMES = Object.freeze([
    { id: 'claro', label: 'Claro' },
    { id: 'escuro', label: 'Escuro' },
    { id: 'alto-contraste', label: 'Alto Contraste' },
    { id: 'azul', label: 'Azul' },
    { id: 'verde', label: 'Verde' },
    { id: 'ambar', label: 'Âmbar' },
    { id: 'automatico', label: 'Automático', disabled: true, hint: 'Em breve' }
  ]);

  var FONTS = Object.freeze([
    { id: 'sm', label: 'Pequena' },
    { id: 'md', label: 'Média' },
    { id: 'lg', label: 'Grande' },
    { id: 'xl', label: 'Extra Grande' }
  ]);

  var SCALES = Object.freeze([
    { id: '100', label: '100%' },
    { id: '110', label: '110%' },
    { id: '125', label: '125%' },
    { id: '140', label: '140%' }
  ]);

  var INTENSITIES = Object.freeze([
    { id: 'baixa', label: 'Baixa', value: 0 },
    { id: 'normal', label: 'Normal', value: 1 },
    { id: 'alta', label: 'Alta', value: 2 }
  ]);

  var _draft = null;
  var _applied = null;
  var _listeners = [];

  function clonePrefs(prefs) {
    return {
      theme: prefs.theme,
      font: prefs.font,
      scale: prefs.scale,
      intensity: prefs.intensity
    };
  }

  function sanitize(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var themeOk = THEMES.some(function (t) { return t.id === src.theme && !t.disabled; });
    var fontOk = FONTS.some(function (f) { return f.id === src.font; });
    var scaleOk = SCALES.some(function (s) { return s.id === src.scale; });
    var intensityOk = INTENSITIES.some(function (i) { return i.id === src.intensity; });
    return {
      theme: themeOk ? src.theme : DEFAULTS.theme,
      font: fontOk ? src.font : DEFAULTS.font,
      scale: scaleOk ? src.scale : DEFAULTS.scale,
      intensity: intensityOk ? src.intensity : DEFAULTS.intensity
    };
  }

  function storageKey() {
    var tid = null;
    try {
      if (typeof terminalId !== 'undefined' && terminalId !== null && terminalId !== '') {
        tid = String(terminalId);
      } else if (global.localStorage) {
        tid = localStorage.getItem('cds_terminal_id') || localStorage.getItem('terminal_id');
      }
    } catch (e) {
      tid = null;
    }
    return tid ? STORAGE_PREFIX + '.t' + tid : STORAGE_PREFIX;
  }

  function readStored() {
    try {
      var raw = global.localStorage.getItem(storageKey());
      if (!raw) {
        // Fallback: preferência global do PDV (antes do terminal registrar)
        raw = global.localStorage.getItem(STORAGE_PREFIX);
      }
      if (!raw) return clonePrefs(DEFAULTS);
      return sanitize(JSON.parse(raw));
    } catch (e) {
      return clonePrefs(DEFAULTS);
    }
  }

  function writeStored(prefs) {
    var clean = sanitize(prefs);
    try {
      global.localStorage.setItem(storageKey(), JSON.stringify(clean));
      // Espelho global para boot antes do terminal_id
      global.localStorage.setItem(STORAGE_PREFIX, JSON.stringify(clean));
    } catch (e) {
      console.warn('[PdvThemeManager] Falha ao persistir aparência:', e);
    }
    return clean;
  }

  function applyToDom(prefs, root) {
    var clean = sanitize(prefs);
    var el = root || document.documentElement;
    el.setAttribute('data-pdv-theme', clean.theme);
    el.setAttribute('data-pdv-font', clean.font);
    el.setAttribute('data-pdv-scale', clean.scale);
    el.setAttribute('data-pdv-intensity', clean.intensity);

    // Escala só no shell do PDV (não altera zoom global do Electron).
    // Em escalas >100%, o CSS (data-pdv-scale) libera overflow-y no page-content
    // para evitar clipping — preferências e API do painel permanecem iguais.
    var shells = document.querySelectorAll('.pdv-profissional');
    var zoomVal = (Number(clean.scale) / 100) || 1;
    for (var i = 0; i < shells.length; i++) {
      shells[i].style.zoom = zoomVal;
    }

    return clean;
  }

  function notify() {
    var snapshot = getState();
    for (var i = 0; i < _listeners.length; i++) {
      try {
        _listeners[i](snapshot);
      } catch (e) {
        console.warn('[PdvThemeManager] listener error:', e);
      }
    }
  }

  function getState() {
    return {
      draft: clonePrefs(_draft || DEFAULTS),
      applied: clonePrefs(_applied || DEFAULTS),
      dirty: JSON.stringify(_draft) !== JSON.stringify(_applied)
    };
  }

  function setDraft(partial) {
    _draft = sanitize(Object.assign({}, _draft || DEFAULTS, partial || {}));
    applyToDom(_draft);
    notify();
    return clonePrefs(_draft);
  }

  function preview(partial) {
    return setDraft(partial);
  }

  function apply() {
    _applied = writeStored(_draft || _applied || DEFAULTS);
    _draft = clonePrefs(_applied);
    applyToDom(_applied);
    notify();
    return clonePrefs(_applied);
  }

  function resetDraft() {
    _draft = clonePrefs(_applied || DEFAULTS);
    applyToDom(_draft);
    notify();
    return clonePrefs(_draft);
  }

  function restore() {
    _applied = readStored();
    _draft = clonePrefs(_applied);
    applyToDom(_applied);
    notify();
    return clonePrefs(_applied);
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    _listeners.push(fn);
    return function unsubscribe() {
      _listeners = _listeners.filter(function (x) { return x !== fn; });
    };
  }

  function boot() {
    restore();
  }

  // Boot antecipado (antes do HTML do PDV) para evitar flash do tema padrão
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.PdvThemeManager = {
    DEFAULTS: DEFAULTS,
    THEMES: THEMES,
    FONTS: FONTS,
    SCALES: SCALES,
    INTENSITIES: INTENSITIES,
    getState: getState,
    getDraft: function () { return clonePrefs(_draft || DEFAULTS); },
    getApplied: function () { return clonePrefs(_applied || DEFAULTS); },
    setDraft: setDraft,
    preview: preview,
    apply: apply,
    resetDraft: resetDraft,
    restore: restore,
    onChange: onChange,
    storageKey: storageKey,
    applyToDom: applyToDom
  };
})(window);
