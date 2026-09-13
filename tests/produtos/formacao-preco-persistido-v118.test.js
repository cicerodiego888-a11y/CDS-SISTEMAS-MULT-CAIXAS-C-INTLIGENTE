/**
 * V1.1.8 — Preço de venda persistido é oficial; markup é auxiliar.
 * Executar: node --test tests/produtos/formacao-preco-persistido-v118.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const F = require('../../frontend/erp/js/formacao-preco-margem.js');
const svc = require('../../backend/services/importacao-inicial-produtos');
const {
  STATUS,
  mapearLinhaProduto,
  derivarMarkupPercentual,
  resolverLucroPercentualPersistido,
  MARKUP_PADRAO
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const { seedParCategoriaSub } = require('./helpers-seed-catalogo-importacao');

const PRODUTOS_JS = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/produtos.js'),
  'utf8'
);

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
  await seedParCategoriaSub(db, run, get, 'Hidráulica', 'Conexões e Acessórios');
}

function trechoSaveProduto() {
  const start = PRODUTOS_JS.indexOf('async function saveProduto');
  assert.ok(start >= 0, 'saveProduto deve existir');
  return PRODUTOS_JS.slice(start, start + 2500);
}

describe('V1.1.8 — produto 258 (caso real)', () => {
  it('abrir formulário: venda permanece 12,60 e markup deriva ~66,67', () => {
    const r = F.resolverFormacaoPrecoCadastro({
      origem: 'init',
      precoCompra: 7.56,
      precoVenda: 12.6,
      lucroInformado: true,
      lucroValor: 100
    });
    assert.equal(r.precoVenda, 12.6);
    assert.notEqual(r.precoVenda, 15.12);
    assert.equal(r.lucroPercentual, 66.67);
  });

  it('INIT nunca recalcula preço pelo markup 100', () => {
    const r = F.resolverFormacaoPrecoCadastro({
      origem: 'init',
      precoCompra: 7.56,
      precoVenda: 12.6,
      lucroInformado: true,
      lucroValor: 100
    });
    assert.equal(r.precoVenda, 12.6);
    assert.equal(F.calcularPrecoVendaPorMarkup(7.56, 100), 15.12);
  });

  it('INIT deriva markup real de custo 7,56 / venda 12,60', () => {
    assert.equal(F.derivarMarkupPercentual(7.56, 12.6), 66.67);
    assert.equal(derivarMarkupPercentual(7.56, 12.6), 66.67);
  });
});

describe('V1.1.8 — ações do usuário no cadastro', () => {
  it('alterar markup recalcula preço', () => {
    const r = F.resolverFormacaoPrecoCadastro({
      origem: 'lucro',
      precoCompra: 10,
      precoVenda: 20,
      lucroInformado: true,
      lucroValor: 80
    });
    assert.equal(r.precoVenda, 18);
    assert.equal(r.lucroPercentual, 80);
  });

  it('alterar custo recalcula preço conforme markup', () => {
    const r = F.resolverFormacaoPrecoCadastro({
      origem: 'compra',
      precoCompra: 10,
      precoVenda: 12.6,
      lucroInformado: true,
      lucroValor: 100
    });
    assert.equal(r.precoVenda, 20);
  });

  it('alterar preço recalcula markup', () => {
    const r = F.resolverFormacaoPrecoCadastro({
      origem: 'venda',
      precoCompra: 10,
      precoVenda: 15,
      lucroInformado: true,
      lucroValor: 100
    });
    assert.equal(r.precoVenda, 15);
    assert.equal(r.lucroPercentual, 50);
  });

  it('abrir e salvar sem alteração: preço não muda', () => {
    const aberto = F.resolverFormacaoPrecoCadastro({
      origem: 'init',
      precoCompra: 7.56,
      precoVenda: 12.6,
      lucroInformado: true,
      lucroValor: 100
    });
    const payload = {
      preco_compra: aberto.precoCompra,
      preco_venda: aberto.precoVenda,
      lucro_percentual: aberto.lucroPercentual
    };
    assert.equal(payload.preco_venda, 12.6);
    assert.notEqual(payload.preco_venda, 15.12);
    assert.doesNotMatch(trechoSaveProduto(), /sincronizarFormacaoPrecoProduto\('init'\)/);
  });
});

describe('V1.1.8 — fonte do cadastro (produtos.js)', () => {
  it('saveProduto não força recálculo init antes do payload', () => {
    assert.doesNotMatch(trechoSaveProduto(), /sincronizarFormacaoPrecoProduto\('init'\)/);
  });

  it('init deriva markup e não usa custo × markup para sobrescrever venda', () => {
    assert.match(PRODUTOS_JS, /resolverFormacaoPrecoCadastro/);
    assert.match(PRODUTOS_JS, /origemNorm === 'init' \|\| origemNorm === 'embalagem'/);
    assert.match(PRODUTOS_JS, /derivarMarkupPercentual/);
  });
});

describe('V1.1.8 — persistência de markup no Importador', () => {
  it('custo + venda sem markup: não grava 100; deriva 66,67', () => {
    const lucro = resolverLucroPercentualPersistido({
      markupInformado: null,
      custo: 7.56,
      precoVenda: 12.6,
      usarPadraoQuandoSoCusto: true
    });
    assert.equal(lucro, 66.67);
    assert.notEqual(lucro, 100);
    assert.notEqual(lucro, MARKUP_PADRAO);
  });

  it('custo + venda + markup informado: respeita o markup do XLSX', () => {
    const lucro = resolverLucroPercentualPersistido({
      markupInformado: 80,
      custo: 10,
      precoVenda: 15,
      usarPadraoQuandoSoCusto: true
    });
    assert.equal(lucro, 80);
  });

  it('markup vazio sem custo/venda: não inventa 100', () => {
    const lucro = resolverLucroPercentualPersistido({
      markupInformado: null,
      custo: 0,
      precoVenda: 0,
      usarPadraoQuandoSoCusto: false
    });
    assert.equal(lucro, null);
  });

  it('mapearLinhaProduto sem Markup % não marca markup como informado', () => {
    const p = mapearLinhaProduto({
      Código: '258',
      Produto: "ADAPT FLANGE P/ CX D'AGUA 25 X 3/4",
      'Custo Unitário': 7.56,
      'Preço de Venda': 12.6
    });
    assert.equal(p.markup_informado, null);
    assert.equal(p.preco_informado, 12.6);
    assert.equal(p.custo_informado, 7.56);
  });

  it('mapearLinhaProduto com Markup % 80 preserva o informado', () => {
    const p = mapearLinhaProduto({
      Código: 'X1',
      Produto: 'Item',
      'Custo Unitário': 10,
      'Preço de Venda': 15,
      'Markup %': 80
    });
    assert.equal(p.markup_informado, 80);
    assert.equal(p.markup, 80);
  });
});

describe('V1.1.8 — importação isolada (não usa banco oficial)', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v118-'));
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

  it('novo produto custo 7,56 venda 12,60 sem markup: persiste preço e markup ~66,67', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [{
        Código: '258-V118',
        Produto: 'TESTE PREÇO IMPORTADO',
        'Custo Unitário': 7.56,
        'Preço de Venda': 12.6,
        Categoria: 'Hidráulica',
        Subcategoria: 'Conexões e Acessórios',
        Quantidade: 1
      }]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v118-novo.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(Number(validacao.linhas[0].produto.preco_venda), 12.6);
    assert.equal(validacao.linhas[0].produto.markup_informado, null);

    await executarImportacao(db, validacao, { importId: 'v118-novo', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['258-V118']);
    assert.ok(p);
    assert.equal(Number(p.preco_compra), 7.56);
    assert.equal(Number(p.preco_venda), 12.6);
    assert.equal(Number(p.lucro_percentual), 66.67);
    assert.notEqual(Number(p.lucro_percentual), 100);
  });

  it('existente: preço informado sem markup deriva markup e preserva o preço', async () => {
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, ['Hidráulica']);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ?`, ['Conexões e Acessórios']);
    const ins = await run(
      db,
      `INSERT INTO produtos (
        codigo, nome, categoria_id, subcategoria_id, unidade,
        preco_compra, lucro_percentual, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
      ) VALUES (?, ?, ?, ?, 'un', ?, 100, ?, 24, 24, 0, 1, 1)`,
      ['258', "ADAPT FLANGE P/ CX D'AGUA 25 X 3/4", cat.id, sub.id, 7.56, 12.6]
    );

    const buffer = svc.gerarXlsxFixture({
      produtos: [{
        Código: '258',
        Produto: "ADAPT FLANGE P/ CX D'AGUA 25 X 3/4",
        'Custo Unitário': 7.56,
        'Preço de Venda': 12.6,
        Categoria: 'Hidráulica',
        Subcategoria: 'Conexões e Acessórios'
      }]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v118-258.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);

    await executarImportacao(db, validacao, { importId: 'v118-258', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda, lucro_percentual FROM produtos WHERE id = ?`, [ins.lastID]);
    assert.equal(Number(p.preco_compra), 7.56);
    assert.equal(Number(p.preco_venda), 12.6);
    assert.equal(Number(p.lucro_percentual), 100);
  });

  it('existente: novo preço sem markup deriva markup real e não grava 100', async () => {
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, ['Hidráulica']);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ?`, ['Conexões e Acessórios']);
    const ins = await run(
      db,
      `INSERT INTO produtos (
        codigo, nome, categoria_id, subcategoria_id, unidade,
        preco_compra, lucro_percentual, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
      ) VALUES (?, ?, ?, ?, 'un', 10, 100, 20, 5, 5, 0, 1, 1)`,
      ['V118-UPD', 'ATUALIZA PRECO', cat.id, sub.id]
    );

    const buffer = svc.gerarXlsxFixture({
      produtos: [{
        Código: 'V118-UPD',
        Produto: 'ATUALIZA PRECO',
        'Preço de Venda': 12.6,
        Categoria: 'Hidráulica',
        Subcategoria: 'Conexões e Acessórios'
      }]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v118-upd.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);

    await executarImportacao(db, validacao, { importId: 'v118-upd', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda, lucro_percentual FROM produtos WHERE id = ?`, [ins.lastID]);
    assert.equal(Number(p.preco_compra), 10);
    assert.equal(Number(p.preco_venda), 12.6);
    assert.equal(Number(p.lucro_percentual), 26);
    assert.notEqual(Number(p.lucro_percentual), 100);
  });

  it('existente: markup explícito 80 é respeitado junto com o preço informado', async () => {
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, ['Hidráulica']);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ?`, ['Conexões e Acessórios']);
    const ins = await run(
      db,
      `INSERT INTO produtos (
        codigo, nome, categoria_id, subcategoria_id, unidade,
        preco_compra, lucro_percentual, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
      ) VALUES (?, ?, ?, ?, 'un', 10, 100, 20, 5, 5, 0, 1, 1)`,
      ['V118-MK', 'COM MARKUP', cat.id, sub.id]
    );

    const buffer = svc.gerarXlsxFixture({
      produtos: [{
        Código: 'V118-MK',
        Produto: 'COM MARKUP',
        'Custo Unitário': 10,
        'Preço de Venda': 15,
        'Markup %': 80,
        Categoria: 'Hidráulica',
        Subcategoria: 'Conexões e Acessórios'
      }]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v118-mk.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    await executarImportacao(db, validacao, { importId: 'v118-mk', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda, lucro_percentual FROM produtos WHERE id = ?`, [ins.lastID]);
    assert.equal(Number(p.preco_compra), 10);
    assert.equal(Number(p.preco_venda), 15);
    assert.equal(Number(p.lucro_percentual), 80);
  });

  it('regressão V1.1: campos vazios não alteram custo/preço/estoque existentes', async () => {
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, ['Hidráulica']);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ?`, ['Conexões e Acessórios']);
    const ins = await run(
      db,
      `INSERT INTO produtos (
        codigo, nome, categoria_id, subcategoria_id, unidade,
        preco_compra, lucro_percentual, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
      ) VALUES (?, ?, ?, ?, 'un', 7.56, 100, 12.6, 24, 24, 0, 1, 1)`,
      ['V118-VAZIO', 'SEM CAMPOS', cat.id, sub.id]
    );

    const buffer = svc.gerarXlsxFixture({
      produtos: [{
        Código: 'V118-VAZIO',
        Produto: 'SEM CAMPOS',
        Categoria: 'Hidráulica',
        Subcategoria: 'Conexões e Acessórios'
      }]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v118-vazio.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);
    await executarImportacao(db, validacao, { importId: 'v118-vazio', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda, lucro_percentual, estoque_atual FROM produtos WHERE id = ?`, [ins.lastID]);
    assert.equal(Number(p.preco_compra), 7.56);
    assert.equal(Number(p.preco_venda), 12.6);
    assert.equal(Number(p.lucro_percentual), 100);
    assert.equal(Number(p.estoque_atual), 24);
  });
});
