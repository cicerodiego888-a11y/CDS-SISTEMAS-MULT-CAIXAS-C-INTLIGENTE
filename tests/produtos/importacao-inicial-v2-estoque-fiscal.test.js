/**
 * Importador Inicial V2 — estoque fiscal/não fiscal + classificação segura.
 * Executar: node --test tests/produtos/importacao-inicial-v2-estoque-fiscal.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const svc = require('../../backend/services/importacao-inicial-produtos');
const {
  STATUS,
  resolverEstoquesImportacaoLinha,
  resolverItemFiscalProdutoNovo,
  validarNcmImportacao,
  validarCfopImportacao,
  validarCsosnImportacao
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
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
    ...overrides
  };
}

describe('helpers V2 — estoque e item_fiscal', () => {
  it('estoque total = fiscal + não fiscal (unidade base)', () => {
    const r = resolverEstoquesImportacaoLinha({
      estoque_fiscal: 20,
      estoque_nao_fiscal: 10,
      quantidade_documento: 0
    });
    assert.equal(r.modo, 'V2');
    assert.equal(r.estoque_fiscal, 20);
    assert.equal(r.estoque_nao_fiscal, 10);
    assert.equal(r.estoque_total, 30);
  });

  it('conflito V2 + Estoque Inicial legado', () => {
    const r = resolverEstoquesImportacaoLinha({
      estoque_fiscal: 5,
      quantidade_documento: 10,
      fator_conversao: 1
    });
    assert.equal(r.modo, 'CONFLITO');
    assert.ok(r.erro);
  });

  it('item_fiscal novo: só NF → 0; misto/zero → 1', () => {
    assert.equal(resolverItemFiscalProdutoNovo({
      estoqueFiscal: 0, estoqueNaoFiscal: 10, controlaEstoque: true
    }), 0);
    assert.equal(resolverItemFiscalProdutoNovo({
      estoqueFiscal: 10, estoqueNaoFiscal: 5, controlaEstoque: true
    }), 1);
    assert.equal(resolverItemFiscalProdutoNovo({
      estoqueFiscal: 0, estoqueNaoFiscal: 0, controlaEstoque: true
    }), 1);
  });
});

describe('Importação Inicial V2 — 18 cenários', () => {
  let dir;
  let dbPath;
  let pastaBackup;
  let db;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-v2-'));
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

  async function validarEImportar(produtos, nomeArquivo, importId) {
    const buffer = svc.gerarXlsxFixture({ produtos, apresentacoes: [] });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo });
    if (importId && validacao.pode_importar) {
      await executarImportacao(db, validacao, { importId, pastaBackup, dbPath });
    }
    return validacao;
  }

  it('TESTE 01 — produto novo fiscal', async () => {
    const v = await validarEImportar([
      linhaProduto('V2-01', 'NOVO FISCAL', { 'Estoque Fiscal': 10, 'Estoque Não Fiscal': 0 })
    ], 't01.xlsx', 'v2-01');
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    assert.equal(Number(v.linhas[0].produto.item_fiscal), 1);
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-01']);
    assert.equal(Number(p.saldo_fiscal), 10);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), 10);
  });

  it('TESTE 02 — produto novo não fiscal', async () => {
    await validarEImportar([
      linhaProduto('V2-02', 'NOVO NF', { 'Estoque Fiscal': 0, 'Estoque Não Fiscal': 10 })
    ], 't02.xlsx', 'v2-02');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-02']);
    assert.equal(Number(p.item_fiscal), 0);
    assert.equal(Number(p.saldo_fiscal), 0);
    assert.equal(Number(p.saldo_nao_fiscal), 10);
    assert.equal(Number(p.estoque_atual), 10);
  });

  it('TESTE 03 — produto novo misto', async () => {
    await validarEImportar([
      linhaProduto('V2-03', 'NOVO MISTO', { 'Estoque Fiscal': 10, 'Estoque Não Fiscal': 20 })
    ], 't03.xlsx', 'v2-03');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-03']);
    assert.equal(Number(p.item_fiscal), 1);
    assert.equal(Number(p.saldo_fiscal), 10);
    assert.equal(Number(p.saldo_nao_fiscal), 20);
    assert.equal(Number(p.estoque_atual), 30);
  });

  it('TESTE 04 — produto sem estoque', async () => {
    await validarEImportar([
      linhaProduto('V2-04', 'SEM EST', { 'Estoque Fiscal': 0, 'Estoque Não Fiscal': 0 })
    ], 't04.xlsx', 'v2-04');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-04']);
    assert.equal(Number(p.estoque_atual), 0);
    assert.equal(Number(p.item_fiscal), 1);
  });

  it('TESTE 05 — não controla estoque (zero)', async () => {
    const v = await validarEImportar([
      linhaProduto('V2-05', 'SEM CTRL', {
        'Controla Estoque': 'NÃO',
        'Estoque Fiscal': 0,
        'Estoque Não Fiscal': 0
      })
    ], 't05.xlsx', 'v2-05');
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-05']);
    assert.equal(Number(p.controla_estoque), 0);
    assert.equal(Number(p.estoque_atual), 0);
  });

  it('TESTE 06 — não controla + estoque fiscal → ERRO', async () => {
    const v = await validarEImportar([
      linhaProduto('V2-06', 'ERR F', {
        'Controla Estoque': 'NÃO',
        'Estoque Fiscal': 10
      })
    ], 't06.xlsx');
    assert.equal(v.linhas[0].status, STATUS.ERRO);
    assert.ok((v.linhas[0].mensagens || []).some((m) => /não controlar estoque/i.test(m)));
  });

  it('TESTE 07 — não controla + estoque não fiscal → ERRO', async () => {
    const v = await validarEImportar([
      linhaProduto('V2-07', 'ERR NF', {
        'Controla Estoque': 'NÃO',
        'Estoque Não Fiscal': 10
      })
    ], 't07.xlsx');
    assert.equal(v.linhas[0].status, STATUS.ERRO);
  });

  it('TESTE 08 — produto existente não duplica', async () => {
    await run(db, `INSERT INTO produtos (
      codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
      estoque_atual, controla_estoque, saldo_fiscal, saldo_nao_fiscal, item_fiscal
    ) VALUES ('V2-08', 'EXISTENTE MATCH', 'UN', 1, 100, 2, 0, 1, 0, 0, 1)`);
    const v = await validarEImportar([
      linhaProduto('V2-08', 'EXISTENTE MATCH', {
        'Estoque Fiscal': 5,
        'Estoque Não Fiscal': 3
      })
    ], 't08.xlsx', 'v2-08');
    assert.ok(['EXISTENTE_ATUALIZAR', 'EXISTENTE', 'EXISTENTE_APRESENTACAO_NOVA'].includes(v.linhas[0].status));
    const rows = await all(db, `SELECT id FROM produtos WHERE codigo = ?`, ['V2-08']);
    assert.equal(rows.length, 1);
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-08']);
    assert.equal(Number(p.saldo_fiscal), 5);
    assert.equal(Number(p.saldo_nao_fiscal), 3);
    assert.equal(Number(p.estoque_atual), 8);
  });

  it('TESTE 09 — existente classificado preserva + preview divergência', async () => {
    await run(db, `INSERT INTO produtos (
      codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
      estoque_atual, controla_estoque, saldo_fiscal, saldo_nao_fiscal, item_fiscal,
      ncm, cfop, csosn
    ) VALUES ('V2-09', 'CLASSIF', 'UN', 1, 100, 2, 0, 1, 0, 0, 1,
      '22021000', '5102', '102')`);
    const v = await validarEImportar([
      linhaProduto('V2-09', 'CLASSIF', {
        'Estoque Fiscal': 1,
        NCM: '22029900',
        CFOP: '5405',
        CSOSN: '500'
      })
    ], 't09.xlsx', 'v2-09');
    assert.ok((v.linhas[0].divergencias_fiscais || []).length >= 3);
    const p = await get(db, `SELECT ncm, cfop, csosn FROM produtos WHERE codigo = ?`, ['V2-09']);
    assert.equal(p.ncm, '22021000');
    assert.equal(p.cfop, '5102');
    assert.equal(p.csosn, '102');
  });

  it('TESTE 10 — existente sem NCM completa', async () => {
    await run(db, `INSERT INTO produtos (
      codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
      estoque_atual, controla_estoque, item_fiscal, ncm, cfop, csosn
    ) VALUES ('V2-10', 'SEM NCM', 'UN', 1, 100, 2, 0, 1, 1, NULL, '5102', '102')`);
    await validarEImportar([
      linhaProduto('V2-10', 'SEM NCM', { NCM: '22021000', 'Estoque Fiscal': 0 })
    ], 't10.xlsx', 'v2-10');
    const p = await get(db, `SELECT ncm FROM produtos WHERE codigo = ?`, ['V2-10']);
    assert.equal(p.ncm, '22021000');
  });

  it('TESTE 11 — existente sem CFOP completa', async () => {
    await run(db, `INSERT INTO produtos (
      codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
      estoque_atual, controla_estoque, item_fiscal, ncm, cfop, csosn
    ) VALUES ('V2-11', 'SEM CFOP', 'UN', 1, 100, 2, 0, 1, 1, '22021000', NULL, '102')`);
    await validarEImportar([
      linhaProduto('V2-11', 'SEM CFOP', { CFOP: '5102', 'Estoque Fiscal': 0 })
    ], 't11.xlsx', 'v2-11');
    const p = await get(db, `SELECT cfop FROM produtos WHERE codigo = ?`, ['V2-11']);
    assert.equal(p.cfop, '5102');
  });

  it('TESTE 12 — existente sem CSOSN completa', async () => {
    await run(db, `INSERT INTO produtos (
      codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
      estoque_atual, controla_estoque, item_fiscal, ncm, cfop, csosn
    ) VALUES ('V2-12', 'SEM CSOSN', 'UN', 1, 100, 2, 0, 1, 1, '22021000', '5102', NULL)`);
    await validarEImportar([
      linhaProduto('V2-12', 'SEM CSOSN', { CSOSN: '102', 'Estoque Fiscal': 0 })
    ], 't12.xlsx', 'v2-12');
    const p = await get(db, `SELECT csosn FROM produtos WHERE codigo = ?`, ['V2-12']);
    assert.equal(p.csosn, '102');
  });

  it('TESTE 13 — NCM inválido', async () => {
    assert.equal(validarNcmImportacao('220210').ok, false);
    const v = await validarEImportar([
      linhaProduto('V2-13', 'NCM BAD', { NCM: '220210', 'Estoque Fiscal': 1 })
    ], 't13.xlsx');
    assert.equal(v.linhas[0].status, STATUS.ERRO);
  });

  it('TESTE 14 — CFOP inválido', async () => {
    assert.equal(validarCfopImportacao('51').ok, false);
    const v = await validarEImportar([
      linhaProduto('V2-14', 'CFOP BAD', { CFOP: '51', 'Estoque Fiscal': 1 })
    ], 't14.xlsx');
    assert.equal(v.linhas[0].status, STATUS.ERRO);
  });

  it('TESTE 15 — CSOSN inválido', async () => {
    assert.equal(validarCsosnImportacao('999').ok, false);
    const v = await validarEImportar([
      linhaProduto('V2-15', 'CSOSN BAD', { CSOSN: '999', 'Estoque Fiscal': 1 })
    ], 't15.xlsx');
    assert.equal(v.linhas[0].status, STATUS.ERRO);
  });

  it('TESTE 16 — idempotência', async () => {
    const produtos = [
      linhaProduto('V2-16', 'IDEM', { 'Estoque Fiscal': 10, 'Estoque Não Fiscal': 5 })
    ];
    const v1 = await validarEImportar(produtos, 't16.xlsx', 'v2-16');
    assert.equal(v1.pode_importar, true);
    const v2 = await validarEImportar(produtos, 't16.xlsx', 'v2-16');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-16']);
    assert.equal(Number(p.saldo_fiscal), 10);
    assert.equal(Number(p.saldo_nao_fiscal), 5);
    assert.equal(Number(p.estoque_atual), 15);
    const movs = await all(
      db,
      `SELECT id FROM produtos_ajustes_estoque WHERE produto_id = ?`,
      [p.id]
    );
    assert.equal(movs.length, 1);
    assert.ok(v2);
  });

  it('TESTE 17 — estoque_atual = fiscal + não fiscal', async () => {
    await validarEImportar([
      linhaProduto('V2-17', 'SOMA', { 'Estoque Fiscal': 7, 'Estoque Não Fiscal': 8 })
    ], 't17.xlsx', 'v2-17');
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V2-17']);
    assert.equal(Number(p.estoque_atual), Number(p.saldo_fiscal) + Number(p.saldo_nao_fiscal));
  });

  it('TESTE 18 — misto não cria dois produtos', async () => {
    await validarEImportar([
      linhaProduto('V2-18', 'UNICO', { 'Estoque Fiscal': 10, 'Estoque Não Fiscal': 10 })
    ], 't18.xlsx', 'v2-18');
    const rows = await all(db, `SELECT * FROM produtos WHERE nome = ?`, ['UNICO']);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].estoque_atual), 20);
  });

  it('ACEITE — planilha mista A–E', async () => {
    const v = await validarEImportar([
      linhaProduto('A', 'Prod A', { 'Estoque Fiscal': 20, 'Estoque Não Fiscal': 0 }),
      linhaProduto('B', 'Prod B', { 'Estoque Fiscal': 0, 'Estoque Não Fiscal': 15 }),
      linhaProduto('C', 'Prod C', { 'Estoque Fiscal': 10, 'Estoque Não Fiscal': 5 }),
      linhaProduto('D', 'Prod D', { 'Estoque Fiscal': 0, 'Estoque Não Fiscal': 0 }),
      linhaProduto('E', 'Prod E', {
        'Controla Estoque': 'NÃO',
        'Estoque Fiscal': 0,
        'Estoque Não Fiscal': 0
      })
    ], 'aceite.xlsx', 'v2-aceite');
    assert.equal(v.resumo.com_erro || 0, 0);
    const a = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['A']);
    const b = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['B']);
    const c = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['C']);
    const d = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['D']);
    const e = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['E']);
    assert.equal(Number(a.estoque_atual), 20);
    assert.equal(Number(b.estoque_atual), 15);
    assert.equal(Number(c.estoque_atual), 15);
    assert.equal(Number(d.estoque_atual), 0);
    assert.equal(Number(e.estoque_atual), 0);
    assert.equal(Number(e.controla_estoque), 0);
    const total = await get(db, `SELECT COUNT(*) AS n FROM produtos`);
    assert.equal(Number(total.n), 5);
  });

  it('produto novo recebe NCM/CFOP/CSOSN da planilha', async () => {
    await validarEImportar([
      linhaProduto('V2-N', 'NOVO CLASS', {
        'Estoque Fiscal': 1,
        NCM: '22021000',
        CFOP: '5102',
        CSOSN: '102'
      })
    ], 'novo-class.xlsx', 'v2-n');
    const p = await get(db, `SELECT ncm, cfop, csosn FROM produtos WHERE codigo = ?`, ['V2-N']);
    assert.equal(p.ncm, '22021000');
    assert.equal(p.cfop, '5102');
    assert.equal(p.csosn, '102');
  });
});
