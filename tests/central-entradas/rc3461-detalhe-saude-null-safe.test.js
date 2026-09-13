/**
 * RC3.4.6.1 — Detalhe da saúde null-safe (Central de Entradas).
 * Não altera MIRX / Health Monitor / banco — apenas abertura do detalhe UX.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const UX = require(path.join(
  __dirname,
  '../../frontend/erp/js/central-entradas-ux.js'
));

function assertNaoLanca(fn, label) {
  try {
    return fn();
  } catch (err) {
    assert.fail(`${label}: lançou ${err && err.message}`);
  }
}

describe('RC3.4.6.1 — detalhe saúde null-safe', () => {
  it('wait=null não lança em explicar/resolver/montar', () => {
    const doc = { id: 1, status: 'AGUARDANDO_XML_COMPLETO', tipoDocumento: 'RES_NFE' };
    assertNaoLanca(() => UX.explicarStatusCentral(doc, null), 'explicarStatusCentral');
    assertNaoLanca(() => UX.resolverStatusRealCentral(doc, null), 'resolverStatusRealCentral');
    assertNaoLanca(
      () => UX.montarEtapasOperacionaisCentral(doc, [], null, null),
      'montarEtapas'
    );
    assertNaoLanca(() => UX.renderExplicacaoStatusCentral(doc, null), 'renderExplicacao');
    assertNaoLanca(() => UX.renderCardXmlWaitOperacionalCentral(doc, null), 'xmlWait');
    assertNaoLanca(() => UX.renderChipEtapaCentral(UX.resolverChipEtapaCentral(doc, null)), 'chip');
  });

  it('documento sem health: mensagem amigável', () => {
    const html = assertNaoLanca(
      () => UX.renderCardSaudeDocumentoCentral(null, { id: 2, status: 'SINCRONIZADA' }),
      'sem saude'
    );
    assert.match(html, /Saúde ainda não calculada|sem diagnóstico/i);
  });

  it('documento encerrado: sem próximas tentativas', () => {
    const html = assertNaoLanca(
      () => UX.renderCardSaudeDocumentoCentral(null, { id: 3, status: 'GRAVADA' }),
      'encerrado sem saude'
    );
    assert.match(html, /Documento encerrado/);
    assert.match(html, /Não existem próximas tentativas/);

    const texto = UX.explicarStatusCentral({ status: 'GRAVADA' }, null);
    assert.match(texto, /Documento encerrado/);
    assert.match(texto, /Não existem próximas tentativas/);
  });

  it('documento saudável com campos null não lança', () => {
    const saude = {
      nivel: 'SAUDAVEL',
      nivelLabel: 'Saudável',
      indicador: '🟢',
      cor: '#198754',
      diagnostico: null,
      regra: null,
      tempoParadoLabel: null,
      ultimaAtualizacaoDoc: null,
      motivo: null,
      mirx: null,
      detectadoEm: null,
      recomendacao: null
    };
    const html = assertNaoLanca(
      () => UX.renderCardSaudeDocumentoCentral(saude, { status: 'SINCRONIZADA' }),
      'saudavel null fields'
    );
    assert.match(html, /Saúde do documento/);
  });

  it('documento crítico / bloqueado com mirx null-safe', () => {
    for (const nivel of ['CRITICO', 'BLOQUEADO', 'ATENCAO']) {
      const saude = {
        nivel,
        nivelLabel: nivel,
        diagnostico: null,
        regra: null,
        tempoParado: null,
        tempoParadoLabel: null,
        ultimaAtualizacaoDoc: null,
        motivo: null,
        mirx: { proximaTentativa: null, motivo: null },
        detectadoEm: null
      };
      assertNaoLanca(
        () => UX.renderCardSaudeDocumentoCentral(saude, { status: 'AGUARDANDO_XML_COMPLETO' }),
        nivel
      );
    }
  });

  it('painel saúde null e alertas com itens null', () => {
    const vazio = assertNaoLanca(() => UX.renderPainelSaudeDocumentalCentral(null), 'painel null');
    assert.match(vazio, /Saúde ainda não calculada/);

    const comAlertas = assertNaoLanca(
      () => UX.renderPainelSaudeDocumentalCentral({
        contadores: null,
        estatisticas: null,
        alertas: [null, { documentoId: 9, diagnostico: null, regra: null, tempoParadoLabel: null }],
        geradoEm: null
      }),
      'painel alertas null'
    );
    assert.match(comAlertas, /Saúde da Central/);
  });

  it('painel saúde exibe NF • Emissão • Situação com tempo à direita', () => {
    const html = assertNaoLanca(
      () => UX.renderPainelSaudeDocumentalCentral({
        contadores: { bloqueados: 1 },
        estatisticas: {},
        alertas: [{
          documentoId: 27,
          fornecedor: 'NILO MAIA DISTRIBUIDORA',
          numero: '253483',
          status: 'XML_INDISPONIVEL',
          diagnostico: 'Documento encerrado: XML indisponível na SEFAZ (estado terminal).',
          nivel: 'BLOQUEADO',
          indicador: '⚫',
          dataEmissao: '2026-07-27',
          tempoParadoLabel: '7h18'
        }],
        geradoEm: '2026-07-28T11:11:00.000Z'
      }),
      'painel compacto'
    );
    assert.match(html, /253483 • 27\/07\/26 • XML indisponível na SEFAZ/);
    assert.match(html, /7h18/);
    assert.match(html, /central-health-alerta-linha/);
  });

  it('linha saúde compacta trata ausência de NF e emissão', () => {
    assert.equal(
      UX.montarLinhaSaudeCompactaCentral({
        status: 'XML_INDISPONIVEL',
        dataEmissao: '2026-07-27'
      }),
      '— • 27/07/26 • XML indisponível na SEFAZ'
    );
    assert.equal(
      UX.montarLinhaSaudeCompactaCentral({
        numero: '253483',
        status: 'EM_COMPRA'
      }),
      '253483 • — • Em Compra'
    );
    assert.equal(UX.formatarDataEmissaoCurtaCentral('2026-07-27'), '27/07/26');
    assert.equal(UX.formatarDataEmissaoCurtaCentral(null), '—');
  });

  it('documento antigo / parcial: detalhe monta sem exceção', () => {
    const docAntigo = { id: 99, status: 'RECEBIDA' };
    assertNaoLanca(() => UX.explicarStatusCentral(docAntigo, undefined), 'antigo wait undefined');
    assertNaoLanca(() => UX.renderCardSaudeDocumentoCentral(undefined, docAntigo), 'antigo saude undefined');
    assertNaoLanca(
      () => UX.renderInfoTecnicasRecolhivelCentral({ doc: docAntigo, wait: null, sefaz: null }),
      'tech null'
    );
  });

  it('proximaTentativa ausente não lança countdown', () => {
    const cd = UX.formatarCountdownCentral(null);
    assert.equal(cd.faltam, '—');
    const texto = UX.explicarStatusCentral(
      { status: 'AGUARDANDO_XML_COMPLETO' },
      { proximaTentativa: null, bloqueio656: null }
    );
    assert.ok(typeof texto === 'string' && texto.length > 0);
  });
});
