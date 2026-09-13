'use strict';

const { nativeImage } = require('electron');

/**
 * Ícone da janela Electron (taskbar em dev + fallback em produção).
 * Usa nativeImage para carregar .ico corretamente no Windows.
 */
function resolverIconeJanela() {
  const iconPath = require('./assets/branding/BrandService').electronIconPath();
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  } catch (_) {
    /* fallback abaixo */
  }
  console.warn('[ELECTRON] Falha ao carregar ícone via nativeImage:', iconPath);
  return iconPath;
}

module.exports = { resolverIconeJanela };
