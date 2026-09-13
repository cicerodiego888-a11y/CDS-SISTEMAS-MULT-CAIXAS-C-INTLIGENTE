/**
 * RC2 — Espelhamento fiscal completo NF-e devolução de compra.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  extrairTributosCompletosItemNfe,
  extrairDetCompleto
} = require('../../backend/shared/nfe/mappers/extrairTributosCompletosItemNfe');
const {
  parsearDetsDoXml,
  espelharDet,
  flattenParaItem,
  montarPainelTributacaoOriginal,
  montarImpostoXmlEspelhado,
  validarEspelhamentoAntesTransmissao,
  casarItemOrigem
} = require('../../backend/services/fiscal/espelharTributosNfeDevolucaoCompra');
const { buildXmlNFeDevolucaoCompra } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const FIXTURE = path.join(__dirname, 'fixtures', 'rc2-nfe-origem-tributos.xml');
const CHAVE44 = '23240165957340000150550010000001231000001234';

const configBase = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 3,
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

describe('RC2 — Extração tributária completa', () => {
  it('extrai ICMS00 + FCP + IPI + PIS + COFINS + DIFAL', async () => {
    const xml = fs.readFileSync(FIXTURE, 'utf8');
    const dets = await parsearDetsDoXml(xml);
    assert.equal(dets.length, 3);

    const d1 = dets[0];
    assert.equal(d1.tributos.cst, '00');
    assert.equal(d1.tributos.icms.vBC, 100);
    assert.equal(d1.tributos.icms.pICMS, 18);
    assert.equal(d1.tributos.icms.vICMS, 18);
    assert.equal(d1.tributos.icms.vFCP, 2);
    assert.equal(d1.tributos.ipi.vIPI, 5);
    assert.equal(d1.tributos.pis.vPIS, 1.65);
    assert.equal(d1.tributos.cofins.vCOFINS, 7.6);
    assert.equal(d1.tributos.difal.vICMSUFDest, 6);
    assert.equal(d1.tributos.existe.fcp, true);
    assert.equal(d1.tributos.existe.difal, true);
    assert.equal(d1.CEST, '0300100');
    assert.equal(d1.CFOP, '5102');
  });

  it('extrai ICMS ST + FCP ST', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const d2 = dets[1];
    assert.equal(d2.tributos.cst, '10');
    assert.equal(d2.tributos.existe.st, true);
    assert.equal(d2.tributos.icms.vBCST, 140);
    assert.equal(d2.tributos.icms.vICMSST, 13.2);
    assert.equal(d2.tributos.icms.pMVAST, 40);
    assert.equal(d2.tributos.icms.vFCPST, 2.8);
    assert.equal(d2.tributos.existe.ipi, false);
  });

  it('extrai CSOSN 102', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const d3 = dets[2];
    assert.equal(d3.tributos.csosn, '102');
    assert.equal(d3.tributos.grupoIcms, 'ICMSSN102');
  });
});

describe('RC2 — Espelhamento proporcional', () => {
  it('escala valores monetários pela quantidade e preserva alíquotas/CST', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const esp = espelharDet(dets[0], 5); // metade
    assert.equal(esp.fator, 0.5);
    assert.equal(esp.tributos.cst, '00');
    assert.equal(esp.tributos.icms.pICMS, 18);
    assert.equal(esp.tributos.icms.vBC, 50);
    assert.equal(esp.tributos.icms.vICMS, 9);
    assert.equal(esp.tributos.ipi.vIPI, 2.5);
    assert.equal(esp.tributos.pis.vPIS, 0.83);
    assert.equal(esp.tributos.difal.vICMSUFDest, 3);
  });

  it('gera XML de imposto espelhado com grupos da origem', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const esp = espelharDet(dets[0], 10);
    const flat = flattenParaItem(esp);
    assert.match(flat.impostoEspelhadoXml, /<ICMS00>/);
    assert.match(flat.impostoEspelhadoXml, /<CST>00<\/CST>/);
    assert.match(flat.impostoEspelhadoXml, /<vICMS>18\.00<\/vICMS>/);
    assert.match(flat.impostoEspelhadoXml, /<IPITrib>/);
    assert.match(flat.impostoEspelhadoXml, /<PISAliq>/);
    assert.match(flat.impostoEspelhadoXml, /<COFINSAliq>/);
    assert.match(flat.impostoEspelhadoXml, /<ICMSUFDest>/);
    assert.doesNotMatch(flat.impostoEspelhadoXml, /CSOSN>900/);
  });

  it('painel Tributação Original marca grupos presentes/ausentes', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const painel = montarPainelTributacaoOriginal(dets);
    assert.equal(painel.ICMS.presente, true);
    assert.equal(painel.IPI.presente, true);
    assert.equal(painel.PIS.presente, true);
    assert.equal(painel.COFINS.presente, true);
    assert.equal(painel['ICMS ST'].presente, true);
    assert.equal(painel.FCP.presente, true);
    assert.equal(painel.DIFAL.presente, true);
  });
});

describe('RC2 — Builder XML final com espelhamento', () => {
  it('XML de devolução usa tributos espelhados (sem CST/CSOSN fixos)', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const itens = dets.map((d) => {
      const esp = espelharDet(d, d.qCom);
      const flat = flattenParaItem(esp);
      return {
        produto_nome: d.xProd,
        produto_codigo: d.cProd,
        quantidade: d.qCom,
        valor_unitario: d.vUnCom,
        ncm: d.NCM,
        cest: d.CEST,
        unidade: d.uCom,
        cfop: '5202',
        ...flat
      };
    });

    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 1,
        chave_acesso: CHAVE44,
        fornecedor: 'Fornecedor Teste',
        fornecedor_cnpj: '12345678000199',
        cidade: 'Juazeiro do Norte',
        uf: 'CE'
      },
      itens,
      numero: 99
    });

    assert.match(built.xmlSemAssinatura, /<finNFe>4<\/finNFe>/);
    assert.match(built.xmlSemAssinatura, /<ICMS00>/);
    assert.match(built.xmlSemAssinatura, /<ICMS10>/);
    assert.match(built.xmlSemAssinatura, /<ICMS40>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<ICMSSN/);
    assert.match(built.xmlSemAssinatura, /<vICMSST>13\.20<\/vICMSST>/);
    assert.match(built.xmlSemAssinatura, /<ICMSUFDest>/);
    assert.match(built.xmlSemAssinatura, /<CEST>0300100<\/CEST>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<CSOSN>900<\/CSOSN>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<CST>90<\/CST>/);
  });

  it('não troca chaves semelhantes com medidas diferentes (1/4x8 vs 3/16x4)', () => {
    const dets = [
      {
        nItem: 4,
        cProd: 'CHPHIL_316X4',
        xProd: 'CHAVE PHILLIPS C/ PONTA MAGNETIZADA 3/16X4',
        NCM: '82054000',
        qCom: 4,
        vUnCom: 10
      },
      {
        nItem: 5,
        cProd: 'OUTRO',
        xProd: 'CHAVE PHILLIPS C/ PONTA MAGNETIZADA 1/4"X8"',
        NCM: '82054000',
        qCom: 6,
        vUnCom: 12
      }
    ];
    const usados = new Set();
    const item = {
      produto_codigo: 'CHPHIL_14X8',
      produto_nome: 'CHPHIL_14X8 - CHAVE PHILLIPS C/ PONTA MAGNETIZADA 1/4"X8"',
      ncm: '82054000',
      quantidade: 6,
      quantidade_comprada: 6,
      valor_unitario: 12
    };
    const origem = casarItemOrigem(item, dets, usados);
    assert.ok(origem);
    assert.equal(origem.nItem, 5);
    assert.equal(origem.qCom, 6);
    assert.equal(usados.has(1), true);
  });

  it('bloqueia transmissão sem espelhamento', () => {
    const out = validarEspelhamentoAntesTransmissao(
      { ok: false },
      [{ produto_nome: 'X', quantidade: 1 }]
    );
    assert.equal(out.ok, false);
    assert.ok(out.erros.length > 0);
  });
});

describe('RC2 — Extrator unitário direto', () => {
  it('não inventa ST quando ausente', () => {
    const trib = extrairTributosCompletosItemNfe({
      ICMS: { ICMSSN102: { orig: '0', CSOSN: '102' } },
      PIS: { PISNT: { CST: '07' } },
      COFINS: { COFINSNT: { CST: '07' } }
    });
    assert.equal(trib.existe.st, false);
    assert.equal(trib.existe.fcp, false);
    assert.equal(trib.existe.difal, false);
    assert.equal(trib.csosn, '102');
  });
});
