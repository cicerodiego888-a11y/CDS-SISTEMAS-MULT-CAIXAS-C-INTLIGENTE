'use strict';

/**
 * Aplica icon.ico no .exe sem winCodeSign (evita erro de symlink no Windows).
 * Usado quando signAndEditExecutable=false no electron-builder.
 */

const fs = require('fs');
const path = require('path');

async function aplicarIconeExeWindows(appOutDir, productFilename, rootDir) {
  if (process.platform !== 'win32') return false;

  const exePath = path.join(appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(rootDir, 'assets', 'branding', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('[build][icone] exe não encontrado:', exePath);
    return false;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('[build][icone] icon.ico não encontrado:', iconPath);
    return false;
  }

  let rcedit;
  try {
    rcedit = require('rcedit');
  } catch (err) {
    console.warn('[build][icone] pacote rcedit ausente — execute: npm i -D rcedit');
    return false;
  }

  await rcedit(exePath, { icon: iconPath });
  console.log('[build][icone] aplicado em', exePath);
  return true;
}

module.exports = { aplicarIconeExeWindows };
