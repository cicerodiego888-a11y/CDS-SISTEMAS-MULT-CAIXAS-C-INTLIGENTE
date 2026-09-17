/**
 * PDV — ligar/desligar impressão automática de cupom.
 * node --test tests/pdv/pdv-imprimir-cupom.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

describe('PDV imprimir cupom', () => {
  it('chave, rotas e Centro de Configurações existem', () => {
    const cfg = fs.readFileSync(
      path.join(ROOT, 'backend/services/estoque/pdvImprimirCupomConfig.js'),
      'utf8'
    );
    assert.match(cfg, /pdv_imprimir_cupom/);
    assert.match(cfg, /ATIVADO/);
    assert.match(cfg, /cacheValor = ATIVADO/);

    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /pdv_imprimir_cupom',\s*'ATIVADO'/);

    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /\/pdv_imprimir_cupom/);
    assert.match(rotas, /cfgImprimirCupomPdv/);

    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgPdvImprimirCupom/);
    assert.match(centro, /btnSalvarPdvImprimirCupom/);
  });

  it('PDV e impressão respeitam a flag; reimpressão manual permanece', () => {
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /pdvImprimirCupomAtivo/);
    assert.match(pdv, /carregarFlagImprimirCupomPdv/);
    assert.match(pdv, /alternarImpressaoCupomPdv/);
    assert.match(pdv, /btnImprimirCupomPdv/);
    assert.match(pdv, /automatico: true/);

    const html = fs.readFileSync(path.join(ROOT, 'frontend/pdv/pages/pdv.html'), 'utf8');
    assert.match(html, /btnImprimirCupomPdv/);

    const fiscal = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/fiscalImpressao.js'), 'utf8');
    assert.match(fiscal, /deveEnviarCupomParaImpressora/);
    assert.match(fiscal, /enviarImpressora/);
    assert.doesNotMatch(fiscal, /opcoesImpressaoCupomEhAutomatica\(opcoes\) && !impressaoAutomaticaCupomPermitida\(\)/);

    const conf = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/configuracoes.js'), 'utf8');
    assert.match(conf, /pdv_imprimir_cupom/);
    assert.match(conf, /chave !== 'pdv_imprimir_cupom'/);

    const electron = fs.readFileSync(path.join(ROOT, 'electron-janelas-modulo.js'), 'utf8');
    assert.match(electron, /enviarImpressora/);
  });
});
