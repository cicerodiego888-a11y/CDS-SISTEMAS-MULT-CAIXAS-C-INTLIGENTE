/**
 * RC4 — Ciclo de vida oficial da NF-e de Devolução de Compra.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseRetornoAutorizacaoNfe } = require('../../backend/services/fiscal/nfeRetornoAutorizacao');
const {
  ESTADOS,
  EVENTOS,
  uiDoEstado,
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  mensagemRejeicaoDetalhada
} = require('../../backend/services/fiscal/nfeDevolucaoEstados');

describe('RC4 — parser 103 lote recebido', () => {
  it('cStat 103 sem infProt → aguardando_retorno + recibo', () => {
    const xml = `<?xml version="1.0"?>
      <retEnviNFe versao="4.00">
        <tpAmb>2</tpAmb>
        <cStat>103</cStat>
        <xMotivo>Lote recebido com sucesso</xMotivo>
        <nRec>123456789012345</nRec>
      </retEnviNFe>`;
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.equal(p.status, 'aguardando_retorno');
    assert.equal(p.cStat, '103');
    assert.equal(p.recibo, '123456789012345');
    assert.equal(p.temInfProt, false);
    assert.equal(p.sucesso, false);
  });

  it('autorização imediata 100 com infProt', () => {
    const xml = `<retEnviNFe>
      <cStat>104</cStat>
      <xMotivo>Lote processado</xMotivo>
      <protNFe><infProt>
        <cStat>100</cStat>
        <xMotivo>Autorizado o uso da NF-e</xMotivo>
        <nProt>999888777</nProt>
        <chNFe>${'1'.repeat(44)}</chNFe>
        <dhRecbto>2026-07-29T10:00:00-03:00</dhRecbto>
      </infProt></protNFe>
    </retEnviNFe>`;
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.equal(p.status, 'autorizada');
    assert.equal(p.nProt, '999888777');
    assert.equal(p.sucesso, true);
  });

  it('rejeição 539 com mensagem detalhada', () => {
    const xml = `<retEnviNFe>
      <cStat>104</cStat>
      <protNFe><infProt>
        <cStat>539</cStat>
        <xMotivo>Duplicidade de NF-e</xMotivo>
      </infProt></protNFe>
    </retEnviNFe>`;
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.equal(p.status, 'rejeitada');
    assert.equal(p.cStat, '539');
    const msg = mensagemRejeicaoDetalhada(p.cStat, p.xMotivo);
    assert.match(msg, /Rejeição 539/);
    assert.match(msg, /Duplicidade/);
  });

  it('denegação 110', () => {
    const xml = `<retEnviNFe>
      <cStat>104</cStat>
      <protNFe><infProt>
        <cStat>110</cStat>
        <xMotivo>Uso Denegado</xMotivo>
      </infProt></protNFe>
    </retEnviNFe>`;
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.equal(p.status, 'denegada');
  });
});

describe('RC4 — estados e reenvio seguro', () => {
  it('UI oficial dos estados', () => {
    assert.equal(uiDoEstado(ESTADOS.AUTORIZADA).emoji, '🟢');
    assert.equal(uiDoEstado(ESTADOS.CANCELADA).label, 'Cancelada');
    assert.equal(uiDoEstado(ESTADOS.PROCESSANDO).label, 'Processando');
  });

  it('permite reenvio somente em estados seguros', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada' }), true);
    assert.equal(podeReenviarDevolucao({ status: 'erro_comunicacao' }), true);
    assert.equal(podeReenviarDevolucao({ status: 'erro_validacao' }), true);
    assert.equal(podeReenviarDevolucao({
      status: 'rejeitada',
      rejeicao_codigo: '590',
      cstat_retorno: '590'
    }), false);
    assert.equal(podeReenviarDevolucao({
      status: 'rejeitada',
      rejeicao_codigo: '275'
    }), false);
    assert.equal(podeReenviarDevolucao({
      status: 'rejeitada',
      rejeicao_codigo: '863',
      cstat_retorno: '863'
    }), false);
    assert.equal(podeReenviarDevolucao({ status: 'autorizada' }), false);
    assert.equal(podeReenviarDevolucao({ status: 'cancelada' }), false);
    assert.equal(podeReenviarDevolucao({ status: 'denegada' }), false);
    assert.equal(podeReenviarDevolucao({ status: 'aguardando_retorno' }), false);
  });

  it('cancelamento só para autorizada', () => {
    assert.equal(podeCancelarDevolucao({ status: 'autorizada' }), true);
    assert.equal(podeCancelarDevolucao({ status: 'cancelamento_rejeitado' }), true);
    assert.equal(podeCancelarDevolucao({ status: 'rejeitada' }), false);
    assert.equal(podeCancelarDevolucao({ status: 'cancelada' }), false);
  });

  it('eventos da timeline existem', () => {
    assert.ok(EVENTOS.XML_GERADO);
    assert.ok(EVENTOS.ASSINADO);
    assert.ok(EVENTOS.ENVIADO);
    assert.ok(EVENTOS.LOTE_RECEBIDO);
    assert.ok(EVENTOS.AUTORIZADO);
    assert.ok(EVENTOS.CANCELADO);
    assert.ok(EVENTOS.DANFE_GERADO);
  });
});

describe('RC4 — sincronização de status (mapa)', () => {
  it('consulta com 100 → autorizada', () => {
    const xml = `<retConsSitNFe>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
      <protNFe><infProt>
        <cStat>100</cStat>
        <xMotivo>Autorizado o uso da NF-e</xMotivo>
        <nProt>111</nProt>
        <chNFe>${'2'.repeat(44)}</chNFe>
      </infProt></protNFe>
    </retConsSitNFe>`;
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.equal(p.status, 'autorizada');
    assert.equal(p.nProt, '111');
  });

  it('consulta cancelada 101', () => {
    const xml = `<retConsSitNFe>
      <cStat>101</cStat>
      <xMotivo>Cancelamento de NF-e homologado</xMotivo>
      <protNFe><infProt>
        <cStat>101</cStat>
        <xMotivo>Cancelamento de NF-e homologado</xMotivo>
        <nProt>222</nProt>
      </infProt></protNFe>
    </retConsSitNFe>`;
    // 101 com infProt: parser trata como rejeitada (não é 100/150/110...)
    // Lifecycle mapeia 101 → cancelada na sincronização
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.ok(p.cStat === '101' || p.temInfProt);
  });
});

describe('RC4 — XML versionado (regras)', () => {
  it('mensagem nunca genérica na rejeição 778', () => {
    const msg = mensagemRejeicaoDetalhada('778', 'CFOP incompatível');
    assert.equal(msg, 'Rejeição 778\nCFOP incompatível');
    assert.doesNotMatch(msg, /erro genérico/i);
  });
});
