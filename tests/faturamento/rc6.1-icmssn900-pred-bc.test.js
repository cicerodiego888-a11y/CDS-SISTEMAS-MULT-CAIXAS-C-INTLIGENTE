/**
 * RC6.1 — SEFAZ 225: ordem XML de ICMSSN900 (modBC → vBC → pRedBC).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildXmlNFeDevolucaoCompra } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const {
  montarIcmsXmlResolvido,
  validarOrdemXmlIcms,
  ORDEM_XML_POR_GRUPO
} = require('../../backend/services/fiscal/resolverIcmsCrtEmitente');
const { validarXmlFiscal, validarSchemaXsd } = require('../../backend/services/fiscal/validarXmlFiscal');
const { getFiscalSubDir } = require('../../backend/services/fiscal/paths');

const CHAVE44 = '23240165957340000150550010000001231000001234';

const configBase = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE CDS',
  logradouro: 'RUA A',
  numero: '100',
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

function filhos(inner) {
  const nomes = [];
  const re = /<([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?>/g;
  let m;
  while ((m = re.exec(String(inner || ''))) !== null) nomes.push(m[1]);
  return nomes;
}

function itemCasoReal109() {
  const icms = {
    orig: '0',
    CSOSN: '900',
    modBC: 3,
    vBC: 2783.5,
    pRedBC: 0,
    pICMS: 20,
    vICMS: 556.7
  };
  return {
    produto_nome: 'PRODUTO 78993',
    produto_codigo: '78993',
    nItemOrigem: 1,
    quantidade: 1,
    valor_unitario: 2783.5,
    ncm: '85365090',
    unidade: 'UN',
    cfop: '5202',
    csosn: '900',
    cst_pis: '07',
    cst_cofins: '07',
    tributosEspelhados: {
      origem: 0,
      cst: '',
      csosn: '900',
      grupoIcms: 'ICMSSN900',
      icms,
      pis: { CST: '07' },
      cofins: { CST: '07' },
      existe: { icms: true }
    },
    impostoEspelhadoXml:
      '<ICMS><ICMSSN900><orig>0</orig><CSOSN>900</CSOSN><modBC>3</modBC>'
      + '<pRedBC>0.0000</pRedBC><vBC>2783.50</vBC><pICMS>20.0000</pICMS>'
      + '<vICMS>556.70</vICMS></ICMSSN900></ICMS>'
      + '<PIS><PISNT><CST>07</CST></PISNT></PIS>'
      + '<COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>'
  };
}

describe('RC6.1 — ICMSSN900 pRedBC ordem do schema', () => {
  it('schema ICMSSN900: modBC vem antes de vBC, pRedBC depois de vBC', () => {
    const ordem = ORDEM_XML_POR_GRUPO.ICMSSN900;
    assert.ok(ordem.indexOf('modBC') < ordem.indexOf('vBC'));
    assert.ok(ordem.indexOf('vBC') < ordem.indexOf('pRedBC'));
    assert.ok(ordem.indexOf('pRedBC') < ordem.indexOf('pICMS'));
  });

  it('rejeita localmente ICMSSN900 com pRedBC antes de vBC', () => {
    const xmlRuim = '<ICMSSN900><orig>0</orig><CSOSN>900</CSOSN><modBC>3</modBC>'
      + '<pRedBC>0.0000</pRedBC><vBC>2783.50</vBC><pICMS>20.0000</pICMS><vICMS>556.70</vICMS></ICMSSN900>';
    assert.throws(
      () => validarOrdemXmlIcms(xmlRuim),
      (err) => err && err.code === 'XML_ICMS_ORDEM_INVALIDA'
    );
  });

  it('aceita ICMSSN900 com modBC → vBC → pRedBC', () => {
    const xmlOk = '<ICMSSN900><orig>0</orig><CSOSN>900</CSOSN><modBC>3</modBC>'
      + '<vBC>2783.50</vBC><pRedBC>0.0000</pRedBC><pICMS>20.0000</pICMS><vICMS>556.70</vICMS></ICMSSN900>';
    assert.doesNotThrow(() => validarOrdemXmlIcms(xmlOk));
  });

  it('ICMS20 continua com pRedBC antes de vBC (schema próprio)', () => {
    const xml = montarIcmsXmlResolvido({
      grupoIcms: 'ICMS20',
      regime: 'normal',
      cst: '20',
      origem: '0',
      icms: { modBC: 3, pRedBC: 10, vBC: 100, pICMS: 18, vICMS: 16.2 }
    });
    const inner = bloco(xml, 'ICMS20');
    assert.deepEqual(filhos(inner), ['orig', 'CST', 'modBC', 'pRedBC', 'vBC', 'pICMS', 'vICMS']);
    assert.doesNotThrow(() => validarOrdemXmlIcms(xml));
  });

  it('NF 109 série 1 — XML da devolução gera ICMSSN900 na ordem oficial e mantém pRedBC', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 16,
        chave_acesso: CHAVE44,
        fornecedor: 'FORNECEDOR TESTE LTDA',
        fornecedor_cnpj: '12345678000199',
        cidade: 'Juazeiro do Norte',
        uf: 'CE'
      },
      itens: [itemCasoReal109()],
      numero: 109,
      cfopOverride: '5202'
    });

    assert.equal(built.finNFe, 4);
    assert.match(built.natOp, /DEVOLUCAO DE COMPRA/i);
    assert.match(built.xmlSemAssinatura, /<serie>1<\/serie>/);
    assert.match(built.xmlSemAssinatura, /<nNF>109<\/nNF>/);
    assert.match(built.xmlSemAssinatura, /<cProd>78993<\/cProd>/);
    assert.match(built.xmlSemAssinatura, /<NCM>85365090<\/NCM>/);
    assert.match(built.xmlSemAssinatura, /<CFOP>5202<\/CFOP>/);

    const grupo = bloco(built.xmlSemAssinatura, 'ICMSSN900');
    assert.ok(grupo);
    assert.deepEqual(filhos(grupo), ['orig', 'CSOSN', 'modBC', 'vBC', 'pRedBC', 'pICMS', 'vICMS']);
    assert.match(grupo, /<orig>0<\/orig>/);
    assert.match(grupo, /<CSOSN>900<\/CSOSN>/);
    assert.match(grupo, /<modBC>3<\/modBC>/);
    assert.match(grupo, /<vBC>2783.50<\/vBC>/);
    assert.match(grupo, /<pRedBC>0.0000<\/pRedBC>/);
    assert.match(grupo, /<pICMS>20.0000<\/pICMS>/);
    assert.match(grupo, /<vICMS>556.70<\/vICMS>/);
    assert.doesNotMatch(grupo, /<pRedBC>\s*<\/pRedBC>/);
    assert.ok(grupo.indexOf('<vBC>') < grupo.indexOf('<pRedBC>'));

    assert.doesNotThrow(() => validarOrdemXmlIcms(built.xmlSemAssinatura));
    const fiscal = validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '55',
      validarXsd: true
    });
    assert.equal(fiscal.checks.icmsOrdemXsd, 'PASSOU');
    const xsd = fiscal.checks.schema;
    const xsdPassou = xsd && (xsd.status === 'XSD_OK' || xsd.status === 'XSD_OK_SEM_ASSINATURA');
    const xsdIndisponivel = xsd && xsd.status === 'XSD_FERRAMENTA_INDISPONIVEL';
    assert.ok(xsdPassou || xsdIndisponivel, `schema inesperado: ${JSON.stringify(xsd)}`);

    const pasta = getFiscalSubDir('debug/nfe-devolucao');
    const logPath = path.join(pasta, 'rc6-1-schema.log');
    const xsdDireto = validarSchemaXsd(built.xmlSemAssinatura, { exigirAssinatura: false });
    fs.writeFileSync(logPath, [
      'RC6.1 — ICMSSN900 ordem schema (sem certificado/senha)',
      `geradoEm=${new Date().toISOString()}`,
      `chave=${built.chave}`,
      `finNFe=${built.finNFe}`,
      `nNF=109 serie=1`,
      `grupoICMSSN900_filhos=${filhos(grupo).join(',')}`,
      `validacaoOrdemXml=PASSOU`,
      `validacaoXsd.status=${xsdDireto.status}`,
      `assinatura=NAO_EXECUTADA (teste local; DigestValue/SignatureValue só após XSD OK no fluxo de emissão)`,
      `envioSefaz=NAO_EXECUTADO`,
      '',
      '--- XML antes da assinatura ---',
      built.xmlSemAssinatura,
      '',
      '--- ICMSSN900 ---',
      `<ICMSSN900>${grupo}</ICMSSN900>`,
      ''
    ].join('\n'), 'utf8');
    assert.ok(fs.existsSync(logPath));
  });
});
