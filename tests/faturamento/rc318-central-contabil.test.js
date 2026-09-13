/**
 * RC3.18 — Central Contábil (exportação fiscal → contabilidade).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  normalizarOpcoesExportacao
} = require('../../backend/services/fiscal/exportarContabilidadeService');

describe('RC3.18 — opções de exportação', () => {
  it('defaults todos ligados (retrocompatível)', () => {
    const o = normalizarOpcoesExportacao({});
    assert.equal(o.incluirNfce, true);
    assert.equal(o.incluirNfe, true);
    assert.equal(o.incluirEntradas, true);
    assert.equal(o.incluirRelatorios, true);
    assert.equal(o.incluirManifesto, true);
  });

  it('respeita desligar NF-e / NFC-e', () => {
    const o = normalizarOpcoesExportacao({ incluirNfe: false, incluirNfce: '0' });
    assert.equal(o.incluirNfe, false);
    assert.equal(o.incluirNfce, false);
    assert.equal(o.incluirEntradas, true);
  });
});

describe('RC3.18 — serviço e rota existentes', () => {
  it('estende o serviço (não cria novo exportador)', () => {
    const svc = read('backend/services/fiscal/exportarContabilidadeService.js');
    assert.match(svc, /XML_NFE/);
    assert.match(svc, /buscarNfeAutorizadas/);
    assert.match(svc, /central_entradas_documentos/);
    assert.match(svc, /nfe_notas/);
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/exportarContabilidadeService.js')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'backend/services/fiscal/centralContabilService.js')));
  });

  it('rota única POST /exportar-contabilidade', () => {
    const rota = read('backend/rotas/fiscal.js');
    assert.match(rota, /\/exportar-contabilidade/);
    assert.match(rota, /incluirNfe/);
    assert.match(rota, /exportarContabilidade/);
  });
});

describe('RC3.18 — UI Central Contábil', () => {
  it('menu + loader + script', () => {
    const index = read('frontend/erp/index.html');
    const app = read('frontend/erp/js/app.js');
    const ui = read('frontend/erp/js/central-contabil.js');
    const core = read('frontend/shared/js/core.js');
    assert.match(index, /data-page="central-contabil"/);
    assert.match(index, /Central Contábil/);
    assert.match(index, /central-contabil\.js/);
    assert.match(app, /central-contabil/);
    assert.match(app, /loadCentralContabil/);
    assert.match(ui, /\/fiscal\/exportar-contabilidade/);
    assert.match(ui, /Gerar Arquivo Contábil/);
    assert.match(ui, /incluirNfe/);
    assert.match(core, /central-contabil/);
  });

  it('não altera emissores / motores', () => {
    const nfce = read('backend/services/fiscal/emissor.js');
    assert.doesNotMatch(nfce, /central-contabil|exportarContabilidade/);
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/nfeEmissorVenda.js')));
  });
});
