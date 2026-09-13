/** CDS UI Foundation bundle — gerado automaticamente (DS-001) */
/* eslint-disable */

/* ===== tokens/color.tokens.js ===== */

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


/* ===== tokens/spacing.tokens.js ===== */

(function (global) {
  'use strict';

  const CDSSpacingTokens = Object.freeze({
    xs: '0.25rem',
    sm: '0.45rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.35rem',
    '2xl': '1.75rem',
    cardPadding: '1rem 1.1rem',
    heroPadding: '1.1rem 1.35rem',
    kpiPadding: '0.75rem 0.85rem',
    sectionGap: '0.85rem',
    gridGap: '0.75rem'
  });
  global.CDSSpacingTokens = CDSSpacingTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSpacingTokens;
})(typeof window !== 'undefined' ? window : global);


/* ===== tokens/radius.tokens.js ===== */

(function (global) {
  'use strict';

  const CDSRadiusTokens = Object.freeze({
    sm: '8px',
    md: '10px',
    lg: '12px',
    pill: '999px',
    card: '10px',
    hero: '12px',
    kpi: '10px',
    badge: '999px',
    button: '8px'
  });
  global.CDSRadiusTokens = CDSRadiusTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSRadiusTokens;
})(typeof window !== 'undefined' ? window : global);


/* ===== tokens/typography.tokens.js ===== */

(function (global) {
  'use strict';

  const CDSTypographyTokens = Object.freeze({
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    heroTitle: '1.2rem',
    heroSub: '0.82rem',
    cardTitle: '0.78rem',
    kpiLabel: '0.7rem',
    kpiValue: '0.95rem',
    body: '0.875rem',
    hint: '0.72rem',
    badge: '0.68rem',
    weightBold: 700,
    weightSemi: 600,
    weightRegular: 400
  });
  global.CDSTypographyTokens = CDSTypographyTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTypographyTokens;
})(typeof window !== 'undefined' ? window : global);


/* ===== tokens/shadow.tokens.js ===== */

(function (global) {
  'use strict';

  const CDSShadowTokens = Object.freeze({
    none: 'none',
    sm: '0 1px 2px rgba(16, 24, 40, 0.06)',
    md: '0 4px 24px rgba(15, 23, 42, 0.06)',
    lg: '0 8px 32px rgba(15, 23, 42, 0.10)',
    focus: '0 0 0 2px rgba(13, 110, 253, 0.15)',
    card: '0 1px 2px rgba(16, 24, 40, 0.06)',
    hero: '0 4px 24px rgba(15, 23, 42, 0.06)',
    kpi: '0 1px 2px rgba(16, 24, 40, 0.06)'
  });
  global.CDSShadowTokens = CDSShadowTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSShadowTokens;
})(typeof window !== 'undefined' ? window : global);


/* ===== tokens/motion.tokens.js ===== */

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


/* ===== tokens/zindex.tokens.js ===== */

