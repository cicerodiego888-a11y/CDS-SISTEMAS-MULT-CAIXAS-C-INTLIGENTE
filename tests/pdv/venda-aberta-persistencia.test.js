/**
 * Venda iniciada no PDV não pode ser perdida ao sair/minimizar.
 * npm run test:pdv-venda-aberta-persistencia
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

describe('PDV — persistência de venda em andamento', () => {
  it('PDV persiste e restaura o carrinho ao recarregar', () => {
    const src = read('frontend/pdv/js/pdv.js');
    assert.match(src, /function persistirVendaAbertaPdv/);
    assert.match(src, /function restaurarVendaAbertaPdv/);
    assert.match(src, /cds_pdv_venda_aberta/);
    assert.match(src, /restaurarVendaAbertaPdv\(\)/);
    assert.match(src, /persistirVendaAbertaPdv\(\)/);
  });

  it('Abrir ERP/Assinatura não navega na mesma janela do PDV', () => {
    const html = read('frontend/pdv/index.html');
    assert.match(html, /data-modulo-externo="cds-erp"/);
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /function abrirModuloCdsEmOutraJanela/);
    assert.match(core, /window\.open\(/);
  });

  it('ERP abre o PDV em outra janela', () => {
    const erp = read('frontend/erp/index.html');
    assert.match(erp, /data-modulo-externo="cds-pdv"/);
    const dash = read('frontend/erp/js/dashboard-command.js');
    assert.match(dash, /abrirModuloCdsEmOutraJanela\('\/pdv'/);
    assert.doesNotMatch(dash, /window\.location\.href = '\/pdv'/);
  });

  it('Electron abre ERP/PDV em janela cheia, não no tamanho de comprovante', () => {
    const src = read('electron-common.js');
    assert.match(src, /configurarAberturaJanelas\(mainWindow\)/);
    assert.match(src, /electron-janelas-modulo/);
    const janelas = read('electron-janelas-modulo.js');
    assert.match(janelas, /aplicarJanelaModuloTelaCheia/);
    assert.match(janelas, /win\.maximize\(\)/);
    assert.match(janelas, /cds-pdv/);
  });
});
