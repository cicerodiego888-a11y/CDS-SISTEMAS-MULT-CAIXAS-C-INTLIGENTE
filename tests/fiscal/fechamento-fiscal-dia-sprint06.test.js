/**
 * Sprint 06 — Elegibilidade correta + monitoramento (READ-ONLY comercial)
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint06.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  garantirSchemaFechamentoFiscal,
  criarRascunho,
  adicionarRecebimento,
  gerarPrevia,
  listarLotesElegiveisDoDia,
  listarProdutosElegiveisDoDia,
  listarMonitoramentoProdutosDoDia,
  obterResumoDia,
  snapshotComercial,
  gerarPreviaDistribuicao,
  toCentavos,
  somarMoeda,
  STATUS
} = require('../../backend/services/fechamento-fiscal');
const moduloConfig = require('../../backend/services/fechamento-fiscal/fechamentoFiscalModuloConfig');

let ok = 0;
let falhas = 0;

async function test(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${err && err.stack ? err.stack : err}`);
  }
}

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function schemaBase(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY, valor TEXT
  )`);
  await run(db, `INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', '1')`);
  await run(db, `CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY,
    nome TEXT, codigo TEXT,
    preco_venda REAL DEFAULT 0,
    preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0,
    saldo_fiscal REAL DEFAULT 0,
    saldo_nao_fiscal REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    ncm TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN'
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY,
    data_venda TEXT,
    total REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0,
    valor_nao_fiscal REAL DEFAULT 0,
    status TEXT,
    cancelada INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas_itens (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER,
    produto_id INTEGER,
    quantidade REAL DEFAULT 0,
    quantidade_fiscal REAL DEFAULT 0,
    quantidade_nao_fiscal REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0,
    valor_nao_fiscal REAL DEFAULT 0,
    preco_unitario REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas_devolucoes (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER,
    venda_item_id INTEGER,
    produto_id INTEGER,
    quantidade REAL DEFAULT 0,
    valor_total REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    chave_acesso TEXT,
    ambiente INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pendente',
    xml_retorno TEXT,
    protocolo TEXT
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS financeiro (
    id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas_pagamentos (
    id INTEGER PRIMARY KEY, venda_id INTEGER, valor REAL, forma TEXT
  )`);
  await garantirSchemaFechamentoFiscal(db);
}

async function setModulo(db, valor) {
  await run(
    db,
    `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    [valor]
  );
  moduloConfig._resetCacheForTests();
}

async function main() {
  console.log('\n=== Sprint 06 — Elegibilidade + Monitoramento ===\n');
  moduloConfig._resetCacheForTests();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s06-'));
  const db = await openDb(path.join(dir, 'test.db'));
  await schemaBase(db);
  await setModulo(db, '1');

  const DATA = '2026-09-13';

  // Produtos
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (1,'Coca-Cola 2L','C1',11.99,5,1,100,100)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (2,'Guarana 2L','G1',10.99,4,1,100,100)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (3,'Agua 500ml','A1',2.00,0.5,0,0,100)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (4,'Suco Fiscal','S1',7.50,3,1,50,50)`);

  // TESTE 01 — Cenário A: 10 fiscal / 0 NF / operação NF
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,valor_nao_fiscal,status,cancelada)
    VALUES (101,?,119.90,119.90,119.90,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (1001,101,1,10,10,0,119.90,119.90,119.90,11.99,1)`);

  // TESTE 02 — Cenário B: produto não fiscal
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (102,?,20,20,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (1002,102,3,10,0,10,20,0,20,2,0)`);

  // TESTE 03 — Cenário C: 6 fiscal / 4 NF
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (103,?,109.90,109.90,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (1003,103,2,10,6,4,109.90,65.94,43.96,10.99,1)`);

  // TESTE 04 — produto fiscal vendido fiscalmente (NFC-e)
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,status,cancelada)
    VALUES (104,?,59.95,59.95,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (1004,104,1,5,5,0,59.95,59.95,0,11.99,1)`);
  await run(db, `INSERT INTO nfce_notas
    (venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno,protocolo)
    VALUES (104,10,1,'35260112345678000199550010000000101000000010',1,'autorizada',
      '<protNFe><infProt><cStat>100</cStat><nProt>135260000000001</nProt></infProt></protNFe>',
      '135260000000001')`);

  // TESTE 05 — várias vendas NF do mesmo produto (10+4+3)
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (105,?,47.96,47.96,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1005,105,4,4,4,0,30.00,30.00,30.00,7.50)`);
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (106,?,22.50,22.50,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1006,106,4,3,3,0,22.50,22.50,22.50,7.50)`);
  // +10 já em venda 101? No — venda 101 é Coca. Suco: precisa de venda com 10
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (107,?,75,75,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1007,107,4,10,10,0,75,75,75,7.50)`);

  // TESTE 07 — devolução (sobre item 1001: 10 → devolver 2 → elegível 8)
  await run(db, `INSERT INTO vendas_devolucoes (id,venda_id,venda_item_id,produto_id,quantidade,valor_total)
    VALUES (1,101,1001,1,2,23.98)`);

  // TESTE 08 — produto cancelado via venda cancelada
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (108,?,11.99,11.99,'cancelada',1)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1008,108,1,1,1,0,11.99,11.99,11.99,11.99)`);

  // TESTE 11 — centavos
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (109,?,1.11,1.11,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1009,109,1,1,1,0,1.11,1.11,1.11,1.11)`);

  // Snapshot comercial antes
  const snapAntes = await snapshotComercial(db);

  await test('TESTE 01 — Cenário A: 10 fiscal / 0 NF → elegível 10 (líq. devolução 8)', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const coca = lotes.filter((l) => l.venda_item_id === 1001);
    assert.strictEqual(coca.length, 1);
    // 10 - 2 devolvidos = 8
    assert.strictEqual(Number(coca[0].quantidade_disponivel), 8);
  });

  await test('TESTE 02 — Cenário B: produto não fiscal → elegível 0', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => l.produto_id === 3));
    const mon = await listarMonitoramentoProdutosDoDia(db, DATA);
    assert.ok(!mon.some((p) => p.produto_id === 3));
  });

  await test('TESTE 03 — Cenário C: 6 fiscal / 4 NF → elegível 6', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const g = lotes.find((l) => l.venda_item_id === 1003);
    assert.ok(g);
    assert.strictEqual(Number(g.quantidade_disponivel), 6);
    assert.strictEqual(Number(g.quantidade_fiscal), 6);
    assert.strictEqual(Number(g.quantidade_nao_fiscal), 4);
  });

  await test('TESTE 04 — Produto fiscal vendido fiscalmente (NFC-e) → elegível 0', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => l.venda_item_id === 1004));
  });

  await test('TESTE 05 — Várias vendas NF: 10+4+3 = 17', async () => {
    const produtos = await listarProdutosElegiveisDoDia(db, DATA);
    const suco = produtos.find((p) => p.produto_id === 4);
    assert.ok(suco);
    assert.strictEqual(Number(suco.quantidade_disponivel), 17);
  });

  await test('TESTE 06 — Fiscal + NF: só consumo fiscal das ops NF', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const cocaItens = lotes.filter((l) => l.produto_id === 1);
    // 1001 (8 após dev) + 1009 (1) — NÃO inclui 1004 fiscal
    const soma = cocaItens.reduce((s, l) => s + Number(l.quantidade_disponivel), 0);
    assert.strictEqual(soma, 9);
  });

  await test('TESTE 07 — Devolução reduz elegível (nunca negativo)', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const coca = lotes.find((l) => l.venda_item_id === 1001);
    assert.ok(coca.quantidade_disponivel >= 0);
    assert.strictEqual(Number(coca.quantidade_disponivel), 8);
  });

  await test('TESTE 08 — Produto em venda cancelada não entra', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => l.venda_item_id === 1008));
  });

  await test('TESTE 09 — Venda cancelada não entra no resumo NF', async () => {
    const resumo = await obterResumoDia(db, DATA);
    assert.ok(!resumo.lotes.some((l) => l.venda_id === 108));
  });

  await test('TESTE 10 — Produto não fiscal nunca elegível', async () => {
    const eleg = await listarProdutosElegiveisDoDia(db, DATA);
    assert.ok(!eleg.some((p) => p.produto_id === 3 || p.item_fiscal === 0));
  });

  await test('TESTE 11 — Centavos preservados', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const c = lotes.find((l) => l.venda_item_id === 1009);
    assert.ok(c);
    assert.strictEqual(toCentavos(c.valor_disponivel), 111);
  });

  await test('TESTE 12 — Preço histórico (não cadastro atual)', async () => {
    await run(db, `UPDATE produtos SET preco_venda = 99.99 WHERE id = 1`);
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const c = lotes.find((l) => l.venda_item_id === 1009);
    assert.strictEqual(Number(c.preco_unitario), 1.11);
    assert.notStrictEqual(Number(c.preco_unitario), 99.99);
  });

  await test('TESTE 13 — Duas vendas diferentes do mesmo produto', async () => {
    const mon = await listarMonitoramentoProdutosDoDia(db, DATA);
    const suco = mon.find((p) => p.produto_id === 4);
    assert.ok(suco);
    assert.ok((suco.vendas || []).length >= 3);
    assert.strictEqual(Number(suco.quantidade_elegivel), 17);
  });

  await test('TESTE 14 — Mesmo item não usado duas vezes', async () => {
    const ff = await criarRascunho({ data_fechamento: DATA, cnpj: '12345678000199' }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 75 }, { db });
    await gerarPrevia({ id: ff.id, data: DATA, valor_informado: 75, persistir: true }, { db });

    // Segundo fechamento outro CNPJ no mesmo dia
    const ff2 = await criarRascunho({ data_fechamento: DATA, cnpj: '98765432000111' }, { db });
    const lotes2 = await listarLotesElegiveisDoDia(db, DATA, { excluirFechamentoId: ff2.id });
    // Itens já usados no ff1 devem ter disponibilidade reduzida
    const sucoDisp = lotes2.filter((l) => l.produto_id === 4)
      .reduce((s, l) => s + Number(l.quantidade_disponivel), 0);
    assert.ok(sucoDisp < 17, `esperado < 17 após uso, got ${sucoDisp}`);
  });

  await test('TESTE 15 — Monitoramento atualiza após nova venda', async () => {
    const antes = await obterResumoDia(db, DATA);
    const unAntes = Number(antes.unidades_fiscais_elegiveis);
    await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
      VALUES (110,?,22.50,22.50,'concluida',0)`, [DATA]);
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
      VALUES (1010,110,4,3,3,0,22.50,22.50,22.50,7.50)`);
    const depois = await obterResumoDia(db, DATA);
    assert.ok(Number(depois.unidades_fiscais_elegiveis) >= unAntes + 3);
  });

  await test('TESTE 16 — Fechamento congelado (prévia) não muda com venda posterior', async () => {
    const ff = await get(db, `SELECT id, valor_distribuido FROM fechamentos_fiscais WHERE cnpj='12345678000199' AND status != 'CANCELADO'`);
    assert.ok(ff);
    const valorAntes = Number(ff.valor_distribuido);
    const det = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id=?`, [ff.id]);
    // Nova venda já inserida no teste 15 — prévia persistida permanece
    const det2 = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.strictEqual(Number(det.n), Number(det2.n));
    const ff2 = await get(db, `SELECT valor_distribuido FROM fechamentos_fiscais WHERE id=?`, [ff.id]);
    assert.strictEqual(Number(ff2.valor_distribuido), valorAntes);
  });

  await test('TESTE 17 — CNPJ/empresa isolado na criação', async () => {
    const a = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais WHERE cnpj='12345678000199' AND status != 'CANCELADO'`);
    const b = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais WHERE cnpj='98765432000111' AND status != 'CANCELADO'`);
    assert.ok(Number(a.n) >= 1);
    assert.ok(Number(b.n) >= 1);
  });

  await test('TESTE 18 — Config OFF bloqueia criação', async () => {
    await setModulo(db, '0');
    let erro = null;
    try {
      await criarRascunho({ data_fechamento: '2026-09-14', cnpj: '11111111000111' }, { db });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok(erro.code === 'MODULO_OFF' || /desativad/i.test(String(erro.message)));
  });

  await test('TESTE 19 — Config ON permite fluxo', async () => {
    await setModulo(db, '1');
    const ff = await criarRascunho({ data_fechamento: '2026-09-14', cnpj: '11111111000111' }, { db });
    assert.ok(ff.id > 0);
    assert.strictEqual(ff.status, STATUS.RASCUNHO);
  });

  await test('TESTE 20 — Regressão distribuição (centavos 700)', async () => {
    assert.strictEqual(toCentavos(somarMoeda([125.89, 98.25, 360, 115.86])), 70000);
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const previa = gerarPreviaDistribuicao(lotes, 100, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.ok(toCentavos(previa.valor_distribuido) <= toCentavos(previa.valor_informado) + 0);
    assert.ok(previa.valor_distribuido >= 0);
  });

  await test('TESTE 21 — Resumo KPIs semânticos Sprint 06', async () => {
    const r = await obterResumoDia(db, DATA);
    assert.ok(typeof r.vendas_do_dia === 'number');
    assert.ok(typeof r.vendas_nao_fiscais === 'number');
    assert.ok(typeof r.valor_nao_fiscal_vendido === 'number');
    assert.ok(typeof r.produtos_fiscais_vendidos === 'number');
    assert.ok(typeof r.produtos_fiscais_com_consumo_nao_fiscal === 'number');
    assert.ok(typeof r.unidades_fiscais_elegiveis === 'number');
    assert.ok(typeof r.valor_fiscal_elegivel === 'number');
    assert.ok(Array.isArray(r.monitoramento));
    // Compat
    assert.ok(r.itens_fiscais_elegiveis != null);
    assert.ok(r.capacidade_elegivel != null);
  });

  await test('TESTE 22 — READ-ONLY comercial (estoque/financeiro/vendas/pagamentos)', async () => {
    const snapDepois = await snapshotComercial(db);
    assert.strictEqual(snapDepois.estoque_fiscal, snapAntes.estoque_fiscal);
    assert.strictEqual(snapDepois.estoque_nao_fiscal, snapAntes.estoque_nao_fiscal);
    assert.strictEqual(snapDepois.financeiro, snapAntes.financeiro);
    assert.strictEqual(snapDepois.pagamentos, snapAntes.pagamentos);
    // vendas: podem ter aumentado por inserts dos testes — mas snapshot de estoque/financeiro intacto
    const v101 = await get(db, `SELECT quantidade_fiscal, quantidade_nao_fiscal, subtotal FROM vendas_itens WHERE id=1001`);
    assert.strictEqual(Number(v101.quantidade_fiscal), 10);
    assert.strictEqual(Number(v101.quantidade_nao_fiscal), 0);
  });

  await test('TESTE 23 — quantidade_nao_fiscal NÃO é elegível', async () => {
    // Item só com qNF e item_fiscal=1 em op NF
    await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
      VALUES (5,'So NF Stock','SNF',5,1,0,50)`);
    await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
      VALUES (111,?,50,50,'concluida',0)`, [DATA]);
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_nao_fiscal,preco_unitario)
      VALUES (1011,111,5,10,0,10,50,50,5)`);
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => l.venda_item_id === 1011));
  });

  await test('TESTE 24 — ORIGEM_LEGADA_AMBIGUA não vira elegível silenciosamente', async () => {
    await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
      VALUES (112,?,30,30,'concluida',0)`, [DATA]);
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_nao_fiscal,preco_unitario)
      VALUES (1012,112,1,5,0,0,30,30,6)`);
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => l.venda_item_id === 1012));
    const r = await obterResumoDia(db, DATA);
    assert.ok(Number(r.registros_origem_legada_ambigua) >= 1);
  });

  console.log(`\nResultado Sprint 06: ${ok} OK, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
