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
