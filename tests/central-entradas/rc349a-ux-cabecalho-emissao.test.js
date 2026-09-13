/**
 * RC3.4.9A — UX Central: cabeçalho da lista + emissão + saúde compacta.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const UX = require(path.join(root, 'frontend/erp/js/central-entradas-ux.js'));
const mainSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'frontend/css/central-entradas-ux1.css'), 'utf8');

describe('RC3.4.9A — data de emissão dd/MM/aa', () => {
  it('formata emissão com ano curto e sem horário', () => {
    assert.equal(UX.formatarDataEmissaoCurtaCentral('2026-07-27'), '27/07/26');
    assert.equal(UX.formatarDataEmissaoCurtaCentral('2026-07-27T15:30:00.000Z'), '27/07/26');
    assert.equal(UX.formatarDataEmissaoCurtaCentral(null), '—');
    assert.equal(UX.formatarDataEmissaoCurtaCentral(''), '—');
  });
});

describe('RC3.4.9A — lista com cabeçalho e coluna Emissão', () => {
  it('renderiza cabeçalho fixo alinhado às colunas', () => {
    assert.match(mainSrc, /central-rc40-doc-cols-header/);
    assert.match(mainSrc, /Fornecedor[\s\S]*NF[\s\S]*Emissão[\s\S]*Valor[\s\S]*Ação/);
    assert.doesNotMatch(mainSrc, /Fornecedor[\s\S]*NF[\s\S]*Emissão[\s\S]*Valor[\s\S]*Status[\s\S]*Ação/);
    assert.match(mainSrc, /formatarDataEmissaoCurtaListaCentral|formatarDataEmissaoCurtaCentral/);
    assert.match(mainSrc, /central-rc40-doc-fornecedor/);
    assert.match(mainSrc, /central-rc40-doc-cnpj/);
    assert.match(cssSrc, /central-rc40-doc-cols-header/);
    assert.match(cssSrc, /position:\s*sticky/);
    assert.doesNotMatch(cssSrc.match(/\.central-rc40-doc-fornecedor\s*\{[^}]+\}/)?.[0] || '', /text-overflow:\s*ellipsis/);
  });
});

describe('RC3.4.9A — saúde compacta NF • Emissão • Situação', () => {
  it('monta linha para cenários oficiais', () => {
    assert.equal(
      UX.montarLinhaSaudeCompactaCentral({
        numero: '253483',
        dataEmissao: '2026-07-27',
        status: 'XML_INDISPONIVEL'
      }),
      '253483 • 27/07/26 • XML indisponível na SEFAZ'
    );
    assert.equal(
      UX.montarLinhaSaudeCompactaCentral({
        numero: '64706',
        dataEmissao: '2026-07-27',
        status: 'EM_COMPRA'
      }),
      '64706 • 27/07/26 • Em Compra'
    );
    assert.equal(
      UX.montarLinhaSaudeCompactaCentral({
        dataEmissao: '2026-07-27',
        status: 'AGUARDANDO_XML_COMPLETO'
      }),
      '— • 27/07/26 • Aguardando XML'
    );
    assert.equal(
      UX.montarLinhaSaudeCompactaCentral({
        numero: '100',
        status: 'EM_PROCESSAMENTO'
      }),
      '100 • — • Processando'
    );
  });

  it('painel usa linha compacta e mantém tempo à direita', () => {
    const html = UX.renderPainelSaudeDocumentalCentral({
      contadores: { criticos: 1 },
      estatisticas: {},
      alertas: [{
        documentoId: 1,
        fornecedor: 'MERCANTE & ROFE',
        numero: '64706',
        dataEmissao: '2026-07-27',
        status: 'EM_COMPRA',
        indicador: '🔴',
        diagnostico: 'Documento parado na etapa EM_COMPRA há 6h31.',
        tempoParadoLabel: '6h31'
      }]
    });
    assert.match(html, /64706 • 27\/07\/26 • Em Compra/);
    assert.match(html, /6h31/);
    assert.match(html, /central-health-alerta-tempo/);
  });

  it('backend health expõe numero e data_emissao no painel', () => {
    const analyzerSrc = fs.readFileSync(
      path.join(root, 'backend/motores/central-entradas/health/HealthAnalyzer.js'),
      'utf8'
    );
    const monitorSrc = fs.readFileSync(
      path.join(root, 'backend/motores/central-entradas/health/HealthMonitor.js'),
      'utf8'
    );
    assert.match(analyzerSrc, /numero:\s*doc\.numero/);
    assert.match(analyzerSrc, /dataEmissao:\s*doc\.dataEmissao/);
    assert.match(monitorSrc, /numero:\s*a\.numero/);
    assert.match(monitorSrc, /dataEmissao:\s*a\.dataEmissao/);
  });
});
