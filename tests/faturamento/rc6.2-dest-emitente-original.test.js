/**
 * RC6.2 — Destinatário da devolução de compra = emitente da NF-e original.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildXmlNFeDevolucaoCompra,
  resolverDestinatarioDevolucaoCompra
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const CHAVE_ORIGEM = '23260963479539000195550010002356951386219958';
const CNPJ_FORNECEDOR = '63479539000195';
const IE_FORNECEDOR = '068994613';
const CNPJ_EMPRESA = '57824986000131';
const IE_EMPRESA = '072205385';

const configDevolucao = {
  codigoUf: '23',
  cnpj: CNPJ_EMPRESA,
  ie: IE_EMPRESA,
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA CDS DEVOLUCAO',
  logradouro: 'RUA EMPRESA',
  numero: '10',
  bairro: 'CENTRO',
  municipioCodigo: '2307304',
  municipioNome: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '88999999999'
};

function bloco(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function itemMinimo() {
  return {
    produto_nome: 'PRODUTO',
    produto_codigo: '78993',
    ncm: '85365090',
    unidade: 'UN',
    quantidade: 1,
    valor_unitario: 10,
    csosn: '102',
    cst_pis: '07',
    cst_cofins: '07'
  };
}

describe('RC6.2 — dest da devolução = emit da NF original', () => {
  it('resolve dest a partir do emitente original contribuinte (não usa dest da NF original)', () => {
    const dest = resolverDestinatarioDevolucaoCompra({
      chave_acesso: CHAVE_ORIGEM,
      fornecedor_cnpj: CNPJ_EMPRESA,
      inscricao_estadual: '',
      emitenteOriginal: {
        CNPJ: CNPJ_FORNECEDOR,
        xNome: 'ANTONIO REINALDO RIBEIRO PARENTE',
        IE: IE_FORNECEDOR,
        CRT: '3',
        xLgr: 'RUA DO FORNECEDOR',
        nro: '100',
        xBairro: 'CENTRO',
        xMun: 'FORTALEZA',
        UF: 'CE',
        CEP: '60000000',
        cMun: '2304400'
      }
    }, configDevolucao);

    assert.equal(dest.cnpj, CNPJ_FORNECEDOR);
    assert.equal(dest.IE, IE_FORNECEDOR);
    assert.equal(dest.indIEDest, '1');
    assert.notEqual(dest.cnpj, CNPJ_EMPRESA);
    assert.notEqual(dest.IE, IE_EMPRESA);
  });

  it('NF original emitida por fornecedor contribuinte → devolução para esse fornecedor', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configDevolucao,
      compra: {
        id: 16,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'ANTONIO REINALDO RIBEIRO PARENTE',
        fornecedor_cnpj: CNPJ_EMPRESA,
        inscricao_estadual: null,
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        emitenteOriginal: {
          CNPJ: CNPJ_FORNECEDOR,
          xNome: 'ANTONIO REINALDO RIBEIRO PARENTE',
          IE: IE_FORNECEDOR,
          CRT: '3',
          xLgr: 'RUA DO FORNECEDOR',
          nro: '50',
          xBairro: 'ALDEOTA',
          xMun: 'FORTALEZA',
          UF: 'CE',
          CEP: '60150100',
          cMun: '2304400'
        }
      },
      itens: [itemMinimo()],
      numero: 110
    });

    const destXml = bloco(built.xmlSemAssinatura, 'dest');
    const emitXml = bloco(built.xmlSemAssinatura, 'emit');
    const ide = bloco(built.xmlSemAssinatura, 'ide');

    assert.equal(tag(emitXml, 'CNPJ'), CNPJ_EMPRESA);
    assert.equal(tag(emitXml, 'CRT'), '1');
    assert.equal(tag(destXml, 'CNPJ'), CNPJ_FORNECEDOR);
    assert.equal(tag(destXml, 'IE'), IE_FORNECEDOR);
    assert.equal(tag(destXml, 'indIEDest'), '1');
    assert.notEqual(tag(destXml, 'indIEDest'), '9');
    assert.notEqual(tag(destXml, 'CNPJ'), tag(emitXml, 'CNPJ'));
    assert.equal(tag(ide, 'indFinal'), '0');
    assert.equal(tag(ide, 'finNFe'), '4');
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE_ORIGEM}</refNFe>`));
    assert.equal(built.destDiagnostico.indIEDest, '1');
    assert.equal(built.destDiagnostico.ieDestinatario, IE_FORNECEDOR);
  });

  it('extrai IE do <emit> do XML original mesmo sem emitenteOriginal injetado', () => {
    const { extrairEmitenteOriginalDoXmlBruto } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
    const xmlOrigem = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${CHAVE_ORIGEM}" versao="4.00">
      <ide><nNF>235695</nNF><serie>1</serie><mod>55</mod></ide>
      <emit>
        <CNPJ>${CNPJ_FORNECEDOR}</CNPJ>
        <xNome>ANTONIO REINALDO RIBEIRO PARENTE</xNome>
        <enderEmit>
          <xLgr>RUA DO FORNECEDOR</xLgr>
          <nro>50</nro>
          <xBairro>ALDEOTA</xBairro>
          <cMun>2304400</cMun>
          <xMun>FORTALEZA</xMun>
          <UF>CE</UF>
          <CEP>60150100</CEP>
        </enderEmit>
        <IE>${IE_FORNECEDOR}</IE>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>${CNPJ_EMPRESA}</CNPJ>
        <xNome>EMPRESA CDS</xNome>
        <indIEDest>1</indIEDest>
        <IE>${IE_EMPRESA}</IE>
      </dest>
    </infNFe>
  </NFe>
</nfeProc>`;

    const emitenteOriginal = extrairEmitenteOriginalDoXmlBruto(xmlOrigem);
    assert.equal(emitenteOriginal.CNPJ, CNPJ_FORNECEDOR);
    assert.equal(emitenteOriginal.IE, IE_FORNECEDOR);

    const built = buildXmlNFeDevolucaoCompra({
      config: configDevolucao,
      compra: {
        id: 16,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor_cnpj: CNPJ_EMPRESA,
        inscricao_estadual: null,
        xmlOrigem
      },
      itens: [itemMinimo()],
      numero: 111
    });

    const destXml = bloco(built.xmlSemAssinatura, 'dest');
    assert.equal(tag(destXml, 'CNPJ'), CNPJ_FORNECEDOR);
    assert.equal(tag(destXml, 'IE'), IE_FORNECEDOR);
    assert.equal(tag(destXml, 'indIEDest'), '1');
    assert.equal(tag(bloco(built.xmlSemAssinatura, 'ide'), 'indFinal'), '0');
  });

  it('fallback xmlOrigem preenche IE quando emitenteOriginal chega sem IE', () => {
    const { extrairEmitenteOriginalDoXmlBruto } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
    const xmlOrigem = `<NFe><infNFe><emit>
      <CNPJ>${CNPJ_FORNECEDOR}</CNPJ>
      <xNome>FORNECEDOR</xNome>
      <IE>${IE_FORNECEDOR}</IE>
    </emit></infNFe></NFe>`;
    const doBruto = extrairEmitenteOriginalDoXmlBruto(xmlOrigem);
    assert.equal(doBruto.IE, IE_FORNECEDOR);

    const dest = resolverDestinatarioDevolucaoCompra({
      chave_acesso: CHAVE_ORIGEM,
      inscricao_estadual: '',
      emitenteOriginal: { CNPJ: CNPJ_FORNECEDOR, IE: null },
      xmlOrigem
    }, configDevolucao);
    assert.equal(dest.IE, IE_FORNECEDOR);
    assert.equal(dest.indIEDest, '1');
    assert.equal(dest.origem.ie, 'xml_bruto.emit.IE');
  });
});
