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
