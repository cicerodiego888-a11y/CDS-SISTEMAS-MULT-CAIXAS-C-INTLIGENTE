/**
 * Preservação do retorno SEFAZ e classificação da tela de Conclusão.
 * Não transmite e não altera documentos reais.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  CLASSE_EMISSAO,
  classificarResultadoEmissaoNfe,
  normalizarPayloadEmissaoNfe,
  deveBloquearNovaTransmissao
} = require('../../backend/services/fiscal/classificarResultadoEmissaoNfe');
const { parseRetornoAutorizacaoNfe } = require('../../backend/services/fiscal/nfeRetornoAutorizacao');

const ui = require('../../frontend/erp/js/nfe-devolucao-compra.js');
const uiSrc = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/erp/js/nfe-devolucao-compra.js'),
  'utf8'
);
const emitSrc = fs.readFileSync(
  path.resolve(__dirname, '../../backend/services/fiscal/nfeDevolucaoCompra.js'),
  'utf8'
);
const rotasSrc = fs.readFileSync(
  path.resolve(__dirname, '../../backend/rotas/compras.js'),
  'utf8'
);

const XML_REJEICAO_539 = `
<retEnviNFe>
  <protNFe>
    <infProt>
      <tpAmb>1</tpAmb>
      <chNFe>23260857824986000131550010000000180123456789</chNFe>
      <dhRecbto>2026-09-23T21:00:00-03:00</dhRecbto>
      <nProt></nProt>
      <cStat>539</cStat>
      <xMotivo>Rejeicao: Duplicidade de NF-e, com diferenca na Chave de Acesso</xMotivo>
    </infProt>
  </protNFe>
</retEnviNFe>`;

describe('1–3 classificação: rejeição, erro interno e comunicação', () => {
  it('1. rejeição SEFAZ preserva cStat e xMotivo', () => {
    const parsed = parseRetornoAutorizacaoNfe(XML_REJEICAO_539);
    assert.equal(parsed.cStat, '539');
    assert.match(parsed.xMotivo, /Duplicidade/i);
    const cls = classificarResultadoEmissaoNfe({
      success: false,
      status: parsed.status,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo
    });
    assert.equal(cls.classe, CLASSE_EMISSAO.REJECTED_BY_SEFAZ);
    assert.equal(cls.cStat, '539');
    assert.match(cls.xMotivo, /Duplicidade/i);
    assert.equal(cls.rejeicaoSefaz, true);
  });

  it('2. erro interno sem cStat não é rejeição SEFAZ', () => {
    const cls = classificarResultadoEmissaoNfe({
      success: false,
      status: 'erro',
      error: 'TypeError: Cannot read properties of undefined'
    });
    assert.equal(cls.classe, CLASSE_EMISSAO.VALIDATION_ERROR);
    assert.equal(cls.cStat, null);
    assert.equal(cls.rejeicaoSefaz, false);
    assert.notEqual(cls.titulo, 'NF-e rejeitada');
  });

  it('3. erro de comunicação sem cStat', () => {
    const cls = classificarResultadoEmissaoNfe({
      success: false,
      status: 'erro_comunicacao',
      message: 'socket hang up'
    });
    assert.equal(cls.classe, CLASSE_EMISSAO.COMMUNICATION_ERROR);
    assert.equal(cls.cStat, null);
    assert.equal(cls.rejeicaoSefaz, false);
    assert.match(cls.titulo, /comunicação/i);
  });
});

describe('4–6 frontend: cStat, xMotivo e não chamar erro interno de rejeição', () => {
  it('4–5. normaliza HTTP 400 e exibe cStat/xMotivo reais', () => {
    const n = ui.normalizarPayloadEmissaoNfe({
      sucesso: false,
      status: 'rejeitada',
      cStat: '539',
      xMotivo: 'Rejeicao: Duplicidade de NF-e',
      mensagem: 'Rejeicao: Duplicidade de NF-e',
      resultado: { success: false, status: 'rejeitada', cStat: '539', xMotivo: 'Rejeicao: Duplicidade de NF-e' }
    });
    assert.equal(n.classe, 'REJECTED_BY_SEFAZ');
    assert.equal(n.cStat, '539');
    assert.match(n.xMotivo, /Duplicidade/);
    const htmlCls = ui.classificarResultadoEmissaoNfe(n);
    assert.equal(htmlCls.titulo, 'NF-e rejeitada pela SEFAZ');
    assert.equal(htmlCls.cStat, '539');
  });

  it('6. HTTP 400 de saldo/validação não vira rejeitada', () => {
    const n = ui.normalizarPayloadEmissaoNfe({
      success: false,
      error: 'Saldo zerado para os itens selecionados.',
      message: 'Saldo zerado para os itens selecionados.',
      code: 'SALDO_ZERADO',
      status: 'erro_validacao'
    });
    assert.equal(n.classe, 'VALIDATION_ERROR');
    assert.equal(n.rejeicaoSefaz, false);
    assert.match(n.titulo, /Não foi possível emitir a NF-e/);
    assert.match(n.xMotivo || n.message, /Saldo zerado/);
    assert.match(uiSrc, /Sem cStat da SEFAZ/);
    assert.match(uiSrc, /Não foi possível emitir a NF-e/);
    assert.match(uiSrc, /Falha na comunicação com a SEFAZ/);
  });

  it('status rejeitada sem cStat não é rejeição SEFAZ', () => {
    const cls = ui.classificarResultadoEmissaoNfe({ success: false, status: 'rejeitada' });
    assert.equal(cls.rejeicaoSefaz, false);
    assert.notEqual(cls.titulo, 'NF-e rejeitada');
  });
});

describe('7–8 persistência do retorno SEFAZ e XML', () => {
  it('7. parser + payload de emissão preservam cStat/xMotivo/dhRecbto', () => {
    const parsed = parseRetornoAutorizacaoNfe(XML_REJEICAO_539);
    assert.equal(parsed.status, 'rejeitada');
    assert.ok(parsed.dhRecbto);
    assert.match(emitSrc, /cStat: parsed\.cStat/);
    assert.match(emitSrc, /xMotivo: parsed\.xMotivo/);
    assert.match(emitSrc, /dhRecbto: parsed\.dhRecbto/);
    assert.match(rotasSrc, /cStat: resultado\.cStat/);
    assert.match(rotasSrc, /xMotivo: resultado\.xMotivo/);
  });

  it('8. XML de retorno é persistido e gravado em debug', () => {
    assert.match(emitSrc, /xml_retorno: raw/);
    assert.match(emitSrc, /salvarDebug\(`\$\{id\}-03-retorno\.xml`, raw\)/);
    assert.match(emitSrc, /registrarDiagnosticoEmissao/);
  });
});

describe('9–12 bloqueio de retransmissão por evidência anterior', () => {
  it('9. bloqueia se há recibo ou protocolo', () => {
    assert.equal(deveBloquearNovaTransmissao({ recibo: '123' }).bloquear, true);
    assert.equal(deveBloquearNovaTransmissao({ protocolo: '223260092164139' }).bloquear, true);
  });

  it('10. documento já transmitido (XML com cStat) bloqueia', () => {
    const out = deveBloquearNovaTransmissao({
      status: 'rejeitada',
      xml_retorno: XML_REJEICAO_539
    });
    assert.equal(out.bloquear, true);
  });

  it('11. documento autorizado bloqueia nova transmissão', () => {
    const out = deveBloquearNovaTransmissao({ id: 11, status: 'autorizada', protocolo: '1' });
    assert.equal(out.bloquear, true);
    assert.match(out.motivo, /autorizada/);
  });

  it('12. documento rejeitado com chave/retorno bloqueia; rascunho sem evidência não', () => {
    assert.equal(deveBloquearNovaTransmissao({
      status: 'rejeitada',
      chave_acesso: '23260857824986000131550010000000180123456789'
    }).bloquear, true);
    assert.equal(deveBloquearNovaTransmissao(null).bloquear, false);
    assert.equal(deveBloquearNovaTransmissao({ status: 'erro_assinatura' }).bloquear, false);
  });

  it('rota devolve 409 em TRANSMISSAO_ANTERIOR e não reenvia automaticamente', () => {
    assert.match(rotasSrc, /TRANSMISSAO_ANTERIOR/);
    assert.match(rotasSrc, /status\(409\)/);
    assert.match(emitSrc, /deveBloquearNovaTransmissao/);
    assert.match(emitSrc, /posteriorAoRascunho/);
  });
});
