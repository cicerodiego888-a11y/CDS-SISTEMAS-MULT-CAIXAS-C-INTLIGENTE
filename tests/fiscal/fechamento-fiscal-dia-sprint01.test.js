/**
 * Sprint 01 — Fechamento Fiscal do Dia
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint01.test.js
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
  removerRecebimento,
  substituirRecebimentos,
  obterPorId,
  gerarPrevia,
  gerarPreviaDistribuicao,
  listarProdutosElegiveisDoDia,
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

function schemaBase(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        codigo TEXT,
        preco_venda REAL DEFAULT 0,
        preco_compra REAL DEFAULT 0,
        item_fiscal INTEGER DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        ativo INTEGER DEFAULT 1
      )`);
      db.run(`CREATE TABLE vendas (
        id INTEGER PRIMARY KEY,
        data_venda TEXT,
        total REAL DEFAULT 0,
        valor_fiscal REAL DEFAULT 0,
        valor_nao_fiscal REAL DEFAULT 0,
        status TEXT DEFAULT 'concluida',
        cancelada INTEGER DEFAULT 0
      )`);
      db.run(`CREATE TABLE vendas_itens (
        id INTEGER PRIMARY KEY,
        venda_id INTEGER,
        produto_id INTEGER,
        quantidade REAL DEFAULT 0,
        quantidade_fiscal REAL DEFAULT 0,
        quantidade_nao_fiscal REAL DEFAULT 0,
        subtotal REAL DEFAULT 0,
        valor_fiscal REAL DEFAULT 0,
        valor_nao_fiscal REAL DEFAULT 0,
        preco_unitario REAL DEFAULT 0
      )`);
      db.run(`CREATE TABLE vendas_devolucoes (
        id INTEGER PRIMARY KEY,
        venda_id INTEGER,
        venda_item_id INTEGER,
        produto_id INTEGER,
        quantidade REAL,
        quantidade_fiscal REAL DEFAULT 0,
        quantidade_nao_fiscal REAL DEFAULT 0,
        valor_unitario REAL,
        valor_total REAL,
        motivo TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE financeiro (
        id INTEGER PRIMARY KEY,
        valor REAL,
        descricao TEXT
      )`);
      db.run(`CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT
      )`);
      db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '12345678000199')`, (err) => {
        if (err) return reject(err);
        db.run(
          `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`,
          (err2) => {
            if (err2) return reject(err2);
            garantirSchemaFechamentoFiscal(db, (e3) => (e3 ? reject(e3) : resolve()));
          }
        );
      });
    });
  });
}

async function seedDia(db, data = '2026-09-11') {
  await run(db, `INSERT INTO produtos (id, nome, codigo, preco_venda, item_fiscal, saldo_fiscal, saldo_nao_fiscal)
    VALUES (1, 'Pastel', 'P1', 10, 1, 100, 100)`);
  await run(db, `INSERT INTO produtos (id, nome, codigo, preco_venda, item_fiscal, saldo_fiscal, saldo_nao_fiscal)
    VALUES (2, 'Açai', 'P2', 15, 1, 100, 100)`);
  await run(db, `INSERT INTO produtos (id, nome, codigo, preco_venda, item_fiscal, saldo_fiscal, saldo_nao_fiscal)
    VALUES (3, 'Refrigerante', 'P3', 5, 1, 100, 100)`);
  await run(db, `INSERT INTO produtos (id, nome, codigo, preco_venda, item_fiscal, saldo_fiscal, saldo_nao_fiscal)
    VALUES (4, 'Produto Sem Venda', 'P4', 9, 1, 50, 50)`);
  await run(db, `INSERT INTO produtos (id, nome, codigo, preco_venda, item_fiscal, saldo_fiscal, saldo_nao_fiscal)
    VALUES (5, 'Nao Fiscal Cadastro', 'P5', 8, 0, 0, 80)`);

  await run(db, `INSERT INTO vendas (id, data_venda, total, valor_fiscal, valor_nao_fiscal, status, cancelada)
    VALUES (10, ?, 1000, 0, 1000, 'concluida', 0)`, [data]);
  // Sprint 06: elegível = quantidade_fiscal em operação não fiscal (sem NFC-e)
  await run(db, `INSERT INTO vendas_itens
    (id, venda_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal, subtotal, valor_fiscal, valor_nao_fiscal, preco_unitario)
    VALUES (1, 10, 1, 50, 50, 0, 500, 500, 500, 10)`);
  await run(db, `INSERT INTO vendas_itens
    (id, venda_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal, subtotal, valor_fiscal, valor_nao_fiscal, preco_unitario)
    VALUES (2, 10, 2, 20, 20, 0, 300, 300, 300, 15)`);
  await run(db, `INSERT INTO vendas_itens
    (id, venda_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal, subtotal, valor_fiscal, valor_nao_fiscal, preco_unitario)
    VALUES (3, 10, 3, 40, 40, 0, 200, 200, 200, 5)`);
  // item_fiscal=0 vendido — não elegível
  await run(db, `INSERT INTO vendas_itens
    (id, venda_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal, subtotal, valor_fiscal, valor_nao_fiscal, preco_unitario)
    VALUES (4, 10, 5, 10, 0, 10, 80, 0, 80, 8)`);

  // Venda cancelada (não conta)
  await run(db, `INSERT INTO vendas (id, data_venda, total, valor_nao_fiscal, status, cancelada)
    VALUES (11, ?, 50, 50, 'cancelada', 1)`, [data]);
  await run(db, `INSERT INTO vendas_itens
    (id, venda_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal, subtotal, valor_nao_fiscal)
    VALUES (5, 11, 1, 5, 5, 0, 50, 50)`);

  await run(db, `INSERT INTO financeiro (id, valor, descricao) VALUES (1, 1000, 'venda dia')`);
}

async function main() {
  console.log('\n=== Sprint 01 — Fechamento Fiscal do Dia ===\n');
  moduloConfig._resetCacheForTests();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s01-'));
  const dbFile = path.join(dir, 'test.db');
  const db = await openDb(dbFile);
  await schemaBase(db);
  await seedDia(db, '2026-09-11');

  await test('Teste 01 — Criar fechamento para o dia', async () => {
    const ff = await criarRascunho({ data_fechamento: '2026-09-11', usuario_id: 7 }, { db });
    assert.ok(ff.id > 0);
    assert.strictEqual(ff.status, STATUS.RASCUNHO);
    assert.strictEqual(ff.data_fechamento, '2026-09-11');
    assert.strictEqual(ff.usuario_id, 7);
  });

  await test('Proteção duplicidade — mesmo dia', async () => {
    let erro = null;
    try {
      await criarRascunho({ data_fechamento: '2026-09-11' }, { db });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.statusCode, 409);
    assert.match(String(erro.message), /Já existe um fechamento fiscal/);
  });

  let fechamentoId = null;
  await test('Teste 02/03 — Adicionar máquinas e somar 700', async () => {
    const lista = await obterPorId(1, { db });
    fechamentoId = lista.id;
    await adicionarRecebimento(fechamentoId, { operadora: 'Sicredi', valor: 400, cnpj: '12345678000199' }, { db });
    await adicionarRecebimento(fechamentoId, { operadora: 'Stone', valor: 180 }, { db });
    const ff = await adicionarRecebimento(fechamentoId, { operadora: 'Mercado Pago', valor: 120 }, { db });
    assert.strictEqual(ff.recebimentos.length, 3);
    assert.strictEqual(toCentavos(ff.valor_informado), 70000);
    assert.strictEqual(toCentavos(somarMoeda([400, 180, 120])), 70000);
  });

  await test('Teste 04 — Buscar somente produtos vendidos no dia', async () => {
    const elegiveis = await listarProdutosElegiveisDoDia(db, '2026-09-11');
    const ids = elegiveis.map((p) => p.produto_id).sort();
    assert.deepStrictEqual(ids, [1, 2, 3]);
  });

  await test('Teste 05 — Produto não vendido não aparece', async () => {
    const elegiveis = await listarProdutosElegiveisDoDia(db, '2026-09-11');
    assert.ok(!elegiveis.some((p) => p.produto_id === 4));
    assert.ok(!elegiveis.some((p) => p.produto_id === 5)); // item_fiscal=0
  });

  await test('Teste 06 — Devolução reduz disponibilidade', async () => {
    await run(db, `INSERT INTO vendas_devolucoes
      (venda_id, venda_item_id, produto_id, quantidade, valor_unitario, valor_total, motivo)
      VALUES (10, 1, 1, 10, 10, 100, 'teste')`);
    const elegiveis = await listarProdutosElegiveisDoDia(db, '2026-09-11');
    const pastel = elegiveis.find((p) => p.produto_id === 1);
    assert.ok(pastel);
    assert.strictEqual(toCentavos(pastel.valor_vendido_no_dia), 40000); // 500-100
    assert.strictEqual(pastel.quantidade_disponivel, 40);
  });

  await test('Teste 07/08 — Prévia R$ 700 fecha exatamente', async () => {
    const antes = await snapshotComercial(db);
    const result = await gerarPrevia({
      id: fechamentoId,
      data: '2026-09-11',
      valor_informado: 700,
      valor_alvo: 250,
      valor_min: 80,
      valor_max: 400,
      persistir: true
    }, { db });
    assert.strictEqual(toCentavos(result.previa.valor_informado), 70000);
    assert.strictEqual(toCentavos(result.previa.valor_distribuido), 70000);
    assert.strictEqual(toCentavos(result.previa.diferenca), 0);
    assert.ok(result.previa.vendas.length >= 1);
    const depois = await snapshotComercial(db);
    assert.deepStrictEqual(depois, antes);
    assert.strictEqual(result.protecao.comercial_inalterado, true);
  });

  await test('Teste 09 — Centavos 125.89+98.25+360+115.86 = 700', async () => {
    const soma = somarMoeda([125.89, 98.25, 360, 115.86]);
    assert.strictEqual(toCentavos(soma), 70000);
    // Distribuição artificial reconstruída
    const previa = gerarPreviaDistribuicao(
      [
        { produto_id: 1, nome: 'A', quantidade_disponivel: 100, valor_vendido_no_dia: 700, preco_unitario: 7 }
      ],
      700,
      { valorAlvo: 175, valorMin: 80, valorMax: 400 }
    );
    assert.strictEqual(toCentavos(previa.diferenca), 0);
    assert.strictEqual(toCentavos(previa.valor_distribuido), 70000);
  });

  await test('TESTE CRÍTICO 10/11/12 — estoque/financeiro/vendas inalterados', async () => {
    const antes = await snapshotComercial(db);
    await gerarPrevia({
      data: '2026-09-11',
      valor_informado: 200,
      persistir: false
    }, { db });
    const depois = await snapshotComercial(db);
    assert.strictEqual(depois.estoque_fiscal, antes.estoque_fiscal);
    assert.strictEqual(depois.estoque_nao_fiscal, antes.estoque_nao_fiscal);
    assert.strictEqual(depois.financeiro, antes.financeiro);
    assert.strictEqual(depois.vendas, antes.vendas);
  });

  await test('Remover recebimento recalcula total', async () => {
    const ff = await obterPorId(fechamentoId, { db });
    const rec = ff.recebimentos[0];
    const atualizado = await removerRecebimento(fechamentoId, rec.id, { db });
    assert.strictEqual(atualizado.recebimentos.length, 2);
  });

  await test('Lista vazia apaga todas as máquinas e zera valor informado', async () => {
    const vazio = await substituirRecebimentos(fechamentoId, [], { db });
    assert.strictEqual(vazio.recebimentos.length, 0);
    assert.strictEqual(Number(vazio.valor_informado), 0);
    assert.strictEqual(Number(vazio.quantidade_maquinas), 0);
    const conferido = await obterPorId(fechamentoId, { db });
    assert.strictEqual(conferido.recebimentos.length, 0);
  });

  db.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
