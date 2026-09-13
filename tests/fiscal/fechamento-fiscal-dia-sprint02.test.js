/**
 * Sprint 02 — Motor de Distribuição Fiscal Inteligente
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint02.test.js
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
  obterPorId,
  gerarPrevia,
  gerarPreviaDistribuicao,
  listarProdutosElegiveisDoDia,
  listarLotesElegiveisDoDia,
  snapshotComercial,
  somarMoeda,
  toCentavos,
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

async function schemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, preco_venda REAL DEFAULT 0, preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0, produto_fracionado INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN',
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, ativo INTEGER DEFAULT 1
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, data_venda TEXT, total REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    status TEXT DEFAULT 'concluida', cancelada INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
    quantidade REAL DEFAULT 0, quantidade_fiscal REAL DEFAULT 0, quantidade_nao_fiscal REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    preco_unitario REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER, produto_id INTEGER,
    quantidade REAL, valor_unitario REAL, valor_total REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '12345678000199')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function seedPadrao(db, data = '2026-09-11') {
  await run(db, `INSERT INTO produtos VALUES (1,'Pastel Carne','1',10,5,1,0,'UN',50,50,1)`);
  await run(db, `INSERT INTO produtos VALUES (2,'Pastel Frango','2',12,6,1,0,'UN',50,50,1)`);
  await run(db, `INSERT INTO produtos VALUES (3,'Açai','3',18,8,1,0,'UN',50,50,1)`);
  await run(db, `INSERT INTO produtos VALUES (4,'Pizza','4',40,20,1,0,'UN',50,50,1)`);
  await run(db, `INSERT INTO produtos VALUES (5,'Refrigerante','5',6,3,1,0,'UN',50,50,1)`);
  await run(db, `INSERT INTO produtos VALUES (6,'Sem Venda','6',9,4,1,0,'UN',10,10,1)`);
  await run(db, `INSERT INTO produtos VALUES (7,'Nao Fiscal','7',8,4,0,0,'UN',0,20,1)`);
  await run(db, `INSERT INTO produtos VALUES (8,'Item Caro','8',1000,500,1,0,'UN',5,5,1)`);

  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (1,?,1820,1820,'concluida',0)`, [data]);

  // Sprint 06: elegível = quantidade_fiscal em operação não fiscal
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1,1,1,20,20,0,200,200,200,10)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (2,1,2,10,10,0,120,120,120,12)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (3,1,3,8,8,0,144,144,144,18)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (4,1,4,5,5,0,200,200,200,40)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (5,1,5,20,20,0,120,120,120,6)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (6,1,7,5,0,5,40,0,40,8)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (7,1,8,1,1,0,1000,1000,1000,1000)`);

  // segundo preço do pastel
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (2,?,36,36,'concluida',0)`, [data]);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (8,2,1,3,3,0,36,36,36,12)`);

  await run(db, `INSERT INTO financeiro (id,valor,descricao,tipo,origem) VALUES (1,1000,'venda','receita','pdv')`);
}

async function main() {
  console.log('\n=== Sprint 02 — Motor Distribuição Fiscal ===\n');
  moduloConfig._resetCacheForTests();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s02-'));
  const db = await openDb(path.join(dir, 'test.db'));
  await schemaBase(db);
  await seedPadrao(db);

  const lotes = await listarLotesElegiveisDoDia(db, '2026-09-11');

  await test('Teste 01 — R$ 700 exato', async () => {
    const previa = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.strictEqual(toCentavos(previa.valor_informado), 70000);
    assert.strictEqual(toCentavos(previa.valor_distribuido), 70000);
    assert.strictEqual(toCentavos(previa.diferenca), 0);
    assert.strictEqual(previa.perfeita, true);
  });

  await test('Teste 02 — Distribuição com centavos (soma 700)', async () => {
    assert.strictEqual(toCentavos(somarMoeda([125.89, 98.25, 360, 115.86])), 70000);
  });

  await test('Teste 03/04 — Valores variáveis; R$ 250 só sugestão', async () => {
    const previa = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.ok(previa.vendas.length >= 1);
    const todos250 = previa.vendas.every((v) => toCentavos(v.valor) === 25000);
    assert.strictEqual(todos250, false);
    // pelo menos uma venda diferente de 250 se houver mais de uma, ou total fecha
    assert.strictEqual(toCentavos(previa.diferenca), 0);
  });

  await test('Teste 05 — Quantidade disponível respeitada', async () => {
    const previa = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250 });
    const pastel = previa.porProduto.find((p) => p.produto_id === 1);
    assert.ok(pastel);
    assert.ok(pastel.quantidade_utilizada <= pastel.quantidade_vendida + 0.0001);
  });

  await test('Teste 06 — Produto não vendido não utilizado', async () => {
    const previa = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250 });
    assert.ok(!(previa.itensUtilizados || []).some((p) => p.produto_id === 6));
  });

  await test('Teste 07 — Produto não fiscal não utilizado', async () => {
    const elegiveis = await listarProdutosElegiveisDoDia(db, '2026-09-11');
    assert.ok(!elegiveis.some((p) => p.produto_id === 7));
    const previa = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250 });
    assert.ok(!(previa.itensUtilizados || []).some((p) => p.produto_id === 7));
  });

  await test('Teste 08 — Valor informado maior que elegível', async () => {
    // remove item caro from consideration by using filtered lots without id 8 for capacity message
    const lotesSemCaro = lotes.filter((l) => l.produto_id !== 8);
    const previa = gerarPreviaDistribuicao(lotesSemCaro, 10000, { valorAlvo: 250 });
    assert.strictEqual(previa.incompleta, true);
    assert.strictEqual(previa.codigo, 'CAPACIDADE_INSUFICIENTE');
    assert.ok(previa.mensagem.includes('Valor máximo elegível'));
    assert.ok(toCentavos(previa.valor_distribuido) <= toCentavos(previa.valor_elegivel));
  });

  await test('Teste 09 — Valor informado zero', async () => {
    const previa = gerarPreviaDistribuicao(lotes, 0, { valorAlvo: 250 });
    assert.strictEqual(previa.codigo, 'VALOR_ZERO');
    assert.strictEqual(previa.vendas.length, 0);
  });

  await test('Teste 10 — Produto unitário superior ao alvo total não quebra unidade', async () => {
    const soCaro = lotes.filter((l) => l.produto_id === 8);
    const previa = gerarPreviaDistribuicao(soCaro, 700, { valorAlvo: 250 });
    assert.ok(['CAPACIDADE_INSUFICIENTE', 'UNIDADE_SUPERIOR'].includes(previa.codigo));
    assert.strictEqual(toCentavos(previa.valor_distribuido), 0);
    assert.strictEqual(previa.vendas.length, 0);
  });

  let fechamentoId;
  await test('Teste 11 — Regerar prévia não duplica', async () => {
    const ff = await criarRascunho({ data_fechamento: '2026-09-11', usuario_id: 1 }, { db });
    fechamentoId = ff.id;
    await adicionarRecebimento(fechamentoId, { operadora: 'Sicredi', valor: 400 }, { db });
    await adicionarRecebimento(fechamentoId, { operadora: 'Stone', valor: 300 }, { db });
    await gerarPrevia({ id: fechamentoId, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    await gerarPrevia({ id: fechamentoId, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    await gerarPrevia({ id: fechamentoId, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    const det = await obterPorId(fechamentoId, { db });
    assert.strictEqual(det.status, STATUS.PREVIA);
    // contagem de vendas da prévia = quantidade_vendas da última geração (sem acumular)
    const q1 = det.previa_vendas.length;
    const r4 = await gerarPrevia({ id: fechamentoId, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    const det2 = await obterPorId(fechamentoId, { db });
    assert.strictEqual(det2.previa_vendas.length, r4.previa.quantidade_vendas);
    assert.strictEqual(det2.previa_vendas.length, q1);
  });

  await test('Teste 12 — Resultado determinístico', async () => {
    const a = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    const b = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.strictEqual(JSON.stringify(a.vendas.map((v) => ({ s: v.sequencia, v: v.valor, n: v.itens.length }))),
      JSON.stringify(b.vendas.map((v) => ({ s: v.sequencia, v: v.valor, n: v.itens.length }))));
    assert.strictEqual(toCentavos(a.valor_distribuido), toCentavos(b.valor_distribuido));
  });

  await test('Testes críticos 13-17 — estoque/financeiro/caixa/vendas/margem', async () => {
    const antes = await snapshotComercial(db);
    await gerarPrevia({ id: fechamentoId, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    const depois = await snapshotComercial(db);
    assert.strictEqual(depois.estoque_fiscal, antes.estoque_fiscal);
    assert.strictEqual(depois.estoque_nao_fiscal, antes.estoque_nao_fiscal);
    assert.strictEqual(depois.financeiro, antes.financeiro);
    assert.strictEqual(depois.caixa, antes.caixa);
    assert.strictEqual(depois.vendas, antes.vendas);
    assert.strictEqual(depois.margem_proxy, antes.margem_proxy);
  });

  await test('Lotes preservam preços distintos do Pastel', async () => {
    const pastelLotes = lotes.filter((l) => l.produto_id === 1);
    const precos = new Set(pastelLotes.map((l) => l.unit_cents));
    assert.ok(precos.has(1000));
    assert.ok(precos.has(1200));
  });

  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
