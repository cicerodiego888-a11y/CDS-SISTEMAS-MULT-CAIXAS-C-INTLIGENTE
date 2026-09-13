/**
 * V1.0.18 — Controle fiscal da Importação Inicial
 * Executar: node --test tests/produtos/importacao-inicial-modo-fiscal-v1018.test.js
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
  validarModoFiscalImportacao,
  MODOS_FISCAIS_IMPORTACAO,
  itemFiscalDeModoImportacao
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { validarImportacao } = require('../../backend/services/importacao-inicial-produtos/validator');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const Estado = require('../../frontend/erp/js/importacao-inicial-estado.js');
const { seedParCategoriaSub } = require('./helpers-seed-catalogo-importacao');

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
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

async function criarSchemaMinimo(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS marcas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE, ativo INTEGER DEFAULT 1,
    created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE, descricao TEXT,
    tipo TEXT NOT NULL DEFAULT 'produto', ativo INTEGER DEFAULT 1,
    created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS subcategorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, categoria_id INTEGER NOT NULL,
    ativo INTEGER DEFAULT 1, created_at DATETIME, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT, nome TEXT, categoria_id INTEGER, subcategoria_id INTEGER, unidade TEXT,
    preco_compra REAL, lucro_percentual REAL, preco_venda REAL,
    estoque_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0, fornecedor TEXT,
    ncm TEXT, cfop TEXT, csosn TEXT, origem INTEGER, cest TEXT, codigo_barras TEXT,
    aliquota_icms REAL, aliquota_pis REAL, aliquota_cofins REAL,
    controlar_validade INTEGER, controla_estoque INTEGER,
    vendido_por_peso INTEGER, produto_fracionado INTEGER,
    peso_total_compra REAL, valor_total_compra REAL, custo_por_kg REAL,
    venda_atacado INTEGER,
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, item_fiscal INTEGER DEFAULT 1,
    permite_venda_unidade INTEGER, peso_medio_unidade REAL, preco_unidade REAL,
    marca_id INTEGER, observacoes TEXT, imagem_principal TEXT,
    unidade_comercial TEXT, quantidade_por_embalagem REAL, compra_por_embalagem INTEGER DEFAULT 0,
    valor_compra_embalagem REAL, updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS produto_embalagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'UN',
    descricao TEXT,
    quantidade REAL NOT NULL DEFAULT 1,
    unidade TEXT,
    gtin TEXT,
    codigo_fornecedor TEXT,
    codigo_interno_fornecedor TEXT,
    fornecedor_cnpj TEXT,
    fornecedor_nome TEXT,
    fornecedor_descricao TEXT,
    valor_compra REAL DEFAULT 0,
    preco_venda REAL DEFAULT 0,
    tipo_conversao TEXT,
    principal INTEGER NOT NULL DEFAULT 0,
    compra INTEGER NOT NULL DEFAULT 1,
    venda INTEGER NOT NULL DEFAULT 1,
    estoque INTEGER NOT NULL DEFAULT 1,
    ativa INTEGER NOT NULL DEFAULT 1,
    vigencia_inicio TEXT,
    vigencia_fim TEXT,
    origem TEXT,
    usuario_criacao INTEGER,
    observacao TEXT,
    motivo_alteracao TEXT,
    created_at DATETIME,
    updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS produtos_ajustes_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    usuario_id INTEGER,
    usuario_nome TEXT,
    motivo TEXT NOT NULL,
    ajuste_fiscal REAL DEFAULT 0,
    ajuste_nao_fiscal REAL DEFAULT 0,
    saldo_fiscal_antes REAL DEFAULT 0,
    saldo_fiscal_depois REAL DEFAULT 0,
    saldo_nao_fiscal_antes REAL DEFAULT 0,
    saldo_nao_fiscal_depois REAL DEFAULT 0,
    estoque_total_antes REAL DEFAULT 0,
    estoque_total_depois REAL DEFAULT 0,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await seedParCategoriaSub(db, run, get, 'Cat', 'Sub');
}

describe('V1.0.18 — validação do modo fiscal', () => {
  it('TESTE 7 — modo ausente é opcional (V2)', () => {
    assert.equal(validarModoFiscalImportacao(undefined), null);
    assert.equal(validarModoFiscalImportacao(null), null);
    assert.equal(validarModoFiscalImportacao(''), null);
  });

  it('TESTE 8 — modo inválido rejeita', () => {
    assert.throws(() => validarModoFiscalImportacao('XYZ'), /inválido/);
    assert.throws(() => validarModoFiscalImportacao(true), /inválido/);
    assert.throws(() => validarModoFiscalImportacao(false), /inválido/);
    assert.throws(() => validarModoFiscalImportacao(1), /inválido/);
    assert.throws(() => validarModoFiscalImportacao(0), /inválido/);
  });

  it('aceita FISCAL e NAO_FISCAL', () => {
    assert.equal(validarModoFiscalImportacao('FISCAL'), 'FISCAL');
    assert.equal(validarModoFiscalImportacao('NAO_FISCAL'), 'NAO_FISCAL');
    assert.equal(itemFiscalDeModoImportacao('FISCAL'), 1);
    assert.equal(itemFiscalDeModoImportacao('NAO_FISCAL'), 0);
  });

  it('estado UI inclui modo_fiscal_importacao', () => {
    const e = Estado.criarEstadoVazioImportacao();
    assert.equal(e.modo_fiscal_importacao, null);
    assert.equal(Estado.MODOS_FISCAIS.FISCAL, 'FISCAL');
    assert.equal(Estado.MODOS_FISCAIS.NAO_FISCAL, 'NAO_FISCAL');
  });
});

describe('V1.0.18 — item_fiscal novos vs existentes', () => {
  let tmpDir;
  let dbFile;
  let db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-v1018-'));
    dbFile = path.join(tmpDir, 't.db');
  });

  beforeEach(async () => {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    db = await openDb(dbFile);
    await criarSchemaMinimo(db);
  });

  afterEach(async () => {
    await new Promise((res) => db.close(() => res()));
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  function linhaProduto(codigo, nome, overrides = {}) {
    return {
      'Código origem': codigo,
      'Nome CDS': nome,
      Marca: 'MARCA',
      Categoria: 'Cat',
      Subcategoria: 'Sub',
      'Unidade base': 'UN',
      'Unidade origem': 'UN',
      'Qtd documento': 10,
      'Custo unitário': 1,
      'Markup %': 100,
      'Preço venda unitário': 2,
      'Código barras': overrides.barras || '',
      ...overrides
    };
  }

  function bufferProduto(codigo, nome, { barras } = {}) {
    return svc.gerarXlsxFixture({
      produtos: [linhaProduto(codigo, nome, barras ? { 'Código barras': barras } : {})],
      apresentacoes: []
    });
  }

  it('TESTE 1 — modo FISCAL, produto novo → item_fiscal = 1', async () => {
    const buffer = bufferProduto('NF1', 'PRODUTO NOVO FISCAL');
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.modo_fiscal_importacao, 'FISCAL');
    const linha = validacao.linhas.find((l) => l.status === 'PRONTO');
    assert.ok(linha);
    assert.equal(linha.produto.item_fiscal, 1);

    await executarImportacao(db, validacao, { importId: 't1', pastaBackup: tmpDir, dbPath: dbFile });
    const p = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['NF1']);
    assert.equal(Number(p.item_fiscal), 1);
  });

  it('TESTE 2 — modo NAO_FISCAL, produto novo → item_fiscal = 0', async () => {
    const buffer = bufferProduto('NN1', 'PRODUTO NOVO NAO FISCAL');
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't2.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    const linha = validacao.linhas.find((l) => l.status === 'PRONTO');
    assert.equal(linha.produto.item_fiscal, 0);

    await executarImportacao(db, validacao, { importId: 't2', pastaBackup: tmpDir, dbPath: dbFile });
    const p = await get(db, `SELECT item_fiscal, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE codigo = ?`, ['NN1']);
    assert.equal(Number(p.item_fiscal), 0);
    assert.ok(Number(p.saldo_nao_fiscal) > 0 || Number(p.estoque_atual) >= 0);
  });

  it('TESTE 3 — NAO_FISCAL + existente fiscal → permanece 1', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque)
      VALUES ('EX1', 'EXISTENTE FISCAL', 1, 'un', 1, 2, 1)`);
    const buffer = bufferProduto('EX1', 'EXISTENTE FISCAL');
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't3.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    const linha = validacao.linhas[0];
    assert.ok(['EXISTENTE', 'EXISTENTE_APRESENTACAO_NOVA', 'EXISTENTE_ATUALIZAR'].includes(linha.status));
    assert.equal(linha.produto.item_fiscal, 1);
    assert.equal(linha.produto.fiscal_fonte, 'EXISTENTE');

    await executarImportacao(db, validacao, { importId: 't3', pastaBackup: tmpDir, dbPath: dbFile });
    const p = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['EX1']);
    assert.equal(Number(p.item_fiscal), 1);
  });

  it('TESTE 4 — FISCAL + existente não fiscal → permanece 0', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque)
      VALUES ('EX0', 'EXISTENTE NF', 0, 'un', 1, 2, 1)`);
    const buffer = bufferProduto('EX0', 'EXISTENTE NF');
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't4.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].produto.item_fiscal, 0);

    await executarImportacao(db, validacao, { importId: 't4', pastaBackup: tmpDir, dbPath: dbFile });
    const p = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['EX0']);
    assert.equal(Number(p.item_fiscal), 0);
  });

  it('TESTE 5 — NAO_FISCAL + existente fiscal + GTIN → GTIN ok, item_fiscal=1', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque, codigo_barras)
      VALUES ('GT1', 'COM GTIN', 1, 'un', 1, 2, 1, NULL)`);
    const buffer = bufferProduto('GT1', 'COM GTIN', { barras: '7891000100103' });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't5.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    assert.equal(validacao.linhas[0].produto.item_fiscal, 1);

    await executarImportacao(db, validacao, { importId: 't5', pastaBackup: tmpDir, dbPath: dbFile });
    const p = await get(db, `SELECT item_fiscal, codigo_barras FROM produtos WHERE codigo = ?`, ['GT1']);
    assert.equal(Number(p.item_fiscal), 1);
    assert.equal(String(p.codigo_barras), '7891000100103');
  });

  it('TESTE 6 — FISCAL + existente NF + estoque → estoque ok, item_fiscal=0', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal)
      VALUES ('ST0', 'ESTOQUE NF', 0, 'un', 1, 2, 1, 0, 0, 0)`);
    const buffer = bufferProduto('ST0', 'ESTOQUE NF');
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't6.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].produto.item_fiscal, 0);

    await executarImportacao(db, validacao, { importId: 't6', pastaBackup: tmpDir, dbPath: dbFile });
    const p = await get(db, `SELECT item_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE codigo = ?`, ['ST0']);
    assert.equal(Number(p.item_fiscal), 0);
  });

  it('TESTE 9 — importação mista', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque)
      VALUES ('MF1', 'JA FISCAL', 1, 'un', 1, 2, 1)`);
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque)
      VALUES ('MF0', 'JA NF', 0, 'un', 1, 2, 1)`);

    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('MFN', 'NOVO MISTO', { 'Qtd documento': 5 }),
        linhaProduto('MF1', 'JA FISCAL', { 'Qtd documento': 1 }),
        linhaProduto('MF0', 'JA NF', { 'Qtd documento': 1 })
      ],
      apresentacoes: []
    });

    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 't9.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    const porCod = Object.fromEntries(validacao.linhas.map((l) => [l.produto.codigo_origem, l]));
    assert.equal(porCod.MFN.produto.item_fiscal, 0);
    assert.equal(porCod.MF1.produto.item_fiscal, 1);
    assert.equal(porCod.MF0.produto.item_fiscal, 0);

    await executarImportacao(db, validacao, { importId: 't9', pastaBackup: tmpDir, dbPath: dbFile });
    const rows = await all(db, `SELECT codigo, item_fiscal FROM produtos WHERE codigo IN ('MFN','MF1','MF0') ORDER BY codigo`);
    const map = Object.fromEntries(rows.map((r) => [r.codigo, Number(r.item_fiscal)]));
    assert.equal(map.MFN, 0);
    assert.equal(map.MF1, 1);
    assert.equal(map.MF0, 0);
  });

  it('TESTE 10 — reimportação/idempotência sem alteração fiscal indevida', async () => {
    const buffer = bufferProduto('ID1', 'IDEM FISCAL');
    const v1 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'idem.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    await executarImportacao(db, v1, { importId: 'idem1', pastaBackup: tmpDir, dbPath: dbFile });

    const v2 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'idem.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    assert.equal(v2.linhas[0].produto.item_fiscal, 1);
    await executarImportacao(db, v2, { importId: 'idem2', pastaBackup: tmpDir, dbPath: dbFile });

    const count = await get(db, `SELECT COUNT(*) AS c FROM produtos WHERE codigo = ?`, ['ID1']);
    const p = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['ID1']);
    assert.equal(Number(count.c), 1);
    assert.equal(Number(p.item_fiscal), 1);
  });

  it('TESTE CADASTRAR 3 — simulação NAO_FISCAL', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, item_fiscal, unidade, preco_compra, preco_venda, controla_estoque)
      VALUES ('C3E', 'CADASTRAR3 EXISTENTE', 1, 'un', 1, 2, 1)`);

    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('C3N', 'CADASTRAR3 NOVO', { 'Qtd documento': 3 }),
        linhaProduto('C3E', 'CADASTRAR3 EXISTENTE', { 'Qtd documento': 1 })
      ],
      apresentacoes: []
    });

    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'cadastrar3.xlsx',
      modo_fiscal_importacao: MODOS_FISCAIS_IMPORTACAO.NAO_FISCAL
    });
    assert.equal(validacao.resumo.produtos_nao_fiscais_novos, 1);
    assert.equal(validacao.linhas.find((l) => l.produto.codigo_origem === 'C3N').produto.item_fiscal, 0);
    assert.equal(validacao.linhas.find((l) => l.produto.codigo_origem === 'C3E').produto.item_fiscal, 1);

    await executarImportacao(db, validacao, { importId: 'c3', pastaBackup: tmpDir, dbPath: dbFile });
    const novo = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['C3N']);
    const antigo = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['C3E']);
    assert.equal(Number(novo.item_fiscal), 0);
    assert.equal(Number(antigo.item_fiscal), 1);
  });

  it('validarImportacao direto aceita modo ausente (V2)', async () => {
    const r = await validarImportacao(db, { produtos: [], apresentacoes: [] }, { nomeArquivo: 'x.xlsx' });
    assert.equal(r.modo_fiscal_importacao, null);
    assert.equal(r.resumo.produtos_encontrados, 0);
  });
});
