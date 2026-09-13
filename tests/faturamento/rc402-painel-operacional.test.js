/**
 * RC4.0.2 — Painel Operacional Fiscal (smoke).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC4.0.2 — Painel Operacional', () => {
  it('serviço e exports do painel existem', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/faturamento/CentralPainelOperacionalService.js')));
    const Painel = require('../../backend/services/faturamento/CentralPainelOperacionalService');
    assert.equal(typeof Painel.listarFilaOperacional, 'function');
    assert.equal(typeof Painel.obterDashboard, 'function');
    assert.equal(typeof Painel.obterStatusSefaz, 'function');
    assert.equal(typeof Painel.obterPainelRejeicoes, 'function');
    assert.equal(typeof Painel.listarEventosGlobais, 'function');
    assert.equal(typeof Painel.executarAcoesLote, 'function');
    assert.equal(typeof Painel.obterPainelInicial, 'function');
    assert.ok(Painel.TIPOS_DOCUMENTO_FISCAL.some((t) => t.id === 'nfe' && t.ativo));
    assert.ok(Painel.TIPOS_DOCUMENTO_FISCAL.some((t) => t.id === 'mdfe' && t.preparado));
    assert.ok(Painel.FILTROS_RAPIDOS.some((f) => f.id === 'rejeitadas'));
  });

  it('rotas do painel registradas', () => {
    const src = read('backend/rotas/centralFaturamento.js');
    assert.match(src, /\/painel/);
    assert.match(src, /\/dashboard/);
    assert.match(src, /\/sefaz/);
    assert.match(src, /\/rejeicoes/);
    assert.match(src, /\/eventos/);
    assert.match(src, /\/lote/);
  });

  it('UI tem fila operacional, dashboard e lote', () => {
    const src = read('frontend/erp/js/central-faturamento.js');
    assert.match(src, /Fila de Faturamento/);
    assert.match(src, /cfDashboard/);
    assert.match(src, /cfSefaz/);
    assert.match(src, /cfRejeicoes/);
    assert.match(src, /cfEventos/);
    assert.match(src, /cf-lote/);
    assert.match(src, /central-faturamento\/painel/);
    assert.match(src, /Voltar ao Painel/);
    assert.match(src, /Pendências para emissão/);
  });

  it('classificarSituacaoFiscal cobre casos básicos', () => {
    const { classificarSituacaoFiscal } = require('../../backend/services/faturamento/CentralPainelOperacionalService');
    assert.equal(classificarSituacaoFiscal({ nfe_status: 'autorizada' }).situacao_fiscal, 'autorizada');
    assert.equal(classificarSituacaoFiscal({ nfe_status: 'rejeitada' }).situacao_fiscal, 'rejeitada');
    assert.equal(classificarSituacaoFiscal({ nota_id: null, cliente_cpf: '' }).situacao_fiscal, 'pendencias');
    assert.equal(classificarSituacaoFiscal({ nota_id: null, cliente_cpf: '52998224725' }).pronta, true);
  });

  it('listarFila delega ao painel operacional', () => {
    const src = read('backend/services/faturamento/CentralFaturamentoService.js');
    assert.match(src, /CentralPainelOperacionalService/);
    assert.match(src, /listarFilaOperacional/);
    assert.doesNotMatch(src, /v\.data,/);
  });
});
