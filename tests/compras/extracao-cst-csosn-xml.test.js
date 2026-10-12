'use strict';

/**
 * Extração de CST (regime normal) e CSOSN (Simples Nacional) do grupo ICMS do XML da NF-e,
 * e propagação até compras.csosn_cst_xml pelo fluxo Central → tela de Compras → SQLite temporário.
 * XML sintético; nenhuma NF-e real, banco de produção ou SEFAZ.
 */

const {
  getDb,
  runDb,
  criarCentral,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const request = require('supertest');
const { test } = require('node:test');
const {
  extrairCsosnOuCst,
  extrairCsosnOuCstItens,
  extrairDadosFiscaisXml
} = require('../../backend/services/compras/extrairSinaisFiscaisXml');
const { montarResumoFiscalEntrada } = require('../../backend/services/compras/EscrituracaoEntradaCompra');

const PIS_COFINS = '<PIS><PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>1.65</pPIS><vPIS>1.65</vPIS></PISAliq></PIS>'
  + '<COFINS><COFINSAliq><CST>01</CST><vBC>100.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>7.60</vCOFINS></COFINSAliq></COFINS>';

function det(n, icms, cfop = '5102') {
  return `<det nItem="${n}"><prod><cProd>P${n}</cProd><NCM>19053100</NCM><CFOP>${cfop}</CFOP></prod>`
    + `<imposto>${icms === null ? '' : `<ICMS>${icms}</ICMS>`}${PIS_COFINS}</imposto></det>`;
}

function nota(...dets) {
  return `<nfeProc><NFe><infNFe><ide><natOp>VENDA</natOp></ide>${dets.join('')}`
    + '<total><ICMSTot><vBC>100.00</vBC><vICMS>18.00</vICMS></ICMSTot></total></infNFe></NFe></nfeProc>';
}

const GRUPOS_CST = {
  ICMS00: ['00', '<orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS>'],
  ICMS10: ['10', '<orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS><modBCST>4</modBCST><vBCST>140.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>7.20</vICMSST>'],
  ICMS20: ['20', '<orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>33.33</pRedBC><vBC>66.67</vBC><pICMS>18.00</pICMS><vICMS>12.00</vICMS>'],
  ICMS30: ['30', '<orig>0</orig><CST>30</CST><modBCST>4</modBCST><vBCST>140.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>25.20</vICMSST>'],
  ICMS40: ['41', '<orig>0</orig><CST>41</CST>'],
  ICMS51: ['51', '<orig>0</orig><CST>51</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMSOp>18.00</vICMSOp><pDif>100.00</pDif><vICMSDif>18.00</vICMSDif><vICMS>0.00</vICMS>'],
  ICMS60: ['60', '<orig>0</orig><CST>60</CST><vBCSTRet>0.00</vBCSTRet><vICMSSTRet>0.00</vICMSSTRet>'],
  ICMS70: ['70', '<orig>0</orig><CST>70</CST><modBC>3</modBC><pRedBC>10.00</pRedBC><vBC>90.00</vBC><pICMS>18.00</pICMS><vICMS>16.20</vICMS>'],
  ICMS90: ['90', '<orig>0</orig><CST>90</CST>'],
  ICMSPart: ['10', '<orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS><pBCOp>100.00</pBCOp><UFST>SP</UFST>'],
  ICMSST: ['41', '<orig>0</orig><CST>41</CST><vBCSTRet>0.00</vBCSTRet><vICMSSTRet>0.00</vICMSSTRet><vBCSTDest>0.00</vBCSTDest><vICMSSTDest>0.00</vICMSSTDest>']
};

const GRUPOS_CSOSN = {
  ICMSSN101: ['101', '<orig>0</orig><CSOSN>101</CSOSN><pCredSN>2.00</pCredSN><vCredICMSSN>2.00</vCredICMSSN>'],
  ICMSSN102: ['102', '<orig>0</orig><CSOSN>102</CSOSN>'],
  ICMSSN201: ['201', '<orig>0</orig><CSOSN>201</CSOSN><modBCST>4</modBCST><vBCST>140.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>7.20</vICMSST>'],
  ICMSSN202: ['203', '<orig>0</orig><CSOSN>203</CSOSN><modBCST>4</modBCST><vBCST>140.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>7.20</vICMSST>'],
  ICMSSN500: ['500', '<orig>0</orig><CSOSN>500</CSOSN><vBCSTRet>0.00</vBCSTRet><vICMSSTRet>0.00</vICMSSTRet>'],
  ICMSSN900: ['900', '<orig>0</orig><CSOSN>900</CSOSN>']
};

function grupo(nome, corpo) {
  return `<${nome}>${corpo}</${nome}>`;
}

// ─── Regime normal ─────────────────────────────────────────────────────────

test('1. ICMS00 com CST 00: extrai "00", não o nome do grupo', () => {
  const xml = nota(det(1, grupo('ICMS00', GRUPOS_CST.ICMS00[1])));
  assert.deepEqual(extrairCsosnOuCst(xml), { tipo: 'CST', valor: '00' });
  const d = extrairDadosFiscaisXml(xml);
  assert.equal(d.cstIcms, '00');
  assert.equal(d.csosnOuCst, '00');
  assert.equal(d.csosnOuCstTipo, 'CST');
  assert.equal(d.csosn, '');
});

test('2. CST com zero à esquerda preserva o formato textual', () => {
  for (const nome of ['ICMS00']) {
    const r = extrairCsosnOuCst(nota(det(1, grupo(nome, GRUPOS_CST[nome][1]))));
    assert.equal(typeof r.valor, 'string');
    assert.equal(r.valor, '00');
    assert.equal(r.valor.length, 2);
  }
  const comEspacos = nota(det(1, grupo('ICMS00', '<orig>0</orig><CST> 00 </CST>')));
  assert.equal(extrairCsosnOuCst(comEspacos).valor, '00');
});

test('3. Demais grupos com CST extraem o campo correto (não o PIS/COFINS nem a tag)', () => {
  for (const [nome, [esperado, corpo]] of Object.entries(GRUPOS_CST)) {
    const r = extrairCsosnOuCst(nota(det(1, grupo(nome, corpo))));
    assert.deepEqual(r, { tipo: 'CST', valor: esperado }, nome);
  }
});

test('4. Grupo ICMS ausente ou sem CST não inventa código', () => {
  const casos = {
    'sem <ICMS>': nota(det(1, null)),
    'grupo sem CST': nota(det(1, grupo('ICMS00', '<orig>0</orig><modBC>3</modBC><vBC>100.00</vBC>'))),
    'CST inválido': nota(det(1, grupo('ICMS00', '<orig>0</orig><CST>0</CST>'))),
    'grupo ambíguo (CST e CSOSN)': nota(det(1, grupo('ICMS00', '<orig>0</orig><CST>00</CST><CSOSN>102</CSOSN>')))
  };
  for (const [nome, xml] of Object.entries(casos)) {
    assert.deepEqual(extrairCsosnOuCst(xml), { tipo: null, valor: '' }, nome);
    const resumo = montarResumoFiscalEntrada({ xml, tipo_entrada: 'REVENDA', dadosCompra: {} });
    assert.equal(resumo.original.csosn_cst, null, `${nome}: resumo sem código artificial`);
    assert.equal(resumo.original.cst_pis, '01', `${nome}: CST do PIS não é usado como CST do ICMS`);
  }
});

test('5. Vários itens: cada item com o próprio código, sem misturar valores', () => {
  const xml = nota(
    det(1, grupo('ICMS00', GRUPOS_CST.ICMS00[1])),
    det(2, grupo('ICMS60', GRUPOS_CST.ICMS60[1]), '5405'),
    det(3, null),
    det(4, grupo('ICMS20', GRUPOS_CST.ICMS20[1]))
  );
  assert.deepEqual(extrairCsosnOuCstItens(xml), [
    { nItem: '1', grupo: 'ICMS00', tipo: 'CST', valor: '00' },
    { nItem: '2', grupo: 'ICMS60', tipo: 'CST', valor: '60' },
    { nItem: '3', grupo: null, tipo: null, valor: '' },
    { nItem: '4', grupo: 'ICMS20', tipo: 'CST', valor: '20' }
  ]);
  assert.equal(extrairCsosnOuCst(xml).valor, '00', 'documento: primeiro item (contrato atual)');

  const primeiroSemCodigo = nota(det(1, null), det(2, grupo('ICMS40', GRUPOS_CST.ICMS40[1])));
  assert.equal(extrairCsosnOuCst(primeiroSemCodigo).valor, '41', 'primeiro item que informa o código');
});

// ─── Simples Nacional ──────────────────────────────────────────────────────

test('6. ICMSSN102 com CSOSN 102: extrai "102"', () => {
  const xml = nota(det(1, grupo('ICMSSN102', GRUPOS_CSOSN.ICMSSN102[1])));
  assert.deepEqual(extrairCsosnOuCst(xml), { tipo: 'CSOSN', valor: '102' });
  const d = extrairDadosFiscaisXml(xml);
  assert.equal(d.csosn, '102');
  assert.equal(d.cstIcms, '');
});

test('7. Demais grupos do Simples extraem o CSOSN correto', () => {
  for (const [nome, [esperado, corpo]] of Object.entries(GRUPOS_CSOSN)) {
    assert.deepEqual(extrairCsosnOuCst(nota(det(1, grupo(nome, corpo)))), { tipo: 'CSOSN', valor: esperado }, nome);
  }
  const misto = nota(det(1, grupo('ICMSSN102', GRUPOS_CSOSN.ICMSSN102[1])), det(2, grupo('ICMSSN500', GRUPOS_CSOSN.ICMSSN500[1])));
  assert.deepEqual(extrairCsosnOuCstItens(misto).map((i) => i.valor), ['102', '500']);
});

test('8. Grupo do Simples sem CSOSN não inventa valor', () => {
  const xml = nota(det(1, grupo('ICMSSN102', '<orig>0</orig>')));
  assert.deepEqual(extrairCsosnOuCst(xml), { tipo: null, valor: '' });
  assert.equal(extrairDadosFiscaisXml(xml).csosn, '');
});

test('Extração não altera o XML nem os demais campos fiscais extraídos', () => {
  const xml = nota(det(1, grupo('ICMS00', GRUPOS_CST.ICMS00[1])));
  const copia = String(xml);
  const d = extrairDadosFiscaisXml(xml);
  assert.equal(xml, copia);
  assert.equal(d.cfopPredominante, '5102');
  assert.equal(d.cstPis, '01');
  assert.equal(d.cstCofins, '01');
  assert.equal(d.natureza, 'VENDA');
});

// ─── Integração: Central → tela de Compras → SQLite temporário ─────────────

function caso(id, impostoXml) {
  return {
    id,
    nf: id,
    codigo: `CST-${id}`,
    gtin: `78912345${String(id).padStart(5, '0')}`,
    nome: `BISCOITO CST ${id}`,
    ncm: '19053100',
    cfop: '5102',
    natOp: 'VENDA DE MERCADORIA',
    uCom: 'UN', qCom: 20, vUnCom: 5,
    uTrib: 'UN', qTrib: 20, vUnTrib: 5,
    impostoXml
  };
}

async function cadastrarProduto(c) {
  await runDb('DELETE FROM produtos WHERE id = ?', [c.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', 'UN', 1, 4.8, 6, 5, 0, 0, 5, 0, ?, 1, ?, 'Fornecedor Sprint 2', 1)`,
    [c.id, c.nome, c.codigo, c.gtin]
  );
}

test('9/10/11. CST e CSOSN propagados até compras.csosn_cst_xml, persistidos, reabertos; XML intacto', async (t) => {
  const { app, central } = await criarCentral();

  const cenarios = [
    { id: 9501, imposto: `<imposto><ICMS>${grupo('ICMS00', GRUPOS_CST.ICMS00[1])}</ICMS>${PIS_COFINS}</imposto>`, esperado: '00' },
    { id: 9502, imposto: `<imposto><ICMS>${grupo('ICMSSN102', GRUPOS_CSOSN.ICMSSN102[1])}</ICMS>${PIS_COFINS}</imposto>`, esperado: '102' },
    { id: 9503, imposto: `<imposto>${PIS_COFINS}</imposto>`, esperado: null }
  ];

  for (const cen of cenarios) {
    await t.test(`XML ${cen.id}: csosn_cst_xml = ${cen.esperado}`, async () => {
      const c = caso(cen.id, cen.imposto);
      await cadastrarProduto(c);
      const recebimento = await receberPelaCentral(central, c);
      const { pagina, gravacao } = await lancarCompraPelaTela(app, recebimento, { tipoEntrada: 'REVENDA' });

      const resumo = pagina.requisicoes.find((r) => r.url === '/api/compras/resumo-fiscal-entrada');
      assert.ok(resumo, 'tela solicita o resumo fiscal');
      assert.equal(resumo.resposta.body.original.csosn_cst, cen.esperado, 'resumo fiscal: original');
      assert.equal(gravacao.corpo.csosn_cst_xml, cen.esperado, 'payload da tela');

      assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
      const compraId = Number(gravacao.resposta.body.id);
      const compra = await getDb('SELECT * FROM compras WHERE id = ?', [compraId]);
      assert.equal(compra.csosn_cst_xml, cen.esperado, 'compras.csosn_cst_xml');
      assert.equal(compra.csosn_cst, cen.esperado, 'utilizado = original sem override do operador');
      assert.equal(compra.cst_pis_xml, '01', 'CST PIS inalterado');
      assert.equal(compra.cfop_xml, '5102', 'CFOP inalterado');

      const reaberta = await request(app).get(`/api/compras/${compraId}`).set('Authorization', 'Bearer token-teste');
      assert.equal(reaberta.status, 200);
      assert.equal(reaberta.body.csosn_cst_xml, cen.esperado, 'reabertura');

      const doc = await getDb('SELECT xml FROM central_entradas_documentos WHERE id = ?', [recebimento.documentoId]);
      assert.equal(doc.xml, recebimento.xml, 'XML original da Central intacto');
    });
  }
});
