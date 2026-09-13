/**
 * Rejeição SEFAZ 590: CST de regime normal com emitente CRT=1 ou 4.
 * A estrutura ICMS da devolução segue o CRT do emitente; valores espelhados
 * continuam proporcionais à quantidade devolvida.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildXmlNFeDevolucaoCompra
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const {
  parsearDetsDoXml,
  espelharDet,
  flattenParaItem
} = require('../../backend/services/fiscal/espelharTributosNfeDevolucaoCompra');
const {
  resolverIcmsPorCrtEmitente,
  validarIcmsXmlContraCrt
} = require('../../backend/services/fiscal/resolverIcmsCrtEmitente');
const { validarXmlFiscal, extrairTotais } = require('../../backend/services/fiscal/validarXmlFiscal');

const FIXTURE = path.join(__dirname, 'fixtures', 'rc2-nfe-origem-tributos.xml');
const CHAVE44 = '23240165957340000150550010000001231000001234';

function configEmitente(crt) {
  return {
    codigoUf: '23',
    cnpj: '65957340000150',
    ie: '073252638',
    crt,
    ambiente: 2,
    serie: 1,
    nomeEmpresa: 'EMPRESA TESTE CDS',
    logradouro: 'RUA A',
    numero: '100',
    bairro: 'CENTRO',
    municipioCodigo: '2307304',
    municipioNome: 'Juazeiro do Norte',
    uf: 'CE',
    cep: '63000000',
    telefone: '88999999999'
  };
}

const compraBase = {
  id: 4,
  chave_acesso: CHAVE44,
  fornecedor: 'FORNECEDOR TESTE LTDA',
  fornecedor_cnpj: '12345678000199',
  cidade: 'Juazeiro do Norte',
  uf: 'CE'
};

function bloco(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function itensDaOrigem(dets, qtdPorItem) {
  return dets.map((d, i) => {
    const qtd = Array.isArray(qtdPorItem) ? qtdPorItem[i] : d.qCom;
    const esp = espelharDet(d, qtd);
    const flat = flattenParaItem(esp);
    return {
      produto_nome: d.xProd,
      produto_codigo: d.cProd,
      quantidade: qtd,
      valor_unitario: d.vUnCom,
      ncm: d.NCM,
      cest: d.CEST,
      unidade: d.uCom,
      cfop: '5202',
      ...flat
    };
  });
}

describe('Resolução ICMS pelo CRT do emitente', () => {
  it('CRT 1 + CST 00 da origem vira CSOSN (sem CST no grupo ICMS)', () => {
    const r = resolverIcmsPorCrtEmitente({
      crt: 1,
      cst: '00',
      grupoIcms: 'ICMS00',
      icms: { orig: '0', CST: '00', modBC: 3, vBC: 50, pICMS: 18, vICMS: 9 }
    });
    assert.equal(r.regime, 'simples');
    assert.equal(r.cstOriginal, '00');
    assert.equal(r.cst, null);
    assert.equal(r.csosn, '900');
    assert.equal(r.grupoIcms, 'ICMSSN900');
  });

  it('CRT 3 + CST 00 permanece regime normal', () => {
    const r = resolverIcmsPorCrtEmitente({
      crt: 3,
      cst: '00',
      grupoIcms: 'ICMS00',
      icms: { orig: '0', CST: '00', vBC: 100, pICMS: 18, vICMS: 18 }
    });
    assert.equal(r.regime, 'normal');
    assert.equal(r.cst, '00');
    assert.equal(r.csosn, null);
    assert.equal(r.grupoIcms, 'ICMS00');
  });
});

function itemIcms00Espelhado({ vBC, pICMS, vICMS, quantidade = 1, valorUnitario = 157.35, nome = 'AL_CRIMP_DUP' }) {
  const icms = { orig: '1', CST: '00', modBC: 3, vBC, pICMS, vICMS };
  const trib = {
    origem: 1,
    cst: '00',
    csosn: '',
    grupoIcms: 'ICMS00',
    icms,
    pis: { CST: '07' },
    cofins: { CST: '07' },
    ipi: null,
    existe: { icms: true }
  };
  const imposto = `<ICMS><ICMS00><orig>1</orig><CST>00</CST><modBC>3</modBC><vBC>${vBC.toFixed(2)}</vBC><pICMS>${pICMS.toFixed(4)}</pICMS><vICMS>${vICMS.toFixed(2)}</vICMS></ICMS00></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>`;
  return {
    produto_nome: nome,
    produto_codigo: 'AL_CRIMP_DUP',
    quantidade,
    valor_unitario: valorUnitario,
    ncm: '82032000',
    unidade: 'UN',
    cfop: '6202',
    csosn: '',
    cst: '00',
    tributosEspelhados: trib,
    impostoEspelhadoXml: imposto
  };
}

describe('Rejeição 590 — XML de devolução de compra', () => {
  it('emitente CRT 1 + NF original com CST 00/10: XML usa ICMSSN, não CST', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraBase,
      itens: itensDaOrigem(dets, dets.map((d) => d.qCom)),
      numero: 10
    });

    const emit = bloco(built.xmlSemAssinatura, 'emit');
    assert.equal(tag(emit, 'CRT'), '1');
    assert.doesNotMatch(built.xmlSemAssinatura, /<ICMS><ICMS\d{2}>/);
    assert.match(built.xmlSemAssinatura, /<ICMSSN900>/);
    assert.match(built.xmlSemAssinatura, /<CSOSN>900<\/CSOSN>/);
    const icmsBlocos = built.xmlSemAssinatura.match(/<ICMS>[\s\S]*?<\/ICMS>/g) || [];
    for (const b of icmsBlocos) {
      assert.doesNotMatch(b, /<CST>/);
      assert.match(b, /<CSOSN>/);
    }
    assert.ok(built.resolucaoIcms.length >= 1);
    assert.equal(built.resolucaoIcms[0].cstOriginal, '00');
    assert.equal(built.resolucaoIcms[0].csosnEfetivo, '900');
    assert.equal(built.resolucaoIcms[0].grupoIcms, 'ICMSSN900');
    assert.doesNotThrow(() => validarIcmsXmlContraCrt(built.xmlSemAssinatura, 1));
    assert.doesNotThrow(() => validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      modeloDoc: '55',
      validarXsd: false
    }));
  });

  it('emitente CRT 3 + CST normal: XML permanece ICMS00/ICMS10', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraBase,
      itens: itensDaOrigem(dets, [10, 4, 2]),
      numero: 11
    });
    assert.match(built.xmlSemAssinatura, /<CRT>3<\/CRT>/);
    assert.match(built.xmlSemAssinatura, /<ICMS00>/);
    assert.match(built.xmlSemAssinatura, /<CST>00<\/CST>/);
    assert.match(built.xmlSemAssinatura, /<ICMS10>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<ICMSSN/);
    assert.doesNotThrow(() => validarIcmsXmlContraCrt(built.xmlSemAssinatura, 3));
  });

  it('devolução parcial: tributos proporcionais à quantidade', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraBase,
      itens: itensDaOrigem(dets, [5, 2, 1]),
      numero: 12
    });
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 150);
    assert.equal(tot.vIPIDevol, 2.5);
    assert.equal(tot.vPIS, 0.83);
    assert.equal(tot.vCOFINS, 3.8);
    assert.equal(tot.vST, 6.6);
    assert.match(built.xmlSemAssinatura, /<vICMS>9\.00<\/vICMS>/);
    assert.match(built.xmlSemAssinatura, /<ICMSSN/);
  });

  it('devolução total: valores iguais aos da origem', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraBase,
      itens: itensDaOrigem(dets, [10, 4, 2]),
      numero: 13
    });
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 300);
    assert.equal(tot.vIPIDevol, 5);
    assert.equal(tot.vPIS, 1.65);
    assert.equal(tot.vCOFINS, 7.6);
    assert.equal(tot.vST, 13.2);
    assert.match(built.xmlSemAssinatura, /<vICMS>18\.00<\/vICMS>/);
  });

  it('bloqueia XML com CST + CRT 1 antes da transmissão', () => {
    const xmlRuim = `
      <NFe><infNFe>
        <emit><CRT>1</CRT></emit>
        <dest><enderDest><cMun>2307304</cMun><xMun>Juazeiro do Norte</xMun><UF>CE</UF></enderDest></dest>
        <det nItem="1"><prod><xProd>AL_CRIMP_DUP</xProd></prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS></imposto></det>
      </infNFe></NFe>`;
    assert.throws(
      () => validarIcmsXmlContraCrt(xmlRuim, 1),
      /não pode utilizar CST de regime normal/
    );
  });

  it('caso real: CRT 1 + ICMS00 CST 00 vBC=157.35 pICMS=4 vICMS=6.29 → ICMSSN sem CST', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraBase,
      itens: [itemIcms00Espelhado({ vBC: 157.35, pICMS: 4, vICMS: 6.29 })],
      numero: 7
    });
    const xml = built.xmlSemAssinatura;
    assert.match(xml, /<CRT>1<\/CRT>/);
    assert.doesNotMatch(xml, /<ICMS00>/);
    const icms = (xml.match(/<ICMS>[\s\S]*?<\/ICMS>/) || [])[0] || '';
    assert.doesNotMatch(icms, /<CST>/);
    assert.match(icms, /<ICMSSN/);
    assert.match(icms, /<CSOSN>/);
    assert.match(icms, /<vBC>157\.35<\/vBC>/);
    assert.match(icms, /<vICMS>6\.29<\/vICMS>/);
    assert.doesNotThrow(() => validarIcmsXmlContraCrt(xml, 1));
    assert.doesNotThrow(() => validarXmlFiscal({ xml, modeloDoc: '55', validarXsd: false }));
  });

  it('CRT 1 + CST 10 com ST vira ICMSSN sem CST no ICMS', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraBase,
      itens: [{
        ...itemIcms00Espelhado({ vBC: 100, pICMS: 12, vICMS: 12, nome: 'PROD ST' }),
        cst: '10',
        tributosEspelhados: {
          origem: 0,
          cst: '10',
          grupoIcms: 'ICMS10',
          icms: { orig: '0', CST: '10', modBC: 3, vBC: 100, pICMS: 12, vICMS: 12, vBCST: 140, pICMSST: 18, vICMSST: 13.2 },
          pis: { CST: '07' },
          cofins: { CST: '07' }
        },
        impostoEspelhadoXml: '<ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>100.00</vBC><pICMS>12.0000</pICMS><vICMS>12.00</vICMS><vBCST>140.00</vBCST><vICMSST>13.20</vICMSST></ICMS10></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>'
      }],
      numero: 8
    });
    const icms = (built.xmlSemAssinatura.match(/<ICMS>[\s\S]*?<\/ICMS>/) || [])[0];
    assert.doesNotMatch(icms, /<CST>/);
    assert.match(icms, /<ICMSSN/);
  });

  it('CRT 1 + devolução parcial mantém valores proporcionais e grupo SN', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraBase,
      itens: [itemIcms00Espelhado({ vBC: 78.68, pICMS: 4, vICMS: 3.15, quantidade: 0.5, valorUnitario: 157.35 })],
      numero: 9
    });
    assert.match(built.xmlSemAssinatura, /<ICMSSN/);
    assert.doesNotMatch((built.xmlSemAssinatura.match(/<ICMS>[\s\S]*?<\/ICMS>/) || [])[0], /<CST>/);
    assert.match(built.xmlSemAssinatura, /<vICMS>3\.15<\/vICMS>/);
  });

  it('CRT 4 também usa CSOSN e não CST no ICMS', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(4),
      compra: compraBase,
      itens: [itemIcms00Espelhado({ vBC: 157.35, pICMS: 4, vICMS: 6.29 })],
      numero: 10
    });
    assert.match(built.xmlSemAssinatura, /<CRT>4<\/CRT>/);
    assert.match(built.xmlSemAssinatura, /<ICMSSN/);
    assert.doesNotMatch((built.xmlSemAssinatura.match(/<ICMS>[\s\S]*?<\/ICMS>/) || [])[0], /<CST>/);
  });
});
