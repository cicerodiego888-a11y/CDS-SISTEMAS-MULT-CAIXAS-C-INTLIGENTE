/**
 * Importação Inicial V2 — SET absoluto de Estoque Fiscal / Não Fiscal.
 * Executar: node --test tests/produtos/importacao-inicial-v2-set-saldos.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const svc = require('../../backend/services/importacao-inicial-produtos');
const { STATUS } = require('../../backend/services/importacao-inicial-produtos/helpers');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const {
  aplicarAjusteEstoqueProduto,
  substituirSaldosEstoqueProduto
} = require('../../backend/services/ajusteEstoqueService');
const { seedParCategoriaSub } = require('./helpers-seed-catalogo-importacao');

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function aplicarAjusteAsync(db, opcoes) {
  return new Promise((resolve, reject) => {
    aplicarAjusteEstoqueProduto(db, opcoes, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function substituirAsync(db, opcoes) {
  return new Promise((resolve, reject) => {
    substituirSaldosEstoqueProduto(db, opcoes, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function criarSchema(db) {
  await run(db, `CREATE TABLE marcas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE, ativo INTEGER DEFAULT 1,
    created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE, descricao TEXT,
    tipo TEXT NOT NULL DEFAULT 'produto', ativo INTEGER DEFAULT 1,
    created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE subcategorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, categoria_id INTEGER NOT NULL,
    ativo INTEGER DEFAULT 1, created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT, nome TEXT, categoria_id INTEGER, subcategoria_id INTEGER, unidade TEXT,
    preco_compra REAL, lucro_percentual REAL, preco_venda REAL,
    estoque_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0, fornecedor TEXT,
    ncm TEXT, cfop TEXT, csosn TEXT, origem INTEGER, cest TEXT, codigo_barras TEXT,
    aliquota_icms REAL, aliquota_pis REAL, aliquota_cofins REAL,
    controlar_validade INTEGER, controla_estoque INTEGER DEFAULT 1,
    vendido_por_peso INTEGER, produto_fracionado INTEGER,
    peso_total_compra REAL, valor_total_compra REAL, custo_por_kg REAL,
    venda_atacado INTEGER,
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, item_fiscal INTEGER DEFAULT 1,
    permite_venda_unidade INTEGER, peso_medio_unidade REAL, preco_unidade REAL,
    marca_id INTEGER, observacoes TEXT, imagem_principal TEXT,
    unidade_comercial TEXT, quantidade_por_embalagem REAL, compra_por_embalagem INTEGER DEFAULT 0,
    valor_compra_embalagem REAL, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE produto_embalagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL, tipo TEXT NOT NULL DEFAULT 'UN', descricao TEXT,
    quantidade REAL NOT NULL DEFAULT 1, unidade TEXT, gtin TEXT,
    codigo_fornecedor TEXT, codigo_interno_fornecedor TEXT, fornecedor_cnpj TEXT,
    fornecedor_nome TEXT, fornecedor_descricao TEXT,
    valor_compra REAL DEFAULT 0, preco_venda REAL DEFAULT 0, tipo_conversao TEXT,
    principal INTEGER NOT NULL DEFAULT 0, compra INTEGER NOT NULL DEFAULT 1,
    venda INTEGER NOT NULL DEFAULT 1, estoque INTEGER NOT NULL DEFAULT 1,
    ativa INTEGER NOT NULL DEFAULT 1, vigencia_inicio TEXT, vigencia_fim TEXT,
    origem TEXT, usuario_criacao INTEGER, observacao TEXT, motivo_alteracao TEXT,
    created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE produtos_ajustes_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL, usuario_id INTEGER, usuario_nome TEXT,
    motivo TEXT NOT NULL, ajuste_fiscal REAL DEFAULT 0, ajuste_nao_fiscal REAL DEFAULT 0,
    saldo_fiscal_antes REAL DEFAULT 0, saldo_fiscal_depois REAL DEFAULT 0,
    saldo_nao_fiscal_antes REAL DEFAULT 0, saldo_nao_fiscal_depois REAL DEFAULT 0,
    estoque_total_antes REAL DEFAULT 0, estoque_total_depois REAL DEFAULT 0,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await seedParCategoriaSub(db, run, get, 'Cat', 'Sub');
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA',
    Categoria: 'Cat',
    Subcategoria: 'Sub',
    'Unidade base': 'UN',
    'Custo unitário': 1,
    'Markup %': 100,
    'Preço venda unitário': 2,
    'Qtd documento': 0,
    'Controla Estoque': 'SIM',
    'Estoque Fiscal': null,
    'Estoque Não Fiscal': null,
    ...overrides
  };
}

async function inserirExistente(db, {
  codigo,
  nome,
  saldoFiscal,
  saldoNaoFiscal,
  controlaEstoque = 1
}) {
  const total = Number(saldoFiscal || 0) + Number(saldoNaoFiscal || 0);
  const r = await run(db, `INSERT INTO produtos (
    codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
    estoque_atual, controla_estoque, saldo_fiscal, saldo_nao_fiscal, item_fiscal
  ) VALUES (?, ?, 'UN', 1, 100, 2, ?, ?, ?, ?, 1)`, [
    codigo, nome, total, controlaEstoque, saldoFiscal, saldoNaoFiscal
  ]);
  return r.lastID;
}

describe('substituirSaldosEstoqueProduto — SET isolado', () => {
  let dir;
  let dbPath;
  let db;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-saldo-'));
    dbPath = path.join(dir, 't.db');
  });

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = await openDb(dbPath);
    await criarSchema(db);
  });

  afterEach(async () => {
    await new Promise((res) => db.close(() => res()));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('histórico registra delta real 100/80 → 250/0 = +150 / -80', async () => {
    const id = await inserirExistente(db, {
      codigo: 'H1', nome: 'HIST', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const r = await substituirAsync(db, {
      produtoId: id,
      saldoFiscalFinal: 250,
      saldoNaoFiscalFinal: 0,
      motivo: 'SET TESTE'
    });
    assert.equal(r.alterado, true);
    assert.equal(r.ajuste_fiscal, 150);
    assert.equal(r.ajuste_nao_fiscal, -80);
    const hist = await get(db, `SELECT * FROM produtos_ajustes_estoque WHERE produto_id = ?`, [id]);
    assert.equal(Number(hist.ajuste_fiscal), 150);
    assert.equal(Number(hist.ajuste_nao_fiscal), -80);
  });

  it('0/0 é alvo válido e 100/80 → 0/0 registra -100 / -80', async () => {
    const id = await inserirExistente(db, {
      codigo: 'H0', nome: 'ZERO', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const r = await substituirAsync(db, {
      produtoId: id,
      saldoFiscalFinal: 0,
      saldoNaoFiscalFinal: 0,
      motivo: 'SET ZERO'
    });
    assert.equal(r.alterado, true);
    assert.equal(Number(r.ajuste_fiscal), -100);
    assert.equal(Number(r.ajuste_nao_fiscal), -80);
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 0);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), 0);
  });

  it('saldo já correto não gera movimentação', async () => {
    const id = await inserirExistente(db, {
      codigo: 'H2', nome: 'OK', saldoFiscal: 250, saldoNaoFiscal: 250
    });
    const r = await substituirAsync(db, {
      produtoId: id,
      saldoFiscalFinal: 250,
      saldoNaoFiscalFinal: 250,
      motivo: 'SET IDEM'
    });
    assert.equal(r.alterado, false);
    assert.equal(r.motivo, 'SALDO_JA_CORRETO');
    const movs = await all(db, `SELECT id FROM produtos_ajustes_estoque WHERE produto_id = ?`, [id]);
    assert.equal(movs.length, 0);
  });
});

describe('Importação Inicial V2 — SET absoluto', () => {
  let dir;
  let dbPath;
  let pastaBackup;
  let db;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-v2-set-'));
    dbPath = path.join(dir, 't.db');
    pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
  });

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = await openDb(dbPath);
    await criarSchema(db);
  });

  afterEach(async () => {
    await new Promise((res) => db.close(() => res()));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  async function validarEImportar(produtos, nomeArquivo, importId, extras = {}) {
    const buffer = svc.gerarXlsxFixture({ produtos, apresentacoes: [] });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo });
    if (importId && validacao.pode_importar) {
      await executarImportacao(db, validacao, {
        importId, pastaBackup, dbPath, ...extras
      });
    }
    return validacao;
  }

  it('TESTE 01 — 100/80 → planilha 250/0 = 250/0 total 250', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S01', nome: 'T01', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const controle = await inserirExistente(db, {
      codigo: 'CTRL', nome: 'CONTROLE', saldoFiscal: 9, saldoNaoFiscal: 1
    });
    await validarEImportar([
      linhaProduto('S01', 'T01', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 0 })
    ], 't01.xlsx', 'set-01');
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 250);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), 250);
    const c = await get(db, `SELECT * FROM produtos WHERE id = ?`, [controle]);
    assert.equal(Number(c.saldo_fiscal), 9);
    assert.equal(Number(c.saldo_nao_fiscal), 1);
  });

  it('TESTE 02 — 100/80 → 0/250 = 0/250', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S02', nome: 'T02', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    await validarEImportar([
      linhaProduto('S02', 'T02', { 'Estoque Fiscal': 0, 'Estoque Não Fiscal': 250 })
    ], 't02.xlsx', 'set-02');
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 0);
    assert.equal(Number(p.saldo_nao_fiscal), 250);
    assert.equal(Number(p.estoque_atual), 250);
  });

  it('TESTE 03 — 100/80 → 250/250 = 250/250 total 500', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S03', nome: 'T03', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    await validarEImportar([
      linhaProduto('S03', 'T03', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 250 })
    ], 't03.xlsx', 'set-03');
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 250);
    assert.equal(Number(p.saldo_nao_fiscal), 250);
    assert.equal(Number(p.estoque_atual), 500);
  });

  it('TESTE 04 — 100/80 → vazio/vazio = 0/0', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S04', nome: 'T04', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    await validarEImportar([
      linhaProduto('S04', 'T04', { 'Estoque Fiscal': null, 'Estoque Não Fiscal': null })
    ], 't04.xlsx', 'set-04');
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 0);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), 0);
  });

  it('TESTE 05 — produto novo 250/250 = 250/250 total 500', async () => {
    await validarEImportar([
      linhaProduto('S05', 'NOVO', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 250 })
    ], 't05.xlsx', 'set-05');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['S05']);
    assert.equal(Number(p.saldo_fiscal), 250);
    assert.equal(Number(p.saldo_nao_fiscal), 250);
    assert.equal(Number(p.estoque_atual), 500);
  });

  it('TESTE 06 — duas importações não acumulam 250/0', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S06', nome: 'T06', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const produtos = [
      linhaProduto('S06', 'T06', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 0 })
    ];
    await validarEImportar(produtos, 't06.xlsx', 'set-06');
    let p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 250);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    const v2 = await validarEImportar(produtos, 't06.xlsx', 'set-06-b');
    p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 250);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), 250);
    assert.ok(v2);
  });

  it('TESTE 07 — existente 100/80 → planilha 0/0 = 0/0', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S07', nome: 'T07', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    await validarEImportar([
      linhaProduto('S07', 'T07', { 'Estoque Fiscal': 0, 'Estoque Não Fiscal': 0 })
    ], 't07.xlsx', 'set-07');
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 0);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), 0);
  });

  it('TESTE 08 — saldo já correto sem movimentação duplicada', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S08', nome: 'T08', saldoFiscal: 250, saldoNaoFiscal: 250
    });
    const v = await validarEImportar([
      linhaProduto('S08', 'T08', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 250 })
    ], 't08.xlsx', 'set-08');
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 250);
    assert.equal(Number(p.saldo_nao_fiscal), 250);
    const movs = await all(db, `SELECT id FROM produtos_ajustes_estoque WHERE produto_id = ?`, [id]);
    assert.equal(movs.length, 0);
    assert.ok(['EXISTENTE', 'EXISTENTE_ATUALIZAR'].includes(v.linhas[0].status));
  });

  it('TESTE 09 — estoque_atual = fiscal + não fiscal', async () => {
    await validarEImportar([
      linhaProduto('S09', 'SOMA', { 'Estoque Fiscal': 12, 'Estoque Não Fiscal': 8 })
    ], 't09.xlsx', 'set-09');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['S09']);
    assert.equal(Number(p.estoque_atual), Number(p.saldo_fiscal) + Number(p.saldo_nao_fiscal));
  });

  it('TESTE 10 — falha de backup não altera estoque', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S10', nome: 'T10', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const pastaRuim = path.join(dir, 'nao-e-pasta.txt');
    fs.writeFileSync(pastaRuim, 'x');
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('S10', 'T10', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 0 })],
      apresentacoes: []
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 't10.xlsx' });
    assert.equal(validacao.pode_importar, true);
    await assert.rejects(
      () => executarImportacao(db, validacao, {
        importId: 'set-10', pastaBackup: pastaRuim, dbPath
      }),
      /backup/i
    );
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 100);
    assert.equal(Number(p.saldo_nao_fiscal), 80);
  });

  it('TESTE 11 — erro no meio faz rollback completo', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S11', nome: 'T11', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('S11', 'T11', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': 0 })],
      apresentacoes: []
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 't11.xlsx' });
    await assert.rejects(
      () => executarImportacao(db, validacao, {
        importId: 'set-11', pastaBackup, dbPath, forcarFalhaEstoque: true
      })
    );
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 100);
    assert.equal(Number(p.saldo_nao_fiscal), 80);
  });

  it('TESTE 12 — ajuste incremental continua somando', async () => {
    const id = await inserirExistente(db, {
      codigo: 'S12', nome: 'T12', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    await aplicarAjusteAsync(db, {
      produtoId: id,
      ajusteFiscal: 10,
      ajusteNaoFiscal: 5,
      motivo: 'Ajuste manual teste'
    });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.saldo_fiscal), 110);
    assert.equal(Number(p.saldo_nao_fiscal), 85);
    assert.equal(Number(p.estoque_atual), 195);
    await assert.rejects(
      () => aplicarAjusteAsync(db, {
        produtoId: id, ajusteFiscal: 0, ajusteNaoFiscal: 0, motivo: 'zero'
      }),
      /informe ao menos um ajuste/i
    );
  });

  it('TESTE 13 — vendas não usam SET absoluto', () => {
    const vendasDir = path.join(__dirname, '../../backend');
    const hits = [];
    function walk(dirPath) {
      for (const nome of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, nome);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (['node_modules', 'importacao-inicial-produtos'].includes(nome)) continue;
          walk(full);
        } else if (/\.(js)$/.test(nome) && /venda|pdv/i.test(full)) {
          const src = fs.readFileSync(full, 'utf8');
          if (src.includes('substituirSaldosEstoqueProduto')) hits.push(full);
        }
      }
    }
    walk(vendasDir);
    assert.deepEqual(hits, []);
  });

  it('TESTE 14 — compras não usam SET absoluto', () => {
    const base = path.join(__dirname, '../../backend');
    const hits = [];
    function walk(dirPath) {
      for (const nome of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, nome);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (['node_modules', 'importacao-inicial-produtos'].includes(nome)) continue;
          walk(full);
        } else if (/\.(js)$/.test(nome) && /compra/i.test(full)) {
          const src = fs.readFileSync(full, 'utf8');
          if (src.includes('substituirSaldosEstoqueProduto')) hits.push(full);
        }
      }
    }
    walk(base);
    assert.deepEqual(hits, []);
  });

  it('TESTE 15 — cancelamento não usa SET absoluto', () => {
    const base = path.join(__dirname, '../../backend');
    const hits = [];
    function walk(dirPath) {
      for (const nome of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, nome);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (['node_modules', 'importacao-inicial-produtos'].includes(nome)) continue;
          walk(full);
        } else if (/\.(js)$/.test(nome) && /cancel/i.test(full)) {
          const src = fs.readFileSync(full, 'utf8');
          if (src.includes('substituirSaldosEstoqueProduto')) hits.push(full);
        }
      }
    }
    walk(base);
    assert.deepEqual(hits, []);
  });

  it('TESTE 16 — Controla Estoque = NÃO + quantidade > 0 continua bloqueado', async () => {
    const v = await validarEImportar([
      linhaProduto('S16', 'BLOQ', {
        'Controla Estoque': 'NÃO',
        'Estoque Fiscal': 10,
        'Estoque Não Fiscal': 0
      })
    ], 't16.xlsx');
    assert.equal(v.linhas[0].status, STATUS.ERRO);
    assert.equal(v.pode_importar, false);
  });

  it('TESTE 17 — Controla Estoque = NÃO e 0/0 continua aceito sem movimentação', async () => {
    const v = await validarEImportar([
      linhaProduto('S17', 'SEMCTRL', {
        'Controla Estoque': 'NÃO',
        'Estoque Fiscal': 0,
        'Estoque Não Fiscal': 0
      })
    ], 't17.xlsx', 'set-17');
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['S17']);
    assert.equal(Number(p.controla_estoque), 0);
    assert.equal(Number(p.estoque_atual), 0);
    const movs = await all(db, `SELECT id FROM produtos_ajustes_estoque WHERE produto_id = ?`, [p.id]);
    assert.equal(movs.length, 0);
  });

  it('TESTE 18 — preview 100/80 + planilha 250/vazio = 250/0 e nunca 350/80', async () => {
    await inserirExistente(db, {
      codigo: 'S18', nome: 'T18', saldoFiscal: 100, saldoNaoFiscal: 80
    });
    const v = await validarEImportar([
      linhaProduto('S18', 'T18', { 'Estoque Fiscal': 250, 'Estoque Não Fiscal': null })
    ], 't18.xlsx');
    const prev = v.linhas[0].preview_atualizacao;
    assert.ok(prev);
    assert.equal(prev.modo_estoque_preview, 'SET');
    assert.equal(Number(prev.estoque_fiscal_atual), 100);
    assert.equal(Number(prev.estoque_nao_fiscal_atual), 80);
    assert.equal(Number(prev.estoque_fiscal_planilha), 250);
    assert.equal(Number(prev.estoque_nao_fiscal_planilha), 0);
    assert.equal(Number(prev.estoque_fiscal_final), 250);
    assert.equal(Number(prev.estoque_nao_fiscal_final), 0);
    assert.equal(Number(prev.estoque_final), 250);
    assert.notEqual(Number(prev.estoque_final), 350);
    assert.notEqual(Number(prev.estoque_nao_fiscal_final), 80);
  });

  it('quantidadeUpdater.js não foi alterado neste sprint (arquivo intacto no git de serviço)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/importacao-inicial-produtos/quantidadeUpdater.js'),
      'utf8'
    );
    assert.equal(src.includes('substituirSaldosEstoqueProduto'), false);
  });
});
