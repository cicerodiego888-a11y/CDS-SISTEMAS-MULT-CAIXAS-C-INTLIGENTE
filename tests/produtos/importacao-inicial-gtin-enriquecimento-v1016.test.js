/**
 * V1.0.16 — enriquecimento de codigo_barras (GTIN) em produto existente.
 * Executar: node --test tests/produtos/importacao-inicial-gtin-enriquecimento-v1016.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const svc = require('../../backend/services/importacao-inicial-produtos');
const { STATUS } = require('../../backend/services/importacao-inicial-produtos/helpers');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const { extrairDadosImportacao } = require('../../backend/services/importacao-inicial-produtos/xlsxReader');
const { validarImportacao } = require('../../backend/services/importacao-inicial-produtos/validator');
const { seedParCategoriaSub } = require('./helpers-seed-catalogo-importacao');

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
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
    codigo TEXT UNIQUE, nome TEXT, categoria_id INTEGER, subcategoria_id INTEGER, unidade TEXT,
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
  await seedParCategoriaSub(db, run, get, 'Ferramentas', 'Geral');
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'W-MAX',
    Categoria: 'Ferramentas',
    Subcategoria: 'Geral',
    'Unidade base': 'UN',
    'Unidade origem': 'UN',
    'Qtd documento': 0,
    'Custo unitário': 10,
    'Markup %': 100,
    Fiscal: 'SIM',
    'Preço venda unitário': 20,
    ...overrides
  };
}

async function inserirProdutoBase(db, {
  codigo,
  nome,
  codigoBarras = null,
  itemFiscal = 1,
  precoCompra = 10,
  precoVenda = 20
}) {
  const cat = await get(db, `SELECT id FROM categorias WHERE nome = 'Ferramentas'`);
  const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = 'Geral' AND categoria_id = ?`, [cat.id]);
  const r = await run(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra, lucro_percentual, preco_venda,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, codigo_barras, controla_estoque
    ) VALUES (?, ?, ?, ?, 'un', ?, 100, ?, 0, 0, 0, ?, ?, 1)`,
    [codigo, nome, cat.id, sub.id, precoCompra, precoVenda, itemFiscal, codigoBarras]
  );
  return r.lastID;
}

describe('V1.0.16 — enriquecimento GTIN em produto existente', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-gtin-enr-'));
    dbPath = path.join(dir, 'teste.db');
    pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    db = await openDb(dbPath);
    await criarSchema(db);
  });

  after(async () => {
    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('1) existente + barras vazio no banco + GTIN no arquivo → ENRIQUECER', async () => {
    const id = await inserirProdutoBase(db, {
      codigo: '5986113300',
      nome: 'DESENGRIPANTE SPRAY W-MAX 300ML',
      codigoBarras: null,
      itemFiscal: 1
    });

    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('5986113300', 'DESENGRIPANTE SPRAY W-MAX 300ML', {
        'GTIN/EAN': '7891799529031'
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'gtin-enr.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_APRESENTACAO_NOVA);
    assert.equal(validacao.linhas[0].enriquecimento.corrigir_codigo_barras, true);
    assert.equal(validacao.pode_importar, true);

    const resultado = await executarImportacao(db, validacao, {
      dbPath,
      pastaBackup,
      importId: validacao.sessao_id
    });
    assert.equal(resultado.relatorio.enriquecidos, 1);
    assert.equal(resultado.relatorio.criados, 0);
    assert.equal(resultado.relatorio.movimentacoes_estoque, 0);

    const row = await get(db, 'SELECT codigo_barras, item_fiscal, preco_compra, preco_venda, nome FROM produtos WHERE id = ?', [id]);
    assert.equal(row.codigo_barras, '7891799529031');
    assert.equal(row.item_fiscal, 1);
    assert.equal(Number(row.preco_compra), 10);
    assert.equal(Number(row.preco_venda), 20);
    assert.equal(row.nome, 'DESENGRIPANTE SPRAY W-MAX 300ML');
  });

  it('2) existente + GTIN já igual → EXISTENTE sem alteração', async () => {
    await inserirProdutoBase(db, {
      codigo: '2002',
      nome: 'PROD IGUAL',
      codigoBarras: '7891111111111'
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('2002', 'PROD IGUAL', { 'GTIN/EAN': '7891111111111' })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'igual.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);
    assert.equal(validacao.pode_importar, false);
  });

  it('3) existente + GTIN diferente → preservar banco (não sobrescrever)', async () => {
    const id = await inserirProdutoBase(db, {
      codigo: '2003',
      nome: 'PROD DIF',
      codigoBarras: '7891111111111'
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('2003', 'PROD DIF', { 'GTIN/EAN': '7892222222222' })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'dif.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);

    const resultado = await executarImportacao(db, validacao, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.enriquecidos, 0);
    const row = await get(db, 'SELECT codigo_barras FROM produtos WHERE id = ?', [id]);
    assert.equal(row.codigo_barras, '7891111111111');
  });

  it('4) existente + arquivo sem GTIN → EXISTENTE sem enriquecimento', async () => {
    await inserirProdutoBase(db, {
      codigo: '2004',
      nome: 'SEM GTIN ARQ',
      codigoBarras: null
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('2004', 'SEM GTIN ARQ')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'sem.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);
    assert.ok(!validacao.linhas[0].enriquecimento?.corrigir_codigo_barras);
  });

  it('5) produto novo + GTIN → cadastro normal com GTIN', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('2005', 'NOVO COM GTIN', {
        'GTIN/EAN': '7893333333333',
        'Qtd documento': 1
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'novo.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(validacao.linhas[0].produto.codigo_barras, '7893333333333');

    await executarImportacao(db, validacao, { dbPath, pastaBackup, importId: validacao.sessao_id });
    const row = await get(db, 'SELECT codigo_barras FROM produtos WHERE codigo = ?', ['2005']);
    assert.equal(row.codigo_barras, '7893333333333');
  });

  it('6) reimportação após enriquecimento → idempotente', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('5986113300', 'DESENGRIPANTE SPRAY W-MAX 300ML', {
        'GTIN/EAN': '7891799529031'
      })]
    });
    const v2 = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'gtin-enr-2.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(v2.linhas[0].status, STATUS.EXISTENTE);
    assert.equal(v2.pode_importar, false);

    const antes = await get(db, 'SELECT codigo_barras, item_fiscal FROM produtos WHERE codigo = ?', ['5986113300']);
    const r2 = await executarImportacao(db, v2, { dbPath, pastaBackup });
    assert.equal(r2.relatorio.enriquecidos, 0);
    assert.equal(r2.relatorio.criados, 0);
    const depois = await get(db, 'SELECT codigo_barras, item_fiscal FROM produtos WHERE codigo = ?', ['5986113300']);
    assert.equal(depois.codigo_barras, antes.codigo_barras);
    assert.equal(depois.item_fiscal, 1);
  });

  it('7) item_fiscal = 1 permanece 1', async () => {
    const id = await inserirProdutoBase(db, {
      codigo: '2007',
      nome: 'FISCAL UM',
      codigoBarras: null,
      itemFiscal: 1
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('2007', 'FISCAL UM', { 'GTIN/EAN': '7894444444444' })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'f1.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    await executarImportacao(db, validacao, { dbPath, pastaBackup, importId: validacao.sessao_id });
    const row = await get(db, 'SELECT item_fiscal, codigo_barras FROM produtos WHERE id = ?', [id]);
    assert.equal(row.item_fiscal, 1);
    assert.equal(row.codigo_barras, '7894444444444');
  });

  it('8) item_fiscal = 0 permanece 0', async () => {
    const id = await inserirProdutoBase(db, {
      codigo: '2008',
      nome: 'NAO FISCAL',
      codigoBarras: null,
      itemFiscal: 0
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('2008', 'NAO FISCAL', { 'GTIN/EAN': '7895555555555' })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'f0.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    await executarImportacao(db, validacao, { dbPath, pastaBackup, importId: validacao.sessao_id });
    const row = await get(db, 'SELECT item_fiscal, codigo_barras FROM produtos WHERE id = ?', [id]);
    assert.equal(row.item_fiscal, 0);
    assert.equal(row.codigo_barras, '7895555555555');
  });

  it('XLSX real — 5986113300 com GTIN 7891799529031 é reconhecido no parser/validator', async () => {
    const xlsxPath = path.join(
      process.env.USERPROFILE || '',
      'Downloads',
      'CDS_CADASTRAR_2_IMPORTACAO_COM_CODIGOS_BARRAS.xlsx'
    );
    if (!fs.existsSync(xlsxPath)) return;

    const dados = extrairDadosImportacao(fs.readFileSync(xlsxPath));
    const prod = dados.produtos.find((p) => String(p.codigo_origem) === '5986113300');
    assert.ok(prod);
    assert.equal(prod.codigo_barras, '7891799529031');

    // Isola critério de barras: zera qtd para não acionar estoque/preço do arquivo real
    const prodIsolado = { ...prod, quantidade_documento: 0 };
    const noDb = await get(db, 'SELECT codigo_barras FROM produtos WHERE codigo = ?', ['5986113300']);
    const validacao = await validarImportacao(db, {
      produtos: [prodIsolado],
      apresentacoes: []
    }, { nomeArquivo: 'real.xlsx' });

    if (!noDb?.codigo_barras) {
      assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_APRESENTACAO_NOVA);
      assert.equal(validacao.linhas[0].enriquecimento.corrigir_codigo_barras, true);
    } else {
      assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);
      assert.ok(!validacao.linhas[0].enriquecimento?.corrigir_codigo_barras);
    }
  });
});