(function (global) {
  'use strict';

  const CDSZIndexTokens = Object.freeze({
    base: 1,
    dropdown: 100,
    sticky: 200,
    overlay: 900,
    modal: 1000,
    toast: 1100,
    loader: 1200
  });
  global.CDSZIndexTokens = CDSZIndexTokens;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSZIndexTokens;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/colors.js ===== */

(function (global) {
  'use strict';

  const CDSColors = Object.freeze({
    ...(global.CDSColorTokens || {}),
    status: Object.freeze({
      OK: 'success',
      ATENCAO: 'warning',
      CRITICO: 'danger',
      PROCESSANDO: 'processing',
      OFFLINE: 'offline',
      ONLINE: 'online',
      SINCRONIZANDO: 'processing'
    }),
    badgeTone: Object.freeze({
      success: 'ok', warning: 'warn', danger: 'error', info: 'info',
      neutral: 'neutral', processing: 'prep', offline: 'neutral',
      online: 'ok', readonly: 'neutral'
    })
  });
  global.CDSColors = CDSColors;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSColors;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/typography.js ===== */

(function (global) {
  'use strict';

  const CDSTypography = Object.freeze({ ...(global.CDSTypographyTokens || {}) });
  global.CDSTypography = CDSTypography;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTypography;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/spacing.js ===== */

(function (global) {
  'use strict';

  const CDSSpacing = Object.freeze({ ...(global.CDSSpacingTokens || {}) });
  global.CDSSpacing = CDSSpacing;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSpacing;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/radius.js ===== */

(function (global) {
  'use strict';

  const CDSRadius = Object.freeze({ ...(global.CDSRadiusTokens || {}) });
  global.CDSRadius = CDSRadius;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSRadius;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/shadows.js ===== */

(function (global) {
  'use strict';

  const CDSShadows = Object.freeze({ ...(global.CDSShadowTokens || {}) });
  global.CDSShadows = CDSShadows;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSShadows;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/elevation.js ===== */

(function (global) {
  'use strict';

  const CDSElevation = Object.freeze({
    flat: 0, raised: 1, overlay: 2, modal: 3,
    shadowFor(level) {
      const s = global.CDSShadowTokens || {};
      if (level >= 3) return s.lg;
      if (level === 2) return s.md;
      if (level === 1) return s.sm;
      return s.none;
    }
  });
  global.CDSElevation = CDSElevation;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSElevation;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/animations.js ===== */

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


/* ===== foundation/motion.js ===== */

(function (global) {
  'use strict';

  const CDSMotion = Object.freeze({
    ...(global.CDSMotionTokens || {}),
    classFor(kind) {
      const map = global.CDSAnimations || {};
      return map[kind] || map.fade || '';
    }
  });
  global.CDSMotion = CDSMotion;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSMotion;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/breakpoints.js ===== */

(function (global) {
  'use strict';

  const CDSBreakpoints = Object.freeze({
    mobile: 0,
    tablet: 768,
    notebook: 1024,
    desktop: 1280,
    wide: 1440,
    current() {
      const w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      if (w < 768) return 'mobile';
      if (w < 1024) return 'tablet';
      if (w < 1280) return 'notebook';
      if (w < 1440) return 'desktop';
      return 'wide';
    },
    matches(name) {
      return this.current() === name;
    }
  });
  global.CDSBreakpoints = CDSBreakpoints;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSBreakpoints;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/zindex.js ===== */

(function (global) {
  'use strict';

  const CDSZIndex = Object.freeze({ ...(global.CDSZIndexTokens || {}) });
  global.CDSZIndex = CDSZIndex;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSZIndex;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/icons.js ===== */

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


/* ===== foundation/transitions.js ===== */

(function (global) {
  'use strict';

  const CDSTransitions = Object.freeze({
    fast: 'all 120ms ease',
    base: 'all 180ms ease',
    slow: 'all 280ms ease',
    color: 'color 120ms ease, background 120ms ease, border-color 120ms ease'
  });
  global.CDSTransitions = CDSTransitions;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTransitions;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/opacity.js ===== */

(function (global) {
  'use strict';

  const CDSOpacity = Object.freeze({
    disabled: 0.55,
    muted: 0.72,
    overlay: 0.45,
    hint: 0.88,
    full: 1
  });
  global.CDSOpacity = CDSOpacity;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSOpacity;
})(typeof window !== 'undefined' ? window : global);


/* ===== foundation/layout.js ===== */

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


/* ===== foundation/grid.js ===== */

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


/* ===== foundation/theme.js ===== */

(function (global) {
  'use strict';

  function tokens() {
    return {
      color: global.CDSColorTokens,
      spacing: global.CDSSpacingTokens,
      radius: global.CDSRadiusTokens,
      typography: global.CDSTypographyTokens,
      shadow: global.CDSShadowTokens,
      motion: global.CDSMotionTokens,
      zindex: global.CDSZIndexTokens
    };
  }

  function cssVariables(prefix) {
    const p = prefix || '--cds-ui';
    const c = global.CDSColorTokens || {};
    const s = global.CDSSpacingTokens || {};
    const r = global.CDSRadiusTokens || {};
    const sh = global.CDSShadowTokens || {};
    return {
      [p + '-ink']: c.ink,
      [p + '-muted']: c.muted,
      [p + '-border']: c.border,
      [p + '-surface']: c.surface,
      [p + '-bg']: c.bg,
      [p + '-brand']: c.brand,
      [p + '-radius']: r.lg,
      [p + '-radius-card']: r.card,
      [p + '-shadow']: sh.md,
      [p + '-shadow-card']: sh.card,
      [p + '-gap']: s.gridGap,
      [p + '-card-padding']: s.cardPadding
    };
  }

  function applyToDocument(root) {
    const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
    if (!el || !el.style) return false;
    const vars = cssVariables();
    Object.keys(vars).forEach((k) => {
      if (vars[k] != null) el.style.setProperty(k, vars[k]);
    });
    return true;
  }

  const CDSTheme = { tokens, cssVariables, applyToDocument, name: 'cds-ui', version: '2.0.0-ds001' };
  global.CDSTheme = CDSTheme;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTheme;
})(typeof window !== 'undefined' ? window : global);


/* ===== utils/IconResolver.js ===== */

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


/* ===== utils/ColorResolver.js ===== */

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


/* ===== utils/MotionResolver.js ===== */

(function (global) {
  'use strict';

  const MotionResolver = {
    classFor(kind) { return global.CDSMotion?.classFor?.(kind) || 'cds-ui-anim--fade'; },
    duration(name) {
      const t = global.CDSMotionTokens || {};
      if (name === 'fast') return t.durationFast;
      if (name === 'slow') return t.durationSlow;
      return t.durationBase;
    }
  };
  global.MotionResolver = MotionResolver;

  if (typeof module !== 'undefined' && module.exports) module.exports = MotionResolver;
})(typeof window !== 'undefined' ? window : global);


/* ===== utils/ThemeResolver.js ===== */

(function (global) {
  'use strict';

  const ThemeResolver = {
    apply() { return global.CDSTheme?.applyToDocument?.() === true; },
    variables() { return global.CDSTheme?.cssVariables?.() || {}; },
    tokens() { return global.CDSTheme?.tokens?.() || {}; }
  };
  global.ThemeResolver = ThemeResolver;

  if (typeof module !== 'undefined' && module.exports) module.exports = ThemeResolver;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/_helpers.js ===== */

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


/* ===== components/CDSBadge.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const text = String(o.text || o.label || '');
      if (!text) return '';
      const toneMap = global.CDSColors?.badgeTone || {};
      let tone = o.tone || 'neutral';
      if (toneMap[tone]) tone = toneMap[tone];
      return '<span class="cds-ui cds-ui-badge cds-cfg-badge cds-cfg-badge--' + esc(tone) + '">' + esc(text) + '</span>';
    }
    const CDSBadge = { name: 'CDSBadge', render };
    global.CDSBadge = CDSBadge;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSBadge = CDSBadge;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSBadge;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSButton.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const variant = o.variant || 'primary';
      const size = o.size || 'sm';
      const disabled = o.disabled || o.loading ? ' disabled' : '';
      const loading = o.loading ? ' cds-ui-btn--loading' : '';
      const icon = o.icon ? ((global.CDSUIHelpers || {}).iconHtml?.(o.icon) || '') + ' ' : '';
      const cls = 'cds-ui cds-ui-btn cds-ui-btn--' + esc(variant) + ' btn btn-' + esc(size) +
        (variant === 'primary' ? ' btn-primary' : '') +
        (variant === 'secondary' ? ' btn-secondary' : '') +
        (variant === 'outline' ? ' btn-outline-primary' : '') +
        (variant === 'ghost' ? ' btn-link' : '') +
        (variant === 'danger' ? ' btn-danger' : '') +
        (variant === 'warning' ? ' btn-warning' : '') +
        (variant === 'success' ? ' btn-success' : '') +
        (variant === 'info' ? ' btn-info' : '') +
        loading + (o.className ? ' ' + esc(o.className) : '');
      return '<button type="' + esc(o.type || 'button') + '" class="' + cls + '"' + disabled +
        (o.id ? ' id="' + esc(o.id) + '"' : '') +
        (o.attrs || '') + '>' +
        (o.loading ? ((global.CDSUIHelpers || {}).iconHtml?.('loading') || '') + ' ' : icon) +
        esc(o.label || '') + '</button>';
    }
    const CDSButton = { name: 'CDSButton', render };
    global.CDSButton = CDSButton;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSButton = CDSButton;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSButton;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSButtonGroup.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      return '<div class="cds-ui cds-ui-btn-group">' + (o.html || '') + '</div>';
    }
    const CDSButtonGroup = { name: 'CDSButtonGroup', render };
    global.CDSButtonGroup = CDSButtonGroup;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSButtonGroup = CDSButtonGroup;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSButtonGroup;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSCard.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const accent = o.accent ? ' cds-ui-card--accent-' + esc(o.accent) : '';
      const hl = o.highlight ? ' is-highlight' : '';
      return '<div class="cds-ui cds-ui-card cds-cfg-card' + accent + hl + (o.className ? ' ' + esc(o.className) : '') + '"' +
        (o.id ? ' id="' + esc(o.id) + '"' : '') +
        (o.attrs || '') + '>' +
        (o.title ? '<div class="cds-ui-card__title cds-cfg-card__title">' + (o.titleHtml || esc(o.title)) + '</div>' : '') +
        '<div class="cds-ui-card__body">' + (o.bodyHtml || '') + '</div>' +
        (o.footerHtml ? '<div class="cds-ui-card__footer">' + o.footerHtml + '</div>' : '') +
        '</div>';
    }
    const CDSCard = { name: 'CDSCard', render };
    global.CDSCard = CDSCard;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSCard = CDSCard;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSCard;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSHero.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const H = global.CDSUIHelpers || {};
      const esc = H.esc || ((v) => String(v ?? ''));
      const icon = o.icon ? (H.iconHtml?.(o.icon) || '') : '';
      const title = esc(o.labelDomain ? (H.labelOr?.(o.title, o.labelDomain) || o.title) : (o.title || ''));
      const sub = esc(o.subtitle || '');
      const actions = o.actionsHtml || '';
      const meta = o.metaHtml || '';
      return '<div class="cds-ui cds-ui-hero cds-cfg-hero' + (o.className ? ' ' + esc(o.className) : '') + '">' +
        '<h1 class="cds-ui-hero__title cds-cfg-hero__title">' + icon + ' ' + title + '</h1>' +
        (sub ? '<p class="cds-ui-hero__sub cds-cfg-hero__sub">' + sub + '</p>' : '') +
        (meta ? '<div class="cds-ui-hero__meta cds-cfg-hero__meta">' + meta + '</div>' : '') +
        (actions ? '<div class="cds-ui-hero__actions cds-cfg-hero__actions">' + actions + '</div>' : '') +
        '</div>';
    }
    const CDSHero = { name: 'CDSHero', render };
    global.CDSHero = CDSHero;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSHero = CDSHero;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSHero;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSKPI.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const label = o.labelDomain
        ? ((global.CDSUIHelpers || {}).labelOr?.(o.label, o.labelDomain) || o.label)
        : (o.label || '');
      const tone = o.tone || 'ok';
      return '<div class="cds-ui cds-ui-kpi cds-cfg-kpi">' +
        '<div class="cds-ui-kpi__head cds-cfg-kpi__head">' +
        '<p class="cds-ui-kpi__label cds-cfg-kpi__label">' + esc(label) + '</p>' +
        '<span class="cds-ui-dot cds-cfg-dot" data-tone="' + esc(tone) + '"></span>' +
        '</div>' +
        '<p class="cds-ui-kpi__value cds-cfg-kpi__value">' + (o.valueHtml != null ? o.valueHtml : esc(o.value || '—')) + '</p>' +
        (o.detail ? '<p class="cds-ui-kpi__detail cds-cfg-kpi__detail">' + esc(o.detail) + '</p>' : '') +
        '</div>';
    }
    const CDSKPI = { name: 'CDSKPI', render };
    global.CDSKPI = CDSKPI;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSKPI = CDSKPI;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSKPI;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSWidget.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const icon = o.icon ? ((global.CDSUIHelpers || {}).iconHtml?.(o.icon) || '') : '';
      const badge = o.badgeHtml || '';
      return '<div class="cds-ui cds-ui-widget"' + (o.wrapAttr || '') + '>' +
        global.CDSCard.render({
          className: 'cds-ui-widget__card',
          attrs: o.id ? ' data-widget-id="' + esc(o.id) + '"' : '',
          titleHtml: icon + ' <span>' + esc(o.title || '') + '</span> ' + badge + (o.trailingHtml || ''),
          bodyHtml: o.bodyHtml || '',
          footerHtml: o.footerHtml || (o.hint ? '<p class="cds-ui-hint cds-cfg-hint">' + esc(o.hint) + '</p>' : '')
        }) + '</div>';
    }
    const CDSWidget = { name: 'CDSWidget', render };
    global.CDSWidget = CDSWidget;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSWidget = CDSWidget;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSWidget;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSPanel.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-panel' + (o.active ? ' is-active' : '') + '" data-cds-pane="' + esc(o.id || '') + '">' +
        (o.bodyHtml || '') + '</div>';
    }
    const CDSPanel = { name: 'CDSPanel', render };
    global.CDSPanel = CDSPanel;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSPanel = CDSPanel;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSPanel;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSInput.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-field">' +
        (o.label ? '<label class="cds-ui-field__label">' + esc(o.label) + '</label>' : '') +
        '<input class="cds-ui-input form-control" type="' + esc(o.type || 'text') + '"' +
        (o.id ? ' id="' + esc(o.id) + '"' : '') +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.value != null ? ' value="' + esc(o.value) + '"' : '') +
        (o.disabled ? ' disabled' : '') + '/>' +
        '</div>';
    }
    const CDSInput = { name: 'CDSInput', render };
    global.CDSInput = CDSInput;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSInput = CDSInput;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSInput;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSSelect.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const options = (o.options || []).map((opt) =>
        '<option value="' + esc(opt.value) + '"' + (opt.selected ? ' selected' : '') + '>' + esc(opt.label) + '</option>'
      ).join('');
      return '<div class="cds-ui cds-ui-field">' +
        (o.label ? '<label class="cds-ui-field__label">' + esc(o.label) + '</label>' : '') +
        '<select class="cds-ui-select form-select"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + '>' + options + '</select></div>';
    }
    const CDSSelect = { name: 'CDSSelect', render };
    global.CDSSelect = CDSSelect;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSSelect = CDSSelect;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSelect;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSTabs.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const items = (o.items || []).map((t) =>
        '<button type="button" class="cds-ui-tab cds-cfg-nav__item' + (t.active ? ' is-active' : '') + '" data-cds-tab="' + esc(t.id) + '">' +
        (t.icon ? ((global.CDSUIHelpers || {}).iconHtml?.(t.icon) || '') : '') +
        '<span>' + esc(t.label) + '</span></button>'
      ).join('');
      return '<nav class="cds-ui cds-ui-tabs cds-cfg-nav" aria-label="' + esc(o.ariaLabel || 'Abas') + '">' + items + '</nav>';
    }
    const CDSTabs = { name: 'CDSTabs', render };
    global.CDSTabs = CDSTabs;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSTabs = CDSTabs;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTabs;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSAccordion.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const items = (o.items || []).map((it, i) =>
        '<details class="cds-ui-accordion__item"' + (it.open ? ' open' : '') + '>' +
        '<summary>' + esc(it.title || ('Item ' + (i + 1))) + '</summary>' +
        '<div class="cds-ui-accordion__body">' + (it.bodyHtml || esc(it.body || '')) + '</div></details>'
      ).join('');
      return '<div class="cds-ui cds-ui-accordion">' + items + '</div>';
    }
    const CDSAccordion = { name: 'CDSAccordion', render };
    global.CDSAccordion = CDSAccordion;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSAccordion = CDSAccordion;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSAccordion;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSGrid.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const variant = o.variant === 'kpi' ? ' cds-ui-grid--kpi' : (o.variant === 'widgets' ? ' cds-ui-grid--widgets' : '');
      return '<div class="cds-ui cds-ui-grid' + variant + '">' + (o.html || '') + '</div>';
    }
    const CDSGrid = { name: 'CDSGrid', render };
    global.CDSGrid = CDSGrid;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSGrid = CDSGrid;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSGrid;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSSection.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<section class="cds-ui cds-ui-section">' +
        (o.title ? '<header class="cds-ui-section-header"><h2>' + esc(o.title) + '</h2>' +
        (o.subtitle ? '<p>' + esc(o.subtitle) + '</p>' : '') + '</header>' : '') +
        '<div class="cds-ui-section__body">' + (o.bodyHtml || '') + '</div></section>';
    }
    const CDSSection = { name: 'CDSSection', render };
    global.CDSSection = CDSSection;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSSection = CDSSection;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSection;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSDivider.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      return '<hr class="cds-ui cds-ui-divider" />';
    }
    const CDSDivider = { name: 'CDSDivider', render };
    global.CDSDivider = CDSDivider;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSDivider = CDSDivider;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSDivider;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSTimeline.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const items = (o.items || []).map((e) =>
        '<li class="cds-ui-timeline__item">' +
        '<span class="cds-ui-timeline__time">' + esc(e.time || '—') + '</span>' +
        '<span class="cds-ui-timeline__content"><strong>' + esc(e.title || '') + '</strong> ' +
        '<span class="text-muted">' + esc(e.meta || '') + '</span></span></li>'
      ).join('');
      return global.CDSCard.render({
        titleHtml: ((global.CDSUIHelpers || {}).iconHtml?.('stream') || '') + ' ' + esc(o.title || 'Timeline'),
        bodyHtml: items
          ? '<ul class="cds-ui-timeline cds-cfg-note">' + items + '</ul>'
          : '<p class="cds-ui-hint cds-cfg-hint">' + esc(o.empty || 'Sem eventos.') + '</p>'
      });
    }
    const CDSTimeline = { name: 'CDSTimeline', render };
    global.CDSTimeline = CDSTimeline;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSTimeline = CDSTimeline;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSTimeline;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSAlert.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const sev = o.severityidade || o.tone || 'INFO';
      const badgeTone = sev === 'CRITICO' || sev === 'danger' ? 'error' : (sev === 'ATENCAO' || sev === 'warning' ? 'warn' : 'info');
      return global.CDSCard.render({
        titleHtml: global.CDSBadge.render({ text: sev, tone: badgeTone }) + ' ' + esc(o.title || ''),
        bodyHtml: '<p class="cds-ui-hint cds-cfg-hint">' + esc(o.description || '') + '</p>' +
          (o.meta ? '<p class="cds-cfg-note">' + esc(o.meta) + '</p>' : '') + (o.actionsHtml || '')
      });
    }
    const CDSAlert = { name: 'CDSAlert', render };
    global.CDSAlert = CDSAlert;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSAlert = CDSAlert;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSAlert;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSRecommendation.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-recommendation cds-cfg-note">' +
        '<strong>' + esc(o.title || '') + '</strong> — ' + esc(o.description || '') +
        (o.actionsHtml || '') + '</div>';
    }
    const CDSRecommendation = { name: 'CDSRecommendation', render };
    global.CDSRecommendation = CDSRecommendation;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSRecommendation = CDSRecommendation;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSRecommendation;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSHealth.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const status = String(o.status || 'OK').toUpperCase();
      const toneMap = { OK: 'ok', ATENCAO: 'warn', CRITICO: 'error', ONLINE: 'ok', OFFLINE: 'neutral', PROCESSANDO: 'prep', SINCRONIZANDO: 'prep' };
      return '<div class="cds-ui cds-ui-health">' +
        global.CDSBadge.render({ text: status, tone: toneMap[status] || 'neutral' }) +
        (o.label ? ' <span class="cds-ui-health__label">' + esc(o.label) + '</span>' : '') +
        '</div>';
    }
    const CDSHealth = { name: 'CDSHealth', render };
    global.CDSHealth = CDSHealth;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSHealth = CDSHealth;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSHealth;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSNotification.js ===== */

(function (global) {
  'use strict';

    function show(message, type, duration) {
      const msg = String(message || '');
      const t = type || 'info';
      if (typeof global.showNotification === 'function') {
        global.showNotification(msg, t === 'danger' ? 'error' : t, duration);
        return true;
      }
      const host = typeof document !== 'undefined' ? document.getElementById('cds-ui-toast-host') : null;
      if (host) {
        const el = document.createElement('div');
        el.className = 'cds-ui-toast cds-ui-toast--' + t;
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => el.remove(), duration || 3500);
        return true;
      }
      if (typeof console !== 'undefined') console.info('[CDSNotification]', t, msg);
      return false;
    }
    function renderHost() {
      return '<div id="cds-ui-toast-host" class="cds-ui cds-ui-toast-host" aria-live="polite"></div>';
    }
    const CDSNotification = { name: 'CDSNotification', show, renderHost };
    global.CDSNotification = CDSNotification;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSNotification = CDSNotification;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSNotification;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSLoader.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const variant = o.variant || 'spinner';
      if (variant === 'skeleton') {
        return '<div class="cds-ui cds-ui-skeleton" aria-hidden="true"><div class="cds-ui-skeleton__line"></div><div class="cds-ui-skeleton__line"></div><div class="cds-ui-skeleton__line short"></div></div>';
      }
      if (variant === 'overlay') {
        return '<div class="cds-ui cds-ui-loader-overlay"><div class="cds-ui-spinner"></div><p>' + esc(o.label || 'Carregando…') + '</p></div>';
      }
      if (variant === 'progress') {
        const pct = Math.max(0, Math.min(100, Number(o.value) || 0));
        return '<div class="cds-ui cds-ui-progress" role="progressbar" aria-valuenow="' + pct + '"><div class="cds-ui-progress__bar" style="width:' + pct + '%"></div></div>';
      }
      return '<div class="cds-ui cds-ui-loader"><div class="cds-ui-spinner"></div>' +
        (o.label ? '<span>' + esc(o.label) + '</span>' : '') + '</div>';
    }
    const CDSLoader = { name: 'CDSLoader', render };
    global.CDSLoader = CDSLoader;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSLoader = CDSLoader;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSLoader;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSEmptyState.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const kind = o.kind || 'empty';
      const icons = { empty: 'empty', search: 'fa-search', error: 'error', permission: 'fa-lock', offline: 'offline' };
      const icon = (global.CDSUIHelpers || {}).iconHtml?.(icons[kind] || 'empty') || '';
      return '<div class="cds-ui cds-ui-empty">' +
        '<div class="cds-ui-empty__icon">' + icon + '</div>' +
        '<h3 class="cds-ui-empty__title">' + esc(o.title || 'Sem dados') + '</h3>' +
        (o.description ? '<p class="cds-ui-empty__desc">' + esc(o.description) + '</p>' : '') +
        (o.actionsHtml || '') + '</div>';
    }
    const CDSEmptyState = { name: 'CDSEmptyState', render };
    global.CDSEmptyState = CDSEmptyState;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSEmptyState = CDSEmptyState;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSEmptyState;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSStatusChip.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      return global.CDSBadge.render({ text: o.status || o.text, tone: o.tone || 'neutral' });
    }
    const CDSStatusChip = { name: 'CDSStatusChip', render };
    global.CDSStatusChip = CDSStatusChip;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSStatusChip = CDSStatusChip;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSStatusChip;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSProgress.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      return global.CDSLoader.render(Object.assign({ variant: 'progress' }, opts || {}));
    }
    const CDSProgress = { name: 'CDSProgress', render };
    global.CDSProgress = CDSProgress;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSProgress = CDSProgress;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSProgress;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSMetric.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-metric"><div class="text-muted" style="font-size:0.75rem;">' + esc(o.label || '') +
        '</div><div style="font-size:1.1rem;font-weight:700;">' + esc(o.value != null ? o.value : '—') + '</div></div>';
    }
    const CDSMetric = { name: 'CDSMetric', render };
    global.CDSMetric = CDSMetric;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSMetric = CDSMetric;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSMetric;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSQuickAction.js ===== */

(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      return global.CDSButton.render(Object.assign({ variant: 'outline', size: 'sm' }, o));
    }
    const CDSQuickAction = { name: 'CDSQuickAction', render };
    global.CDSQuickAction = CDSQuickAction;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSQuickAction = CDSQuickAction;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSQuickAction;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSPageHeader.js ===== */

(function (global) {
  'use strict';

  function render(opts) {
    return global.CDSHero.render(opts || {});
  }
  const CDSPageHeader = { name: 'CDSPageHeader', render };
  global.CDSPageHeader = CDSPageHeader;
  (global.CDSUIComponents = global.CDSUIComponents || {}).CDSPageHeader = CDSPageHeader;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSPageHeader;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSBreadcrumb.js ===== */

(function (global) {
  'use strict';

  function render(opts) {
    const o = opts || {};
    const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
    const items = (o.items || []).map((it, i, arr) =>
      (i < arr.length - 1
        ? '<a href="' + esc(it.href || '#') + '">' + esc(it.label) + '</a>'
        : '<span>' + esc(it.label) + '</span>')
    ).join(' <span class="cds-ui-breadcrumb__sep">/</span> ');
    return '<nav class="cds-ui cds-ui-breadcrumb" aria-label="Breadcrumb">' + items + '</nav>';
  }
  const CDSBreadcrumb = { name: 'CDSBreadcrumb', render };
  global.CDSBreadcrumb = CDSBreadcrumb;
  (global.CDSUIComponents = global.CDSUIComponents || {}).CDSBreadcrumb = CDSBreadcrumb;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSBreadcrumb;
})(typeof window !== 'undefined' ? window : global);


/* ===== components/CDSToolbar.js ===== */

(function (global) {
  'use strict';

  function render(opts) {
    return '<div class="cds-ui cds-ui-toolbar">' + ((opts || {}).html || '') + '</div>';
  }
  const CDSToolbar = { name: 'CDSToolbar', render };
  global.CDSToolbar = CDSToolbar;
  (global.CDSUIComponents = global.CDSUIComponents || {}).CDSToolbar = CDSToolbar;

  if (typeof module !== 'undefined' && module.exports) module.exports = CDSToolbar;
})(typeof window !== 'undefined' ? window : global);


/* ===== hooks/useAdaptiveLabel.js ===== */

(function (global) {
  'use strict';

  function useAdaptiveLabel() {
    const svc = global.AdaptiveLabelService || global.CDS?.DesignSystem?.AdaptiveLabels?.service;
    return {
      getLabel: (d, o) => svc?.getLabel?.(d, o) || String(d || ''),
      getPlural: (d, o) => svc?.getPlural?.(d, o) || svc?.getLabel?.(d, o) || String(d || ''),
      getShortLabel: (d, o) => svc?.getShortLabel?.(d, o) || svc?.getLabel?.(d, o) || String(d || ''),
      getDescription: (d, o) => svc?.getDescription?.(d, o) || '',
      sanitize: (t) => svc?.sanitize?.(t) || String(t ?? ''),
      shouldShowNaoFiscal: () => svc?.shouldShowNaoFiscal?.() !== false,
      service: svc || null
    };
  }
  global.useAdaptiveLabel = useAdaptiveLabel;

  if (typeof module !== 'undefined' && module.exports) module.exports = useAdaptiveLabel;
})(typeof window !== 'undefined' ? window : global);


/* ===== hooks/useBreakpoint.js ===== */

(function (global) {
  'use strict';

  function useBreakpoint() {
    const bp = global.CDSBreakpoints;
    return {
      current: () => bp?.current?.() || 'desktop',
      matches: (n) => bp?.matches?.(n) === true,
      isMobile: () => bp?.current?.() === 'mobile',
      isTablet: () => bp?.current?.() === 'tablet',
      breakpoints: bp || null
    };
  }
  global.useBreakpoint = useBreakpoint;

  if (typeof module !== 'undefined' && module.exports) module.exports = useBreakpoint;
})(typeof window !== 'undefined' ? window : global);


/* ===== hooks/useTheme.js ===== */

(function (global) {
  'use strict';

  function useTheme() {
    return {
      theme: global.CDSTheme || null,
      apply: () => global.CDSTheme?.applyToDocument?.() === true,
      tokens: () => global.CDSTheme?.tokens?.() || {}
    };
  }
  global.useTheme = useTheme;

  if (typeof module !== 'undefined' && module.exports) module.exports = useTheme;
})(typeof window !== 'undefined' ? window : global);


/* ===== hooks/useNotification.js ===== */

(function (global) {
  'use strict';

  function useNotification() {
    return {
      notify: (msg, type, duration) => global.CDSNotification?.show?.(msg, type, duration),
      success: (msg) => global.CDSNotification?.show?.(msg, 'success'),
      error: (msg) => global.CDSNotification?.show?.(msg, 'error'),
      warning: (msg) => global.CDSNotification?.show?.(msg, 'warning'),
      info: (msg) => global.CDSNotification?.show?.(msg, 'info')
    };
  }
  global.useNotification = useNotification;

  if (typeof module !== 'undefined' && module.exports) module.exports = useNotification;
})(typeof window !== 'undefined' ? window : global);


/* ===== hooks/useHealth.js ===== */

(function (global) {
  'use strict';

  function useHealth() {
    return {
      render: (status, label) => global.CDSHealth?.render?.({ status, label }) || '',
      toneFor(status) {
        const s = String(status || '').toUpperCase();
        const map = global.CDSColors?.status || {};
        return map[s] || 'neutral';
      }
    };
  }
  global.useHealth = useHealth;

  if (typeof module !== 'undefined' && module.exports) module.exports = useHealth;
})(typeof window !== 'undefined' ? window : global);


/* ===== index.js ===== */

/**
 * CDS Design System V2 — UI Foundation bootstrap (DS-001)
 * Carrega tokens → foundation → utils → components → hooks
 * e registra CDS.UI
 */
(function (global) {
  'use strict';

  const VERSION = '2.0.0-ds001';

  function ready() {
    return !!(global.CDSTheme && global.CDSUIComponents && global.CDSHero);
  }

  function init(opcoes) {
    const opts = opcoes || {};
    if (global.CDSTheme?.applyToDocument) {
      global.CDSTheme.applyToDocument();
    }
    if (global.AdaptiveLabelProvider?.init) {
      global.AdaptiveLabelProvider.init(opts.labels || {});
    }

    global.CDS = global.CDS || {};
    global.CDS.UI = {
      version: VERSION,
      foundation: {
        colors: global.CDSColors,
        typography: global.CDSTypography,
        spacing: global.CDSSpacing,
        radius: global.CDSRadius,
        shadows: global.CDSShadows,
        elevation: global.CDSElevation,
        animations: global.CDSAnimations,
        motion: global.CDSMotion,
        breakpoints: global.CDSBreakpoints,
        zindex: global.CDSZIndex,
        icons: global.CDSIcons,
        transitions: global.CDSTransitions,
        opacity: global.CDSOpacity,
        layout: global.CDSLayout,
        grid: global.CDSGridFoundation,
        theme: global.CDSTheme
      },
      tokens: {
        color: global.CDSColorTokens,
        spacing: global.CDSSpacingTokens,
        radius: global.CDSRadiusTokens,
        typography: global.CDSTypographyTokens,
        shadow: global.CDSShadowTokens,
        motion: global.CDSMotionTokens,
        zindex: global.CDSZIndexTokens
      },
      components: global.CDSUIComponents || {},
      utils: {
        IconResolver: global.IconResolver,
        ColorResolver: global.ColorResolver,
        MotionResolver: global.MotionResolver,
        ThemeResolver: global.ThemeResolver
      },
      hooks: {
        useAdaptiveLabel: global.useAdaptiveLabel,
        useBreakpoint: global.useBreakpoint,
        useTheme: global.useTheme,
        useNotification: global.useNotification,
        useHealth: global.useHealth
      },
      labels: global.AdaptiveLabelService || null,
      notify: (msg, type, duration) => global.CDSNotification?.show?.(msg, type, duration)
    };

    global.CDS.DesignSystem = global.CDS.DesignSystem || {};
    global.CDS.DesignSystem.UI = global.CDS.UI;
    if (global.CDS.DesignSystem.AdaptiveLabels) {
      global.CDS.UI.AdaptiveLabels = global.CDS.DesignSystem.AdaptiveLabels;
    }

    return true;
  }

  const CDSUIFoundation = { VERSION, ready, init };
  global.CDSUIFoundation = CDSUIFoundation;

  if (ready()) init();
  else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      if (ready()) init();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CDSUIFoundation;
  }
})(typeof window !== 'undefined' ? window : global);
