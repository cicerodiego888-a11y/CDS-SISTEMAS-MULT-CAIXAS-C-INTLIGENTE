/**
 * A geometria do DANFE térmico fica no renderer.
 * A janela e o webContents.print não redefinem papel, escala ou altura.
 * node --test tests/impressao/danfe-pagesize-termico.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\s*\/\/.*$/gm, '');
}

describe('DANFE térmico — janela não é o papel', () => {
  it('renderer declara 80mm auto e o Electron não envia pageSize nem zoom', () => {
    const renderer = ler('backend/services/fiscal/DanfeTermicoRenderer.js');
    assert.match(renderer, /size: \$\{papelMm\}mm auto/);
    assert.match(renderer, /width: \$\{papelMm\}mm/);
    assert.doesNotMatch(renderer, /48ch|76mm|overflow-x\s*:\s*hidden/);

    for (const arquivo of ['electron.js', 'electron-common.js', 'electron-janelas-modulo.js']) {
      const src = ler(arquivo);
      assert.doesNotMatch(src, /pageSize/);
      assert.doesNotMatch(src, /scaleFactor/);
      assert.doesNotMatch(src, /zoomFactor/);
      assert.doesNotMatch(src, /setZoomFactor/);
      assert.doesNotMatch(src, /electron-danfe-pagesize/);
    }
  });

  it('impressão silenciosa mantém silent, fundo e margem none', () => {
    for (const arquivo of ['electron.js', 'electron-common.js']) {
      const src = ler(arquivo);
      const handler = src.slice(src.indexOf("ipcMain.handle('imprimir-danfe-silencioso'"), src.indexOf("ipcMain.handle('imprimir-danfe-silencioso'") + 1600);
      assert.match(handler, /silent:\s*true/);
      assert.match(handler, /printBackground:\s*true/);
      assert.match(handler, /marginType:\s*'none'/);
      assert.match(handler, /nomeImpressoraTermicaValido\(deviceName\)/);
      assert.doesNotMatch(handler, /pageSize|scaleFactor|zoomFactor/);
    }
  });
});
