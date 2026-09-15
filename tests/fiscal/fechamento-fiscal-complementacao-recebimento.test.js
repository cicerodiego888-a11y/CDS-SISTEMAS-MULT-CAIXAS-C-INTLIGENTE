/**
 * Complementação fiscal por recebimento de maquineta.
 * Executar: node tests/fiscal/fechamento-fiscal-complementacao-recebimento.test.js
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
  gerarComplementacaoFiscal,
  calcularComplementacaoFiscal,
  obterProdutosFiscaisDisponiveisParaComplementacao,
  listarMonitoramentoProdutosDoDia,
  listarLotesElegiveisDoDia,
  gerarPrevia,
  snapshotComercial,
  toCentavos
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
  await run(db, `CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', '1')`);
  await run(db, `CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY,
    nome TEXT, codigo TEXT,
    preco_venda REAL DEFAULT 0,
    preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0,
    saldo_fiscal REAL DEFAULT 0,
    saldo_nao_fiscal REAL DEFAULT 0,
    estoque_atual REAL DEFAULT 0,
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
  await run(db, `CREATE TABLE IF NOT EXISTS financeiro (id INTEGER PRIMARY KEY, valor REAL, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas_pagamentos (id INTEGER PRIMARY KEY, venda_id INTEGER, valor REAL)`);
  await run(db, `CREATE TABLE IF NOT EXISTS produtos_ajustes_estoque (id INTEGER PRIMARY KEY, produto_id INTEGER, quantidade REAL)`);
  await run(db, `CREATE TABLE IF NOT EXISTS movimentos_transferencia_saldos (id INTEGER PRIMARY KEY, produto_id INTEGER)`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function nfceAutorizada(db, vendaId, numero) {
  await run(db, `INSERT INTO nfce_notas
    (venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno,protocolo)
    VALUES (?,?,'1','CHAVE',1,'autorizada',
      '<protNFe><infProt><cStat>100</cStat><nProt>1</nProt></infProt></protNFe>','1')`,
  [vendaId, numero]);
}

async function main() {
  console.log('\n=== Complementação fiscal por recebimento ===\n');
  moduloConfig._resetCacheForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-comp-'));
  const db = await openDb(path.join(dir, 'test.db'));
  await schemaBase(db);
  moduloConfig._resetCacheForTests();
  const DATA = '2026-09-14';

  await test('TESTE 1 — recebimento 25 / cobertura 0 / produto 25', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 25,
      coberturaFiscal: 0,
      lotes: [{ produto_id: 1, item_fiscal: 1, saldo_fiscal: 25, valor_disponivel: 25, quantidade_disponivel: 25 }]
    });
    assert.strictEqual(r.deficit, 25);
    assert.strictEqual(r.valor_complementado, 25);
    assert.strictEqual(r.deficit_restante, 0);
  });

  await test('TESTE 2 — A=16 B=20 compõe 16+9=25', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 25,
      coberturaFiscal: 0,
      lotes: [
        { produto_id: 1, item_fiscal: 1, saldo_fiscal: 16, valor_disponivel: 16, quantidade_disponivel: 16 },
        { produto_id: 2, item_fiscal: 1, saldo_fiscal: 20, valor_disponivel: 20, quantidade_disponivel: 20 }
      ]
    });
    assert.strictEqual(r.valor_complementado, 25);
    assert.strictEqual(r.deficit_restante, 0);
    assert.strictEqual(r.itens_complementacao.length, 2);
    assert.strictEqual(r.itens_complementacao[0].valor, 16);
    assert.strictEqual(r.itens_complementacao[1].valor, 9);
  });

  await test('TESTE 01 — maquineta = cobertura → déficit 0', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 189.30,
      coberturaFiscal: 189.30,
      lotes: [{ produto_id: 1, valor_disponivel: 50, quantidade_disponivel: 1 }]
    });
    assert.strictEqual(r.deficit, 0);
    assert.strictEqual(r.valor_complementado, 0);
    assert.strictEqual(r.itens_complementacao.length, 0);
    assert.strictEqual(r.estoque_movimentado, false);
  });

  await test('TESTE 02 — maquineta maior que cobertura → déficit', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 189.30,
      coberturaFiscal: 150
    });
    assert.strictEqual(toCentavos(r.deficit), 3930);
    assert.strictEqual(r.deficit, 39.3);
  });

  await test('TESTE 14 — centavos 189,30 - 150,00 = 39,30', async () => {
    const r = calcularComplementacaoFiscal({ valorRecebido: 189.3, coberturaFiscal: 150 });
    assert.strictEqual(r.deficit, 39.3);
    assert.ok(!String(r.deficit).includes('39999'));
  });

  await test('TESTE 03 — produto não fiscal não é elegível', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 100,
      coberturaFiscal: 0,
      lotes: [{ produto_id: 9, item_fiscal: 0, saldo_fiscal: 80, valor_disponivel: 40, quantidade_disponivel: 2 }]
    });
    assert.strictEqual(r.valor_complementado, 0);
  });

  await test('TESTE 04 — fiscal com saldo_fiscal = 0 não é elegível', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 100,
      coberturaFiscal: 0,
      lotes: [{ produto_id: 9, item_fiscal: 1, saldo_fiscal: 0, valor_disponivel: 40, quantidade_disponivel: 2 }]
    });
    assert.strictEqual(r.valor_complementado, 0);
  });

  await test('TESTE 05 — fiscal com saldo negativo não é elegível', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 100,
      coberturaFiscal: 0,
      lotes: [{ produto_id: 9, item_fiscal: 1, saldo_fiscal: -2, valor_disponivel: 40, quantidade_disponivel: 2 }]
    });
    assert.strictEqual(r.valor_complementado, 0);
  });

  await test('TESTE 06 — fiscal com saldo positivo é elegível', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 40,
      coberturaFiscal: 0,
      lotes: [{ produto_id: 9, item_fiscal: 1, saldo_fiscal: 10, valor_disponivel: 40, quantidade_disponivel: 2 }]
    });
    assert.strictEqual(r.valor_complementado, 40);
    assert.strictEqual(r.itens_complementacao[0].produto_id, 9);
  });

  await test('TESTE 07 — complementação exata 39,30', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 189.3,
      coberturaFiscal: 150,
      lotes: [
        { produto_id: 1, item_fiscal: 1, saldo_fiscal: 50, valor_disponivel: 20, quantidade_disponivel: 2 },
        { produto_id: 2, item_fiscal: 1, saldo_fiscal: 30, valor_disponivel: 19.3, quantidade_disponivel: 1 }
      ]
    });
    assert.strictEqual(r.valor_complementado, 39.3);
    assert.strictEqual(r.deficit_restante, 0);
    assert.strictEqual(r.itens_complementacao.length, 2);
  });

  await test('TESTE 08 — saldo insuficiente', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 189.3,
      coberturaFiscal: 150,
      lotes: [
        { produto_id: 1, item_fiscal: 1, saldo_fiscal: 5, valor_disponivel: 25, quantidade_disponivel: 1 }
      ]
    });
    assert.strictEqual(r.valor_complementado, 25);
    assert.strictEqual(r.deficit_restante, 14.3);
  });

  await test('Não ultrapassa o déficit', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 189.3,
      coberturaFiscal: 150,
      lotes: [
        { produto_id: 1, item_fiscal: 1, saldo_fiscal: 99, valor_disponivel: 100, quantidade_disponivel: 10 }
      ]
    });
    assert.strictEqual(r.valor_complementado, 39.3);
    assert.ok(r.valor_complementado <= r.deficit);
  });

  await test('Não duplica o mesmo produto', async () => {
    const r = calcularComplementacaoFiscal({
      valorRecebido: 50,
      coberturaFiscal: 0,
      lotes: [
        { produto_id: 1, item_fiscal: 1, saldo_fiscal: 10, valor_disponivel: 20, quantidade_disponivel: 1 },
        { produto_id: 1, item_fiscal: 1, saldo_fiscal: 10, valor_disponivel: 15, quantidade_disponivel: 1 }
      ]
    });
    assert.strictEqual(r.itens_complementacao.length, 1);
    assert.strictEqual(r.itens_complementacao[0].valor, 35);
  });

  // Persistência / integração
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal,estoque_atual)
    VALUES (1,'A','A1',20,1,150,50,200)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal,estoque_atual)
    VALUES (2,'B','B1',19.30,1,30,10,40)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal,estoque_atual)
    VALUES (3,'NaoFiscal','N1',10,0,80,80,160)`);

  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,status,cancelada)
    VALUES (1,?,150,150,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,subtotal,valor_fiscal,preco_unitario,item_fiscal)
    VALUES (11,1,1,7.5,7.5,150,150,20,1)`);
  await nfceAutorizada(db, 1, 1);

  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (2,?,39.30,39.30,'concluida',0)`, [DATA]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (12,2,1,1,1,0,20,20,20,20,1)`);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (13,2,2,1,1,0,19.30,19.30,19.30,19.30,1)`);

  const ff = await criarRascunho({ data_fechamento: DATA, cnpj: '12345678000199' }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Stone PIX', valor: 189.3, cnpj: '12345678000199' }, { db });

  await test('TESTE 09 — nenhum estoque movimentado', async () => {
    const antes = await get(db, `SELECT saldo_fiscal,saldo_nao_fiscal,estoque_atual FROM produtos WHERE id=1`);
    const snapAntes = await snapshotComercial(db);
    const ajAntes = await get(db, `SELECT COUNT(*) AS n FROM produtos_ajustes_estoque`);
    const mvAntes = await get(db, `SELECT COUNT(*) AS n FROM movimentos_transferencia_saldos`);
    const r = await gerarComplementacaoFiscal(ff.id, { db });
    assert.ok(r.deficit > 0);
    const depois = await get(db, `SELECT saldo_fiscal,saldo_nao_fiscal,estoque_atual FROM produtos WHERE id=1`);
    const snapDepois = await snapshotComercial(db);
    const ajDepois = await get(db, `SELECT COUNT(*) AS n FROM produtos_ajustes_estoque`);
    const mvDepois = await get(db, `SELECT COUNT(*) AS n FROM movimentos_transferencia_saldos`);
    assert.strictEqual(Number(depois.saldo_fiscal), 150);
    assert.strictEqual(Number(depois.saldo_nao_fiscal), 50);
    assert.strictEqual(Number(depois.estoque_atual), 200);
    assert.strictEqual(Number(antes.saldo_fiscal), Number(depois.saldo_fiscal));
    assert.strictEqual(snapAntes.estoque_fiscal, snapDepois.estoque_fiscal);
    assert.strictEqual(Number(ajAntes.n), Number(ajDepois.n));
    assert.strictEqual(Number(mvAntes.n), Number(mvDepois.n));
    assert.strictEqual(r.estoque_movimentado, false);
  });

  await test('Venda original não é alterada', async () => {
    const v = await get(db, `SELECT total,valor_fiscal,cancelada FROM vendas WHERE id=2`);
    assert.strictEqual(Number(v.total), 39.3);
    assert.strictEqual(Number(v.cancelada), 0);
  });

  await test('TESTE 10 — venda cancelada não entra na cobertura', async () => {
    await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,status,cancelada)
      VALUES (3,?,80,80,'concluida',1)`, [DATA]);
    await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,subtotal,valor_fiscal)
      VALUES (14,3,1,4,80,80)`);
    await nfceAutorizada(db, 3, 2);
    const r = await gerarComplementacaoFiscal(ff.id, { db });
    assert.strictEqual(r.cobertura_fiscal, 150);
  });

  await test('TESTE 11 — devolução reduz cobertura', async () => {
    await run(db, `INSERT INTO vendas_devolucoes (id,venda_id,venda_item_id,produto_id,quantidade,valor_total)
      VALUES (1,1,11,1,1,20)`);
    const r = await gerarComplementacaoFiscal(ff.id, { db });
    assert.strictEqual(r.cobertura_fiscal, 130);
    await run(db, `DELETE FROM vendas_devolucoes WHERE id=1`);
  });

  await test('TESTE 12 — CNPJ/fechamento não mistura recebimentos', async () => {
    const ffB = await criarRascunho({ data_fechamento: DATA, cnpj: '98765432000111' }, { db });
    await adicionarRecebimento(ffB.id, { operadora: 'Cielo', valor: 10, cnpj: '98765432000111' }, { db });
    const a = await gerarComplementacaoFiscal(ff.id, { db });
    const b = await gerarComplementacaoFiscal(ffB.id, { db });
    assert.strictEqual(a.valor_recebido, 189.3);
    assert.strictEqual(b.valor_recebido, 10);
    assert.notStrictEqual(a.cnpj, b.cnpj);
  });

  await test('TESTE 13 — execução repetida não duplica', async () => {
    const a = await gerarComplementacaoFiscal(ff.id, { db });
    const b = await gerarComplementacaoFiscal(ff.id, { db });
    assert.strictEqual(a.valor_complementado, b.valor_complementado);
    const n = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_complementacao WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.strictEqual(Number(n.n), 1);
    const itens = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_complementacao_itens WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.strictEqual(Number(itens.n), (a.itens_complementacao || []).length);
  });

  await test('Lotes do dia respeitam elegibilidade (não fiscal fora)', async () => {
    await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
      VALUES (4,?,10,10,'concluida',0)`, [DATA]);
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,preco_unitario,item_fiscal)
      VALUES (15,4,3,1,1,0,10,10,10,0)`);
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => Number(l.produto_id) === 3));
  });

  await test('TESTE 3 / print — produto fora do monitoramento completa R$ 25', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-comp-print-'));
    const db2 = await openDb(path.join(dir2, 't.db'));
    await schemaBase(db2);
    moduloConfig._resetCacheForTests();
    const D = '2026-09-15';
    await run(db2, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal,estoque_atual)
      VALUES (20,'Monitorado 16','M16',16,1,1,0,1)`);
    await run(db2, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal,estoque_atual)
      VALUES (21,'Fora Monitor 20','F20',1,1,20,0,20)`);
    await run(db2, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
      VALUES (20,?,16,16,'concluida',0)`, [D]);
    await run(db2, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,preco_unitario,item_fiscal)
      VALUES (200,20,20,1,1,0,16,16,16,1)`);
    const mon = await listarMonitoramentoProdutosDoDia(db2, D);
    assert.ok(mon.some((p) => Number(p.produto_id) === 20), 'A deve aparecer no monitoramento');
    assert.ok(!mon.some((p) => Number(p.produto_id) === 21), 'B não deve aparecer no monitoramento');
    const disp = await obterProdutosFiscaisDisponiveisParaComplementacao(db2);
    assert.ok(disp.some((p) => Number(p.produto_id) === 21), 'B deve estar disponível para complementação');
    const ffP = await criarRascunho({ data_fechamento: D, cnpj: '12345678000199' }, { db: db2 });
    await adicionarRecebimento(ffP.id, { operadora: 'Stone', valor: 25, cnpj: '12345678000199' }, { db: db2 });
    const r = await gerarComplementacaoFiscal(ffP.id, { db: db2 });
    assert.strictEqual(r.valor_recebido, 25);
    assert.strictEqual(r.cobertura_fiscal, 0);
    assert.strictEqual(r.deficit, 25);
    assert.strictEqual(r.valor_complementado, 25);
    assert.strictEqual(r.deficit_restante, 0);
    const usadoB = (r.itens_complementacao || []).some((it) => Number(it.produto_id) === 21);
    assert.ok(usadoB, 'produto fora do monitoramento deve entrar na composição');
    const previaRes = await gerarPrevia({
      id: ffP.id,
      valor_informado: 25,
      valor_alvo: 25,
      valor_min: 5,
      valor_max: 12.5,
      persistir: true
    }, { db: db2 });
    assert.strictEqual(Number(previaRes.previa.valor_distribuido), 25);
    assert.strictEqual(Number(previaRes.previa.diferenca), 0);
    assert.strictEqual(previaRes.previa.perfeita, true);
    const depois = await get(db2, `SELECT saldo_fiscal,estoque_atual FROM produtos WHERE id=21`);
    assert.strictEqual(Number(depois.saldo_fiscal), 20);
    assert.strictEqual(Number(depois.estoque_atual), 20);
    await db2.close();
    try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  await db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\nResultado complementação: ${ok} OK, ${falhas} falha(s)\n`);
  if (falhas > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
