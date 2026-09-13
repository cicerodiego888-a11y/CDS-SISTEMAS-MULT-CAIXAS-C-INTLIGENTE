'use strict';

/**
 * RC4.31.7 — Limpeza completa de caches e artefatos de build Electron
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const TAG = '[RC4.31.7]';

const DIRS_LIMPAR = [
  path.join(root, 'dist'),
  path.join(root, 'out'),
  path.join(root, 'release'),
  path.join(root, 'build', 'cache')
];

function rmDir(dir) {
  if (!fs.existsSync(dir)) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return true;
  } catch (err) {
    console.warn(TAG, 'aviso ao limpar', dir, err.message);
    return false;
  }
}

function limparElectronCache() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const caches = [
    path.join(localAppData, 'electron', 'Cache'),
    path.join(localAppData, 'electron-builder', 'Cache')
  ];
  caches.forEach((dir) => {
    if (rmDir(dir)) console.log(TAG, 'cache limpo:', dir);
  });
}

function main() {
  console.log(TAG, '=== LIMPEZA DE BUILD ===');

  DIRS_LIMPAR.forEach((dir) => {
    if (rmDir(dir)) console.log(TAG, 'removido:', path.relative(root, dir));
    else console.log(TAG, 'skip:', path.relative(root, dir));
  });

  limparElectronCache();

  const npmCache = spawnSync('npm', ['cache', 'clean', '--force'], {
    cwd: root,
    shell: true,
    stdio: 'inherit'
  });
  if (npmCache.status !== 0) {
    console.warn(TAG, 'npm cache clean retornou', npmCache.status);
  }

  console.log(TAG, 'limpeza concluída');
}

main();
