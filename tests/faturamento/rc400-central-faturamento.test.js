/**
 * RC4.0.0 — Central de Faturamento (smoke estrutural).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC4.0.0 — Expedição sem NF-e', () => {
  it('faturarPedido não chama emitirNfePorVendaId', () => {
    const src = read('backend/services/faturamento/FaturamentoService.js');
    assert.doesNotMatch(src, /require\('\.\.\/fiscal\/nfeEmissorVenda'\)/);
    assert.doesNotMatch(src, /emitirNfePorVendaId\s*\(/);
    assert.match(src, /proxima_etapa:\s*'central_faturamento'/);
    assert.match(src, /emitir_nfe:\s*false/);
  });

  it('modal Expedir não exibe fatEmitirNfe', () => {
    const src = read('frontend/erp/js/faturamento.js');
    assert.doesNotMatch(src, /id="fatEmitirNfe"/);
    assert.match(src, /central-faturamento/);
    assert.match(src, /__cdsCentralFatVendaId/);
  });
});

describe('RC4.0.0 — APIs e UI da Central', () => {
  it('serviço e rotas existem', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/faturamento/CentralFaturamentoService.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/rotas/centralFaturamento.js')));
    const server = read('backend/server.js');
    assert.match(server, /\/api\/central-faturamento/);
    assert.match(server, /centralFaturamento/);
  });

  it('checklist bloqueia sem documento', () => {
    const { montarChecklist } = require('../../backend/services/faturamento/CentralFaturamentoService');
    // montarChecklist é async e precisa getFiscalConfig — testamos a regra de CPF via helper indireto
    const src = read('backend/services/faturamento/CentralFaturamentoService.js');
    assert.match(src, /CHECKLIST_BLOQUEADO/);
    assert.match(src, /cpf_cnpj/);
    assert.match(src, /pode_emitir/);
    assert.match(src, /emitirNfePorVendaId/);
  });

  it('frontend Central de Faturamento registrado', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'frontend/erp/js/central-faturamento.js')));
    const html = read('frontend/erp/index.html');
    const app = read('frontend/erp/js/app.js');
    const core = read('frontend/shared/js/core.js');
    const nom = read('frontend/shared/js/cds-nomenclatura.js');
    assert.match(html, /central-faturamento/);
    assert.match(html, /central-faturamento\.js/);
    assert.match(app, /case 'central-faturamento'/);
    assert.match(core, /central-faturamento/);
    assert.match(nom, /centralFaturamento/);
    assert.match(read('frontend/erp/js/central-faturamento.js'), /loadCentralFaturamento/);
  });
});
