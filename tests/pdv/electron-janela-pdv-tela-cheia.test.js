/**
 * PDV aberto a partir do ERP Electron deve ser tela cheia, não comprovante 420x720.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Electron — PDV em tela cheia', () => {
  it('electron.js (npm start) não força toda janela filha em 420x720', () => {
    const src = read('electron.js');
    assert.doesNotMatch(src, /setWindowOpenHandler\(\(\) => \{/);
    assert.match(src, /configurarAberturaJanelas\(mainWindow\)/);
    assert.match(src, /registrarIpcAbrirModulo/);
    assert.doesNotMatch(src, /childWindow\.setAlwaysOnTop\(true\)/);
  });

  it('comprovante só com data: ou largura de cupom; about:blank do PDV não é cupom', () => {
    const src = read('electron-janelas-modulo.js');
    assert.match(src, /nome === 'cds-pdv'/);
    assert.match(src, /action: 'deny'/);
    assert.match(src, /abrir-modulo-app/);
    assert.match(src, /win\.maximize\(\)/);
    assert.doesNotMatch(src, /if \(!destino \|\| destino === 'about:blank'\) return true;/);
  });

  it('preload e core usam IPC abrirModuloApp', () => {
    assert.match(read('preload.js'), /abrir-modulo-app/);
    assert.match(read('frontend/shared/js/core.js'), /electronAPI\.abrirModuloApp/);
  });

  it('cupom DANFE abre na janela do PDV e não usa Microsoft Print to PDF', () => {
    const janelas = read('electron-janelas-modulo.js');
    assert.match(janelas, /function registrarIpcAbrirComprovante/);
    assert.match(janelas, /function nomeImpressoraTermicaValido/);
    assert.match(janelas, /BrowserWindow\.fromWebContents\(event\.sender\)/);
    assert.match(janelas, /microsoft print to pdf/i);
    assert.match(janelas, /skipTaskbar: true/);
    assert.match(janelas, /devolverFocoJanela\(origem\)/);
    assert.doesNotMatch(janelas, /parent: mainWindow/);

    const electronJs = read('electron.js');
    assert.match(electronJs, /registrarIpcAbrirComprovante\(ipcMain\)/);
    assert.doesNotMatch(electronJs, /ipcMain\.on\('abrir-comprovante'/);
    assert.match(janelas, /lower === 'cupom'/);
  });

  it('forcar-reflow não esconde o body da janela principal (ERP) quando o PDV clica', () => {
    const janelas = read('electron-janelas-modulo.js');
    assert.match(janelas, /function registrarIpcForcarReflow/);
    assert.match(janelas, /BrowserWindow\.fromWebContents\(event\.sender\)/);
    assert.match(janelas, /webContents\.invalidate/);
    assert.doesNotMatch(janelas, /document\.body\.style\.display = 'none'/);

    const electronJs = read('electron.js');
    assert.match(electronJs, /registrarIpcForcarReflow\(ipcMain\)/);
    assert.doesNotMatch(electronJs, /forcar-reflow/);

    const common = read('electron-common.js');
    assert.match(common, /registrarIpcForcarReflow\(ipcMain\)/);
    assert.doesNotMatch(common, /document\.body\.style\.display = 'none'/);

    const core = read('frontend/shared/js/core.js');
    assert.doesNotMatch(core, /electronAPI\.forcarReflow/);
    assert.doesNotMatch(core, /document\.body\.style\.display = 'none'/);

    const produtos = read('frontend/erp/js/produtos.js');
    const render = produtos.slice(
      produtos.indexOf('function renderProdutos'),
      produtos.indexOf('function renderCategoriasProdutos')
    );
    assert.doesNotMatch(render, /resetarEstadoArvoreProdutos\(\)/);
  });
});
