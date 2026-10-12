'use strict';

/**
 * Motor de Natureza da Entrada NF-e — CFOP por direção, natureza, conflitos, histórico
 * confirmado, coerência item × cabeçalho, integridade fiscal e paridade backend × frontend.
 * Banco: SQLite temporário (DB_DIR) — nunca o banco real.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-motor-natureza-'));
process.env.DB_DIR = dbDir;
delete require.cache[require.resolve('../../backend/database')];

const assert = require('node:assert/strict');
const { test } = require('node:test');

const db = require('../../backend/database');
const {
  classificarEntrada,
  classificarPorCfopItem,
  interpretarCfop,
  mesclarSinais,
  classificarPorNatureza,
  DIRECAO_CFOP,
  FORCA_SINAL,
  EXCECAO_ITEM
} = require('../../backend/services/compras/ClassificadorEntradaCompra');
const { extrairSinaisFiscaisDoXml } = require('../../backend/services/compras/extrairSinaisFiscaisXml');
const {
  enriquecerItemFiscalCompra,
  classificarTratamentoFiscalItem,
  resolverTratamentoFiscalItem
} = require('../../backend/services/compras/TratamentoFiscalItemCompra');
const { TIPO_ENTRADA } = require('../../backend/services/compras/PoliticaEntradaCompra');

const ROOT = path.join(__dirname, '../..');

const CHAVE_REFERENCIADA = '35261011222333000181550010000012341000012345';

function xmlNota({ cfops = ['5101'], natOp = '', finNFe = '1', refNFe = null } = {}) {
  const dets = cfops.map((c, i) => `<det nItem="${i + 1}"><prod><cProd>P${i}</cProd><NCM>19059090</NCM><CFOP>${c}</CFOP></prod></det>`).join('');
  const ref = refNFe ? `<NFref><refNFe>${refNFe}</refNFe></NFref>` : '';
  return `<nfeProc><NFe><infNFe><ide>${natOp ? `<natOp>${natOp}</natOp>` : ''}<finNFe>${finNFe}</finNFe>${ref}</ide>${dets}</infNFe></NFe></nfeProc>`;
}

function dbReady() {
  return new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
}

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
}

async function inserirHistorico(cnpj, tipo, qtd, { confirmada = true, alterado = 0 } = {}) {
  for (let i = 0; i < qtd; i += 1) {
    await runDb(
      `INSERT INTO compras (data_compra, fornecedor, fornecedor_cnpj, total, status, tipo_entrada, tipo_entrada_sugerido, tipo_entrada_alterado)
       VALUES ('2026-10-01', 'Fornecedor Teste', ?, 10, 'concluida', ?, ?, ?)`,
      [cnpj, tipo, confirmada ? 'REVENDA' : null, alterado]
    );
  }
}

function carregarEspelhoFrontend() {
  const context = {};
  context.global = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'frontend/erp/js/tratamento-fiscal-item-compra.js'), 'utf8'),
    context,
    { filename: 'tratamento-fiscal-item-compra.js' }
  );
  return context.TratamentoFiscalItemCompra;
}

// ─── Casos de classificação ────────────────────────────────────────────────

test('1. CFOP 5101 + natOp de venda não vira industrialização pelo sufixo', async () => {
  for (const natOp of ['VENDA DE PRODUCAO DO ESTABELECIMENTO', 'VENDA DE MERCADORIA', 'VENDA']) {
    const r = await classificarEntrada({ xml: xmlNota({ cfops: ['5101'], natOp }) });
    assert.notEqual(r.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO, natOp);
    assert.ok(r.confianca <= 70, `${natOp}: confiança heurística baixa (${r.confianca})`);
    assert.equal(r.requerConfirmacao, true, natOp);
    assert.match(r.motivo, /5101 do emitente/);
    assert.doesNotMatch(r.motivo, /típico de industrialização/);
    assert.equal(r.sinais.cfopDirecao, DIRECAO_CFOP.SAIDA);
  }
  assert.equal(classificarPorCfopItem('5101'), null, '5101 não define finalidade do item');
});

test('2. CFOP 6101 com natureza de venda tem a mesma proteção', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['6101'], natOp: 'VENDA DE PRODUCAO' }) });
  assert.notEqual(r.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.equal(r.requerConfirmacao, true);
  assert.equal(classificarPorCfopItem('6101'), null);
});

test('3. CFOP 5102 não vira industrialização nem revenda "forte" pelo sufixo', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['5102'], natOp: 'VENDA DE MERCADORIA ADQUIRIDA' }) });
  assert.notEqual(r.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.ok(r.confianca < 88, 'sem a confiança de CFOP de entrada 1102');
  assert.equal(interpretarCfop('5102').tipo, null);
});

test('4. CFOP 1101 preserva compra para industrialização', async () => {
  const i = interpretarCfop('1101');
  assert.equal(i.direcao, DIRECAO_CFOP.ENTRADA);
  assert.equal(i.tipo, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.equal(i.excecaoItem, EXCECAO_ITEM.COMPRA);
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['1101'], natOp: 'COMPRA PARA INDUSTRIALIZACAO' }) });
  assert.equal(r.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.ok(r.confianca >= 90);
  assert.equal(r.requerConfirmacao, false);
});

test('5. CFOP 1102 preserva compra para comercialização', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['1102'], natOp: 'COMPRA PARA COMERCIALIZACAO' }) });
  assert.equal(r.tipoEntrada, TIPO_ENTRADA.REVENDA);
  assert.ok(r.confianca >= 88);
  assert.equal(r.requerConfirmacao, false);
});

test('6. CFOP 5910 preserva bonificação (cabeçalho e item)', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['5910'], natOp: 'BONIFICACAO' }) });
  assert.equal(r.tipoEntrada, TIPO_ENTRADA.BONIFICACAO);
  assert.ok(r.confianca >= 94);
  const item = enriquecerItemFiscalCompra({ cfop: '5910' }, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA });
  assert.equal(item.tipo_fiscal_item, TIPO_ENTRADA.BONIFICACAO);
  assert.equal(item.bonificacao, 1);
});

test('7. Remessa específica respeita o contrato existente (devolução: ver testes D1–D6)', async () => {
  const rem = await classificarEntrada({ xml: xmlNota({ cfops: ['5901'], natOp: 'REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA' }) });
  assert.equal(rem.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.equal(rem.forca, FORCA_SINAL.ESPECIFICO);

  assert.equal(classificarPorNatureza('VENDA DE PRODUTOS INDUSTRIALIZADOS'), null, 'adjetivo "industrializados" não é finalidade');
});

test('8. CFOP inválido, ausente ou ambíguo não produz certeza artificial', async () => {
  for (const cfop of ['51', '9101', '0000', '']) {
    const r = await classificarEntrada({ cfop, natureza: '' });
    assert.equal(r.forca, FORCA_SINAL.NEUTRO, `cfop "${cfop}"`);
    assert.ok(r.confianca <= 55, `cfop "${cfop}": ${r.confianca}`);
    assert.equal(r.requerConfirmacao, true);
  }
  assert.equal(interpretarCfop('51').direcao, DIRECAO_CFOP.INDETERMINADA);
});

test('9. Sinais conflitantes reduzem a confiança e explicitam o conflito', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['1101'], natOp: 'COMPRA PARA REVENDA' }) });
  assert.equal(r.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.ok(r.confianca < 90, `confiança reduzida (${r.confianca})`);
  assert.ok(r.conflitos.length >= 1);
  assert.equal(r.requerConfirmacao, true);
  assert.match(r.motivo, /Sinais divergentes/);

  const m = mesclarSinais([
    { tipo: TIPO_ENTRADA.USO_CONSUMO, confianca: 92, forca: FORCA_SINAL.ESPECIFICO, motivo: 'a' },
    { tipo: TIPO_ENTRADA.REVENDA, confianca: 80, forca: FORCA_SINAL.FORTE, motivo: 'b' }
  ]);
  assert.ok(m.confianca <= 80);
  assert.equal(m.requerConfirmacao, true);
});

test('10. Histórico confirmado do fornecedor influencia sem bloquear e sem contrariar evidência específica', async () => {
  await dbReady();
  const CNPJ_REV = '11111111000191';
  const CNPJ_IND = '22222222000191';
  const CNPJ_USO = '33333333000191';
  const CNPJ_LEGADO = '44444444000191';
  await inserirHistorico(CNPJ_REV, 'REVENDA', 3, { alterado: 1 });
  await inserirHistorico(CNPJ_IND, 'INDUSTRIALIZACAO', 3);
  await inserirHistorico(CNPJ_USO, 'USO_CONSUMO', 3);
  await inserirHistorico(CNPJ_LEGADO, 'INDUSTRIALIZACAO', 5, { confirmada: false });

  const rev = await classificarEntrada({ xml: xmlNota({ cfops: ['5101'], natOp: 'VENDA DE PRODUCAO DO ESTABELECIMENTO' }), fornecedor_cnpj: CNPJ_REV });
  assert.equal(rev.tipoEntrada, TIPO_ENTRADA.REVENDA, 'histórico confirmado de revenda prevalece sobre 5101 neutro');
  assert.equal(rev.sinais.historico.qtd, 3);
  assert.match(rev.motivo, /3\/3 entradas confirmadas/);

  const ind = await classificarEntrada({ xml: xmlNota({ cfops: ['5101'], natOp: 'VENDA DE MERCADORIA' }), fornecedor_cnpj: CNPJ_IND });
  assert.equal(ind.tipoEntrada, TIPO_ENTRADA.INDUSTRIALIZACAO, 'industrialização legítima aprendida pelo histórico');
  assert.equal(ind.requerConfirmacao, true, 'sinal fraco divergente exige confirmação');
  assert.ok(ind.conflitos.length >= 1);

  const bon = await classificarEntrada({ xml: xmlNota({ cfops: ['5910'] }), fornecedor_cnpj: CNPJ_REV });
  assert.equal(bon.tipoEntrada, TIPO_ENTRADA.BONIFICACAO, 'histórico não substitui bonificação explícita');

  const forte = await classificarEntrada({ xml: xmlNota({ cfops: ['1102'] }), fornecedor_cnpj: CNPJ_USO });
  assert.equal(forte.tipoEntrada, TIPO_ENTRADA.REVENDA, 'histórico não substitui CFOP de entrada explícito');
  assert.equal(forte.requerConfirmacao, true);
  assert.ok(forte.confianca < 88);

  const legado = await classificarEntrada({ xml: xmlNota({ cfops: ['5101'] }), fornecedor_cnpj: CNPJ_LEGADO });
  assert.equal(legado.sinais.historico, null, 'compras sem confirmação da sugestão não formam histórico');
});

// ─── Devolução recebida ────────────────────────────────────────────────────

test('D1. finNFe = 4 gera sinal explícito de devolução', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['5202'], natOp: 'DEVOLUCAO DE MERCADORIA', finNFe: '4' }) });
  assert.equal(r.naturezaDetectada, 'DEVOLUCAO');
  assert.equal(r.sinais.finalidade, '4');
  assert.ok(r.razoes.some((t) => /finNFe = 4/.test(t)), 'finalidade registrada como razão');
  assert.equal(r.requerConfirmacao, true, 'devolução sempre exige escolha do operador');
});

test('D2. Devolução não é confundida com compra para revenda', async () => {
  for (const xml of [
    xmlNota({ cfops: ['5202'], natOp: 'DEVOLUCAO DE MERCADORIA', finNFe: '4' }),
    xmlNota({ cfops: ['1202'], natOp: 'DEVOLUCAO DE VENDA', finNFe: '4' }),
    xmlNota({ cfops: ['1411'], natOp: 'DEVOLUCAO DE VENDA ST', finNFe: '4' })
  ]) {
    const r = await classificarEntrada({ xml });
    assert.equal(r.tipoEntrada, null, 'sem sugestão operacional (não reutiliza Revenda)');
    assert.notEqual(r.label, 'Compra para Revenda');
  }
  assert.equal(interpretarCfop('1411').categoria, 'DEVOLUCAO', '1411 é devolução de venda com ST, não compra');
  assert.equal(classificarPorCfopItem('1202'), null, 'CFOP de devolução não define o tipo do item');
});

test('D3. Sinais coerentes de devolução reforçam a identificação', async () => {
  const so = await classificarEntrada({ xml: xmlNota({ cfops: ['5949'], finNFe: '4' }) });
  const coerente = await classificarEntrada({ xml: xmlNota({ cfops: ['5202'], natOp: 'DEVOLUCAO DE MERCADORIA', finNFe: '4', refNFe: CHAVE_REFERENCIADA }) });
  assert.equal(coerente.naturezaDetectada, 'DEVOLUCAO');
  assert.equal(coerente.conflitos.length, 0);
  assert.ok(coerente.confianca > 90, `finalidade + natureza + CFOP + referência (${coerente.confianca})`);
  assert.ok(coerente.confianca > so.confianca);
  assert.deepEqual(coerente.sinais.referencias, { nfe: 1, outras: 0 });
  assert.doesNotMatch(JSON.stringify(coerente), new RegExp(CHAVE_REFERENCIADA), 'a chave referenciada não é exposta');
});

test('D4. Sinais contraditórios ficam explícitos e exigem confirmação', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['5102'], natOp: 'VENDA DE MERCADORIA', finNFe: '4' }) });
  assert.equal(r.naturezaDetectada, 'DEVOLUCAO');
  assert.equal(r.tipoEntrada, null, 'não classifica silenciosamente como revenda');
  assert.ok(r.conflitos.length >= 1);
  assert.match(r.motivo, /Sinais divergentes/);
  assert.equal(r.requerConfirmacao, true);
  assert.ok(r.confianca < 65, `confiança reduzida (${r.confianca})`);

  const compraDeclarada = await classificarEntrada({ xml: xmlNota({ cfops: ['1102'], natOp: 'DEVOLUCAO', finNFe: '1' }) });
  assert.equal(compraDeclarada.naturezaDetectada, 'DEVOLUCAO');
  assert.ok(compraDeclarada.conflitos.some((c) => /1102/.test(c)), 'CFOP de compra registrado como divergente');
});

test('D5. Ausência de referência não é inventada e não conclui sozinha', async () => {
  const r = await classificarEntrada({ xml: xmlNota({ cfops: ['5202'], natOp: 'DEVOLUCAO DE MERCADORIA', finNFe: '4' }) });
  assert.deepEqual(r.sinais.referencias, { nfe: 0, outras: 0 });
  assert.ok(r.razoes.some((t) => /não referencia o documento fiscal original/.test(t)));
  assert.doesNotMatch(r.motivo, /cliente/i, 'não presume devolução de cliente');

  const soReferencia = await classificarEntrada({ xml: xmlNota({ cfops: ['5102'], natOp: 'VENDA DE MERCADORIA', refNFe: CHAVE_REFERENCIADA }) });
  assert.equal(soReferencia.naturezaDetectada, null, 'referência a outro documento não basta para concluir devolução');

  const extraido = extrairSinaisFiscaisDoXml(xmlNota({ cfops: ['5202'], finNFe: '4' }));
  assert.deepEqual(extraido.referencias, { chavesNFe: [], outras: 0 });
});

test('D6. Compra comum não é classificada como devolução sem evidência', async () => {
  for (const [cfops, natOp] of [[['5102'], 'VENDA DE MERCADORIA'], [['5101'], 'VENDA DE PRODUCAO'], [['1102'], 'COMPRA PARA COMERCIALIZACAO']]) {
    const r = await classificarEntrada({ xml: xmlNota({ cfops, natOp, finNFe: '1' }) });
    assert.equal(r.naturezaDetectada, null, `${cfops[0]} ${natOp}`);
    assert.ok(r.tipoEntrada, 'compra mantém sugestão operacional');
  }
});

// ─── Precedência cabeçalho × item ──────────────────────────────────────────

test('P7. Cabeçalho confirmado não é sobrescrito apenas por CFOP de compra no item', () => {
  for (const [cfop, tipoCfop] of [['1101', TIPO_ENTRADA.INDUSTRIALIZACAO], ['1102', TIPO_ENTRADA.REVENDA], ['2101', TIPO_ENTRADA.INDUSTRIALIZACAO]]) {
    for (const cabecalho of [TIPO_ENTRADA.REVENDA, TIPO_ENTRADA.INDUSTRIALIZACAO, TIPO_ENTRADA.USO_CONSUMO]) {
      const c = classificarTratamentoFiscalItem({ cfop }, cabecalho);
      assert.equal(c.tipoFiscal, cabecalho, `${cfop} com cabeçalho ${cabecalho}`);
      assert.equal(c.origem, 'compra');
      assert.equal(c.conflitoCabecalho, tipoCfop !== cabecalho, `${cfop}/${cabecalho}: conflito explícito`);
      if (c.conflitoCabecalho) assert.match(c.motivo, /Mantida a natureza confirmada/);
    }
  }
  assert.equal(classificarTratamentoFiscalItem({ cfop: '1101' }).tipoFiscal, TIPO_ENTRADA.INDUSTRIALIZACAO, 'sem cabeçalho o CFOP de entrada decide');
});

test('P8. Exceções de bonificação e uso/consumo continuam funcionando', () => {
  const bonif = classificarTratamentoFiscalItem({ cfop: '5910' }, TIPO_ENTRADA.REVENDA);
  assert.equal(bonif.tipoFiscal, TIPO_ENTRADA.BONIFICACAO);
  assert.equal(bonif.conflitoCabecalho, true);
  assert.equal(classificarTratamentoFiscalItem({ cfop: '1949' }, TIPO_ENTRADA.INDUSTRIALIZACAO).tipoFiscal, TIPO_ENTRADA.BONIFICACAO);
  assert.equal(classificarTratamentoFiscalItem({ cfop: '1556' }, TIPO_ENTRADA.REVENDA).tipoFiscal, TIPO_ENTRADA.USO_CONSUMO);
  assert.equal(classificarTratamentoFiscalItem({ cfop: '5557' }, TIPO_ENTRADA.REVENDA).tipoFiscal, TIPO_ENTRADA.USO_CONSUMO);
  const mista = classificarTratamentoFiscalItem({ cfop: '1102' }, TIPO_ENTRADA.BONIFICACAO);
  assert.equal(mista.tipoFiscal, TIPO_ENTRADA.REVENDA, 'nota mista RC4.31.11: item de compra em entrada de bonificação');
  assert.equal(classificarTratamentoFiscalItem({ cfop: '5102', bonificacao: 1 }, TIPO_ENTRADA.REVENDA).tipoFiscal, TIPO_ENTRADA.BONIFICACAO);
  assert.equal(resolverTratamentoFiscalItem({ cfop: '1556' }).gerarEstoque, false);
});

// ─── Integridade fiscal ────────────────────────────────────────────────────

const ITEM_FISCAL_ORIGINAL = Object.freeze({
  cfop: '5101',
  ncm: '19059090',
  cst: '00',
  csosn: '102',
  cst_pis: '01',
  cst_cofins: '01',
  unidade: 'CX',
  unidade_comercial: 'CX',
  unidade_tributavel: 'UN',
  quantidade_comercial: 10,
  quantidade_tributavel: 120,
  valor_unitario_comercial: 120,
  valor_unitario_tributavel: 10,
  subtotal: 1200,
  base_calculo_icms: 1200,
  aliquota_icms: 18,
  valor_icms: 216
});

test('11/12. Classificação não altera CFOP, CST/CSOSN, NCM, valores, bases, alíquotas, unidades ou quantidades', async () => {
  const original = structuredClone(ITEM_FISCAL_ORIGINAL);
  for (const tipo of Object.values(TIPO_ENTRADA)) {
    const entrada = structuredClone(ITEM_FISCAL_ORIGINAL);
    const enriquecido = enriquecerItemFiscalCompra(entrada, { tipoEntradaCompra: tipo });
    assert.deepEqual(entrada, original, `${tipo}: item de entrada não mutado`);
    for (const [campo, valor] of Object.entries(original)) {
      assert.deepEqual(enriquecido[campo], valor, `${tipo}: ${campo} preservado`);
    }
  }

  const dados = { itens: [structuredClone(ITEM_FISCAL_ORIGINAL)], natureza_operacao: 'VENDA DE PRODUCAO' };
  const xml = xmlNota({ cfops: ['5101'], natOp: 'VENDA DE PRODUCAO' });
  const snapshot = structuredClone(dados);
  await classificarEntrada({ xml, dadosCompra: dados });
  assert.deepEqual(dados, snapshot, 'classificarEntrada não altera os dados da compra');
});

test('14. Item segue a natureza confirmada no cabeçalho, salvo exceção explícita', () => {
  const rev = enriquecerItemFiscalCompra({ cfop: '5101' }, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA });
  assert.equal(rev.tipo_fiscal_item, TIPO_ENTRADA.REVENDA);
  const ind = enriquecerItemFiscalCompra({ cfop: '5101' }, { tipoEntradaCompra: TIPO_ENTRADA.INDUSTRIALIZACAO });
  assert.equal(ind.tipo_fiscal_item, TIPO_ENTRADA.INDUSTRIALIZACAO);
  assert.equal(classificarTratamentoFiscalItem({ cfop: '6101' }, TIPO_ENTRADA.REVENDA).origem, 'compra');

  const bonif = enriquecerItemFiscalCompra({ cfop: '5910' }, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA });
  assert.equal(bonif.tipo_fiscal_item, TIPO_ENTRADA.BONIFICACAO, 'bonificação por item é exceção explícita');
  const usoEntrada = enriquecerItemFiscalCompra({ cfop: '1556' }, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA });
  assert.equal(usoEntrada.tipo_fiscal_item, TIPO_ENTRADA.USO_CONSUMO, 'uso/consumo é exceção específica');
  const compraIndustrializacao = enriquecerItemFiscalCompra({ cfop: '1101' }, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA });
  assert.equal(compraIndustrializacao.tipo_fiscal_item, TIPO_ENTRADA.REVENDA, 'CFOP 1101 sozinho não sobrescreve o cabeçalho');
  assert.equal(compraIndustrializacao.cfop, '1101', 'CFOP original preservado');

  const devolucaoEmitente = enriquecerItemFiscalCompra({ cfop: '5556' }, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA });
  assert.equal(devolucaoEmitente.tipo_fiscal_item, TIPO_ENTRADA.REVENDA, '5556 do emitente não vira uso/consumo no item');

  const manual = classificarTratamentoFiscalItem({ cfop: '5101', tipo_fiscal_item: TIPO_ENTRADA.USO_CONSUMO }, TIPO_ENTRADA.REVENDA);
  assert.equal(manual.tipoFiscal, TIPO_ENTRADA.USO_CONSUMO);
  assert.equal(manual.origem, 'manual');

  const trat = resolverTratamentoFiscalItem(rev);
  assert.equal(trat.gerarEstoque, true);
  assert.equal(trat.atualizarCusto, true);
});

// ─── Paridade backend × frontend ───────────────────────────────────────────

test('16. Regras de CFOP idênticas entre backend e frontend', () => {
  const front = carregarEspelhoFrontend();
  assert.ok(front, 'espelho do frontend carregado');
  const cfops = [
    '5101', '6101', '7101', '5102', '6102', '1101', '2101', '3101', '1102', '2102', '3102',
    '5910', '6910', '1910', '5949', '1949', '5401', '5403', '5405', '1403', '5551', '5552',
    '5553', '5556', '5557', '1556', '1551', '5901', '5202', '6202', '1201', '5124', '1124',
    '5151', '5152', '5411', '1411', '1410', '1202', '1203', '2202', '5201', '5205', '5210', '5413',
    '0000', '9101', '12', ''
  ];
  for (const cfop of cfops) {
    const b = classificarPorCfopItem(cfop);
    const f = front.classificarPorCfopItem(cfop);
    assert.deepEqual(
      f ? { tipo: f.tipo, excecaoItem: f.excecaoItem } : null,
      b ? { tipo: b.tipo, excecaoItem: b.excecaoItem } : null,
      `CFOP "${cfop}"`
    );
    for (const tipoCompra of [...Object.values(TIPO_ENTRADA), null]) {
      const fr = front.classificarTratamentoFiscalItem({ cfop }, tipoCompra);
      const bk = classificarTratamentoFiscalItem({ cfop }, tipoCompra);
      assert.deepEqual(
        { tipo: fr.tipoFiscal, conflito: fr.conflitoCabecalho },
        { tipo: bk.tipoFiscal, conflito: bk.conflitoCabecalho },
        `CFOP "${cfop}" com compra ${tipoCompra}`
      );
    }
  }
});

test('Escrituração: sugerirCfopEscrituracao permanece inalterada nesta sprint', () => {
  const { sugerirCfopEscrituracao } = require('../../backend/services/compras/EscrituracaoEntradaCompra');
  assert.deepEqual(sugerirCfopEscrituracao('REVENDA', '5101'), { utilizado: '5101', alterado: false, motivo: null });
  assert.equal(sugerirCfopEscrituracao('INDUSTRIALIZACAO', '5101').utilizado, '1101');
});
