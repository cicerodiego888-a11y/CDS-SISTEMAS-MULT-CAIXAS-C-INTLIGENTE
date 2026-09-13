/**
 * RC3.16.3 — Homologação dest.xNome + parser protNFe/infProt.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  NOME_DEST_HOMOLOGACAO,
  parseRetornoAutorizacaoNfe,
  resolverNomeDestinatarioNfe
} = require('../../backend/services/fiscal/nfeRetornoAutorizacao');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const XML_LOTE_104_REJEICAO_598 = `<?xml version="1.0" encoding="UTF-8"?>
<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <tpAmb>2</tpAmb>
  <cUF>23</cUF>
  <verAplic>SVRS20240101</verAplic>
  <cStat>104</cStat>
  <xMotivo>Lote processado</xMotivo>
  <cMsg>0</cMsg>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <verAplic>SVRS20240101</verAplic>
      <chNFe>23260100000000000000550010000000011000000010</chNFe>
      <dhRecbto>2026-07-24T13:00:00-03:00</dhRecbto>
      <nProt></nProt>
      <digVal>abc</digVal>
      <cStat>598</cStat>
      <xMotivo>NF-e emitida em ambiente de homologacao com Razao Social do destinatario diferente de NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xMotivo>
    </infProt>
  </protNFe>
</retEnviNFe>`;

const XML_LOTE_104_AUTORIZADA_100 = `<?xml version="1.0" encoding="UTF-8"?>
<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <tpAmb>2</tpAmb>
  <cStat>104</cStat>
  <xMotivo>Lote processado</xMotivo>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <chNFe>23260100000000000000550010000000011000000011</chNFe>
      <dhRecbto>2026-07-24T13:05:00-03:00</dhRecbto>
      <nProt>123456789012345</nProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</retEnviNFe>`;

const XML_LOTE_104_SEM_PROT = `<?xml version="1.0" encoding="UTF-8"?>
<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <cStat>104</cStat>
  <xMotivo>Lote processado</xMotivo>
  <nRec>999888777</nRec>
</retEnviNFe>`;

describe('RC3.16.3 — homologação dest.xNome', () => {
  it('tpAmb=2 força nome oficial SEFAZ', () => {
    assert.equal(
      resolverNomeDestinatarioNfe(2, 'CLIENTE REAL LTDA'),
      NOME_DEST_HOMOLOGACAO
    );
    assert.equal(
      resolverNomeDestinatarioNfe('2', 'Outro Nome'),
      NOME_DEST_HOMOLOGACAO
    );
  });

  it('tpAmb=1 preserva nome do destinatário (produção)', () => {
    assert.equal(
      resolverNomeDestinatarioNfe(1, 'CLIENTE REAL LTDA'),
      'CLIENTE REAL LTDA'
    );
  });

  it('xmlBuilderNfeVenda usa resolverNomeDestinatarioNfe', () => {
    const src = read('backend/services/fiscal/xmlBuilderNfeVenda.js');
    assert.match(src, /resolverNomeDestinatarioNfe/);
    assert.match(src, /nfeRetornoAutorizacao/);
    assert.doesNotMatch(
      src,
      /destNome = xmlEscape\(venda\.cliente_nome \|\| 'DESTINATARIO NAO INFORMADO'\)/
    );
  });

  it('buildNfeXml em homologação gera xNome oficial', () => {
    const { buildNfeXml } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');
    const built = buildNfeXml({
      venda: {
        id: 1,
        total: 10,
        desconto: 0,
        cliente_nome: 'CLIENTE REAL LTDA',
        cliente_cpf: '12345678901',
        valor_fiscal: 10
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'ITEM',
        quantidade_fiscal: 1,
        valor_fiscal: 10,
        preco_unitario: 10,
        ncm: '12345678'
      }],
      config: {
        ambiente: 2,
        cnpj: '12345678000199',
        ie: '123456789',
        nomeEmpresa: 'EMPRESA TESTE',
        codigoUf: 23,
        serie_nfe: 1,
        numero_atual_nfe: 1,
        uf_sigla: 'CE',
        codigo_municipio: '2307304',
        municipio_nome: 'JUAZEIRO DO NORTE',
        crt: 1
      },
      dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' },
      numero: 1,
      serie: 1
    });
    assert.match(built.xmlSemAssinatura, /<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xNome>/);
    assert.match(built.xmlSemAssinatura, /<CPF>12345678901<\/CPF>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /CLIENTE REAL LTDA/);
  });
});

describe('RC3.16.3 — parser protNFe/infProt', () => {
  it('lote 104 + infProt 598 → rejeitada (não aguardando_retorno)', () => {
    const p = parseRetornoAutorizacaoNfe(XML_LOTE_104_REJEICAO_598);
    assert.equal(p.cStatLote, '104');
    assert.equal(p.temInfProt, true);
    assert.equal(p.cStat, '598');
    assert.match(p.xMotivo, /homologacao/i);
    assert.equal(p.status, 'rejeitada');
    assert.equal(p.sucesso, false);
  });

  it('lote 104 + infProt 100 → autorizada com protocolo', () => {
    const p = parseRetornoAutorizacaoNfe(XML_LOTE_104_AUTORIZADA_100);
    assert.equal(p.cStatLote, '104');
    assert.equal(p.cStat, '100');
    assert.equal(p.nProt, '123456789012345');
    assert.equal(p.status, 'autorizada');
    assert.equal(p.sucesso, true);
  });

  it('lote 104 sem protNFe → aguardando_retorno', () => {
    const p = parseRetornoAutorizacaoNfe(XML_LOTE_104_SEM_PROT);
    assert.equal(p.cStatLote, '104');
    assert.equal(p.temInfProt, false);
    assert.equal(p.status, 'aguardando_retorno');
    assert.equal(p.recibo, '999888777');
  });

  it('aplicarResultadoEmissao usa parseRetornoAutorizacaoNfe', () => {
    const src = read('backend/services/fiscal/nfeOperacionalService.js');
    assert.match(src, /parseRetornoAutorizacaoNfe/);
    assert.match(src, /temInfProt/);
    assert.doesNotMatch(
      src,
      /const cStat = \(String\(raw\)\.match\(\/<cStat>/
    );
  });

  it('nfeEmissorVenda classifica via parser', () => {
    const src = read('backend/services/fiscal/nfeEmissorVenda.js');
    assert.match(src, /parseRetornoAutorizacaoNfe/);
  });

  it('Central NF-e expõe cStat/xMotivo/timeline rejeitada', () => {
    const svc = read('backend/services/fiscal/nfeCentralService.js');
    assert.match(svc, /id: 'rejeitada'/);
    assert.match(svc, /sefaz:/);
    assert.match(svc, /parseRetornoAutorizacaoNfe/);

    const ui = read('frontend/erp/js/nfe-central.js');
    assert.match(ui, /Código SEFAZ/);
    assert.match(ui, /Motivo da rejeição/);
    assert.match(ui, /cstat_consulta/);
  });

  it('não altera emissor NFC-e', () => {
    const nfce = read('backend/services/fiscal/emissor.js');
    assert.doesNotMatch(nfce, /nfeRetornoAutorizacao/);
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/xmlBuilder.js')));
  });
});
