/**
 * V1.1 — Importador: estoque + custo + preço + categoria/subcategoria.
 * Executar: node --test tests/produtos/importacao-inicial-v11-custo-preco-estoque.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const svc = require('../../backend/services/importacao-inicial-produtos');
const {
  STATUS,
  mapearLinhaProduto,
  mapearLinhaQuantidade,
  LABEL_NAO_ALTERAR
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const { executarAtualizacaoQuantidades } = require('../../backend/services/importacao-inicial-produtos/quantidadeUpdater');
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
  await seedParCategoriaSub(db, run, get, 'Cat V11', 'Sub V11');
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA V11',
    Categoria: 'Cat V11',
    Subcategoria: 'Sub V11',
    'Unidade base': 'UN',
    'Unidade origem': 'UN',
    'Qtd documento': 10,
    'Custo unitário': 8,
    'Markup %': 100,
    Fiscal: 'SIM',
    'Preço venda unitário': 15,
    ...overrides
  };
}

async function inserirProdutoExistente(db, {
  codigo,
  nome,
  itemFiscal = 1,
  precoCompra = 5,
  precoVenda = 12,
  estoque = 20,
  saldoFiscal = null,
  saldoNaoFiscal = null,
  categoria = 'Cat Original',
  subcategoria = 'Sub Original',
  codigoBarras = null
}) {
  let cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, [categoria]);
  if (!cat) {
    const r = await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES (?, 'produto', 1)`, [categoria]);
    cat = { id: r.lastID };
  }
  let sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ? AND categoria_id = ?`, [subcategoria, cat.id]);
  if (!sub) {
    const r = await run(db, `INSERT INTO subcategorias (nome, categoria_id, ativo) VALUES (?, ?, 1)`, [subcategoria, cat.id]);
    sub = { id: r.lastID };
  }
  const sf = saldoFiscal == null ? (itemFiscal === 1 ? estoque : 0) : saldoFiscal;
  const snf = saldoNaoFiscal == null ? (itemFiscal === 0 ? estoque : 0) : saldoNaoFiscal;
  const ins = await run(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal,
      codigo_barras, controla_estoque
    ) VALUES (?, ?, ?, ?, 'un', ?, 100, ?, ?, ?, ?, ?, ?, 1)`,
    [codigo, nome, cat.id, sub.id, precoCompra, precoVenda, estoque, sf, snf, itemFiscal, codigoBarras]
  );
  return { id: ins.lastID, categoriaId: cat.id, subcategoriaId: sub.id };
}

describe('V1.1 — headers quantidade / qtd documento', () => {
  it('15) header Quantidade mapeia para quantidade_documento (produto e quantidades)', () => {
    const p = mapearLinhaProduto({ 'Código origem': 'H1', 'Nome CDS': 'X', Quantidade: 7 });
    assert.equal(p.quantidade_documento, 7);
    const q = mapearLinhaQuantidade({ 'Código origem': 'H1', 'Nome CDS': 'X', Quantidade: 9 });
    assert.equal(q.quantidade_documento, 9);
  });

  it('16) header Qtd documento continua funcionando; aliases qtd e quantidade_documento preservados', () => {
    assert.equal(mapearLinhaProduto({ 'Qtd documento': 3 }).quantidade_documento, 3);
    assert.equal(mapearLinhaProduto({ qtd_documento: 4 }).quantidade_documento, 4);
    assert.equal(mapearLinhaProduto({ quantidade_documento: 5 }).quantidade_documento, 5);
    assert.equal(mapearLinhaProduto({ qtd: 6 }).quantidade_documento, 6);
    assert.equal(mapearLinhaQuantidade({ 'Qtd documento': 11 }).quantidade_documento, 11);
    assert.equal(mapearLinhaQuantidade({ qtd: 12 }).quantidade_documento, 12);
    assert.equal(mapearLinhaQuantidade({ quantidade_documento: 13 }).quantidade_documento, 13);
  });
});

describe('V1.1 — cadastro inicial (novo + existente)', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v11-'));
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

  it('1) produto novo + quantidade + custo', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N1', 'NOVO CUSTO', { 'Preço venda unitário': null, 'Markup %': 100 })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'n1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(Number(validacao.linhas[0].produto.custo_unitario), 8);
    await executarImportacao(db, validacao, { importId: 'n1', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['N1']);
    assert.ok(p);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.estoque_atual), 10);
    assert.equal(Number(p.item_fiscal), 1);
    assert.ok(p.categoria_id);
    assert.ok(p.subcategoria_id);
  });

  it('2) produto novo + quantidade + custo + preço + categoria/subcategoria oficiais', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N2', 'NOVO COMPLETO', {
        Categoria: 'Cat V11',
        Subcategoria: 'Sub V11',
        'Custo unitário': 8,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'n2.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    await executarImportacao(db, validacao, { importId: 'n2', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['N2']);
    const cat = await get(db, `SELECT nome FROM categorias WHERE id = ?`, [p.categoria_id]);
    const sub = await get(db, `SELECT nome FROM subcategorias WHERE id = ?`, [p.subcategoria_id]);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.preco_venda), 15);
    assert.equal(Number(p.estoque_atual), 10);
    assert.equal(cat.nome, 'Cat V11');
    assert.equal(sub.nome, 'Sub V11');
  });

  it('21/22) categoria inexistente no XLSX é criada na importação (V1.1.4)', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N2B', 'NOVO CAT INEXISTENTE', {
        Categoria: 'Ferramentas Novas',
        Subcategoria: 'Manuais Novas',
        'Custo unitário': 8,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'n2b.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(validacao.linhas[0].classificacao.criar_categoria, true);
    assert.equal(validacao.linhas[0].classificacao.criar_subcategoria, true);
    assert.equal(await get(db, `SELECT id FROM categorias WHERE nome = ?`, ['Ferramentas Novas']), null);
    await executarImportacao(db, validacao, { importId: 'n2b', pastaBackup, dbPath });
    const cat = await get(db, `SELECT id, tipo, ativo FROM categorias WHERE nome = ?`, ['Ferramentas Novas']);
    assert.ok(cat);
    assert.equal(cat.tipo, 'produto');
    assert.equal(Number(cat.ativo), 1);
    const sub = await get(db, `SELECT categoria_id FROM subcategorias WHERE nome = ?`, ['Manuais Novas']);
    assert.equal(Number(sub.categoria_id), Number(cat.id));
  });

  it('3) produto existente + quantidade (soma, status EXISTENTE_ATUALIZAR)', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E3', nome: 'EXIST QTD', precoCompra: 5, precoVenda: 12, estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E3', 'EXIST QTD', {
        'Custo unitário': null,
        'Preço venda unitário': null,
        'Markup %': 100,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e3.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.pode_importar, true);
    assert.equal(validacao.resumo.atualizacoes, 1);
    assert.equal(validacao.linhas[0].preview_atualizacao.estoque_atual, 20);
    assert.equal(validacao.linhas[0].preview_atualizacao.quantidade_importada, 10);
    assert.equal(validacao.linhas[0].preview_atualizacao.estoque_final, 30);
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_custo_label, LABEL_NAO_ALTERAR);
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_preco_label, LABEL_NAO_ALTERAR);

    await executarImportacao(db, validacao, { importId: 'e3', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 30);
    assert.equal(Number(p.preco_compra), 5);
    assert.equal(Number(p.preco_venda), 12);
  });

  it('4) produto existente + quantidade + custo', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E4', nome: 'EXIST CUSTO', precoCompra: 5, precoVenda: 12, estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E4', 'EXIST CUSTO', {
        'Custo unitário': 8,
        'Preço venda unitário': null,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e4.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    await executarImportacao(db, validacao, { importId: 'e4', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 30);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.preco_venda), 12);
  });

  it('5) produto existente + quantidade + preço', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E5', nome: 'EXIST PRECO', precoCompra: 5, precoVenda: 12, estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E5', 'EXIST PRECO', {
        'Custo unitário': null,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e5.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    await executarImportacao(db, validacao, { importId: 'e5', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 30);
    assert.equal(Number(p.preco_compra), 5);
    assert.equal(Number(p.preco_venda), 15);
  });

  it('6) produto existente + quantidade + custo + preço', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E6', nome: 'EXIST TUDO', precoCompra: 5, precoVenda: 12, estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E6', 'EXIST TUDO', {
        'Custo unitário': 8,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e6.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.linhas[0].preview_atualizacao.estoque_final, 30);
    assert.equal(Number(validacao.linhas[0].preview_atualizacao.novo_custo), 8);
    assert.equal(Number(validacao.linhas[0].preview_atualizacao.novo_preco), 15);
    await executarImportacao(db, validacao, { importId: 'e6', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 30);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.preco_venda), 15);
  });

  it('7/25) produto existente sem custo informado não altera custo', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E7', nome: 'EXIST SEM CUSTO', precoCompra: 5.55, precoVenda: 12, estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E7', 'EXIST SEM CUSTO', {
        'Custo unitário': null,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e7.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_custo_label, LABEL_NAO_ALTERAR);
    await executarImportacao(db, validacao, { importId: 'e7', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 5.55);
    assert.equal(Number(p.preco_venda), 15);
  });

  it('8/24) produto existente sem preço informado não altera preço', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E8', nome: 'EXIST SEM PRECO', precoCompra: 5, precoVenda: 12.34, estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E8', 'EXIST SEM PRECO', {
        'Custo unitário': 8,
        'Preço venda unitário': null,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e8.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_preco_label, LABEL_NAO_ALTERAR);
    await executarImportacao(db, validacao, { importId: 'e8', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.preco_venda), 12.34);
  });

  it('9/10/23) produto existente preserva categoria e subcategoria', async () => {
    const { id, categoriaId, subcategoriaId } = await inserirProdutoExistente(db, {
      codigo: 'E9',
      nome: 'EXIST CAT',
      categoria: 'Cat Original',
      subcategoria: 'Sub Original',
      estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E9', 'EXIST CAT', {
        Categoria: 'Outra Categoria Planilha',
        Subcategoria: 'Outra Sub Planilha',
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e9.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    await executarImportacao(db, validacao, { importId: 'e9', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.categoria_id), Number(categoriaId));
    assert.equal(Number(p.subcategoria_id), Number(subcategoriaId));
  });

  it('11/13/14) produto existente fiscal: preserva item_fiscal e soma saldo_fiscal', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E11', nome: 'EXIST FISCAL', itemFiscal: 1, estoque: 20, saldoFiscal: 20, saldoNaoFiscal: 0
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E11', 'EXIST FISCAL', {
        'Custo unitário': null,
        'Preço venda unitário': null,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e11.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    assert.equal(validacao.linhas[0].produto.item_fiscal, 1);
    await executarImportacao(db, validacao, { importId: 'e11', pastaBackup, dbPath });
    const p = await get(db, `SELECT item_fiscal, saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.item_fiscal), 1);
    assert.equal(Number(p.saldo_fiscal), 30);
    assert.equal(Number(p.saldo_nao_fiscal), 0);
    assert.equal(Number(p.estoque_atual), Number(p.saldo_fiscal) + Number(p.saldo_nao_fiscal));
    assert.equal(Number(p.estoque_atual), 30);
  });

  it('12/14) produto existente não fiscal soma em saldo_nao_fiscal', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'E12', nome: 'EXIST NF', itemFiscal: 0, estoque: 20, saldoFiscal: 0, saldoNaoFiscal: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E12', 'EXIST NF', {
        'Custo unitário': null,
        'Preço venda unitário': null,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e12.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].produto.item_fiscal, 0);
    await executarImportacao(db, validacao, { importId: 'e12', pastaBackup, dbPath });
    const p = await get(db, `SELECT item_fiscal, saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.item_fiscal), 0);
    assert.equal(Number(p.saldo_fiscal), 0);
    assert.equal(Number(p.saldo_nao_fiscal), 30);
    assert.equal(Number(p.estoque_atual), 30);
  });

  it('EXISTENTE puro (mesmos valores, sem estoque a lançar) não é importável', async () => {
    await run(db, `
      INSERT INTO produtos_ajustes_estoque (produto_id, motivo, ajuste_fiscal, ajuste_nao_fiscal)
      SELECT id, 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS | import=prev', 20, 0
      FROM produtos WHERE codigo = 'E6'
    `);
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E6', 'EXIST TUDO', {
        'Custo unitário': 8,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e6-re.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);
    assert.equal(validacao.pode_importar, false);
  });

  it('18) código duplicado no arquivo continua bloqueado', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('DUP1', 'DUP A'),
        linhaProduto('DUP1', 'DUP B')
      ]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'dup.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.pode_importar, false);
    assert.ok(validacao.linhas.every((l) => l.status === STATUS.CODIGO_DUPLICADO_ARQUIVO));
  });

  it('19) rollback se custo/preço falhar (estoque não permanece)', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'RB1', nome: 'ROLLBACK CUSTO', estoque: 20, precoCompra: 5, precoVenda: 12
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('RB1', 'ROLLBACK CUSTO', {
        'Custo unitário': 8,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'rb1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    await assert.rejects(
      () => executarImportacao(db, validacao, {
        importId: 'rb1',
        pastaBackup,
        dbPath,
        forcarFalhaCustoPreco: true
      }),
      /custo\/preço/i
    );
    const p = await get(db, `SELECT estoque_atual, preco_compra, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 20);
    assert.equal(Number(p.preco_compra), 5);
    assert.equal(Number(p.preco_venda), 12);
  });

  it('20) reprocessamento não duplica estoque', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'RP1', nome: 'REPROC', estoque: 20, precoCompra: 5, precoVenda: 12
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('RP1', 'REPROC', {
        'Custo unitário': null,
        'Preço venda unitário': null,
        'Qtd documento': 10
      })]
    });
    const v1 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'rp1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    await executarImportacao(db, v1, { importId: 'rp1', pastaBackup, dbPath });
    const meio = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(meio.estoque_atual), 30);

    const v2 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'rp1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v2.linhas[0].status, STATUS.EXISTENTE);
    const r2 = await executarImportacao(db, v2, { importId: 'rp1b', pastaBackup, dbPath });
    assert.equal(r2.relatorio.estoque_lancado, 0);
    const fim = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(fim.estoque_atual), 30);
  });

  it('zeros à esquerda não unificam códigos', async () => {
    await inserirProdutoExistente(db, {
      codigo: '0637701012', nome: 'COM ZERO', estoque: 1, precoCompra: 1, precoVenda: 2
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('637701012', 'SEM ZERO', { 'Qtd documento': 1, 'Custo unitário': 1, 'Preço venda unitário': 2 })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'zeros.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
  });
});

describe('V1.1 — atualizar quantidades', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v11q-'));
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

  function linhaQtd(codigo, nome, overrides = {}) {
    return {
      'Código origem': codigo,
      'Nome CDS': nome,
      Unidade: 'UN',
      'Qtd documento': 10,
      ...overrides
    };
  }

  it('quantidade + custo + preço no modo Atualizar Quantidades', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'Q1', nome: 'QTD COMPLETO', estoque: 20, precoCompra: 5, precoVenda: 12, itemFiscal: 1
    });
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQtd('Q1', 'QTD COMPLETO', {
        'Custo unitário': 8,
        'Preço venda unitário': 15
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'q1.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(validacao.pode_importar, true);
    assert.equal(validacao.linhas[0].status, STATUS.OK);
    await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 30);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.preco_venda), 15);
    assert.equal(Number(p.item_fiscal), 1);
    assert.equal(Number(p.saldo_fiscal), 30);
  });

  it('15) header Quantidade no modo quantidades', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'Q15', nome: 'QTD HEADER', estoque: 4, precoCompra: 1, precoVenda: 2
    });
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [{
        'Código origem': 'Q15',
        'Nome CDS': 'QTD HEADER',
        Quantidade: 6
      }]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'q15.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(validacao.linhas[0].quantidade.quantidade_a_lancar, 6);
    await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    const p = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 10);
  });

  it('17) produto não encontrado continua bloqueado e não cria produto', async () => {
    const antes = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQtd('INEXIST', 'NAO TEM')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'nf.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(validacao.linhas[0].status, STATUS.NAO_ENCONTRADO);
    assert.equal(validacao.pode_importar, false);
    await assert.rejects(() => svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup }));
    const depois = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(depois.c, antes.c);
  });

  it('20) reprocessar a mesma sessão/arquivo não duplica estoque', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'Q20', nome: 'QTD REPROC', estoque: 20, precoCompra: 5, precoVenda: 12
    });
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQtd('Q20', 'QTD REPROC', { Origem: 'ARQ20' })]
    });
    const v1 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'q20.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    await svc.importarSessao(db, v1.sessao_id, { dbPath, pastaBackup });
    const meio = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(meio.estoque_atual), 30);

    const v2 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'q20.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    const r2 = await svc.importarSessao(db, v2.sessao_id, { dbPath, pastaBackup });
    assert.equal(r2.relatorio.estoque_lancado, 0);
    const fim = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(fim.estoque_atual), 30);
  });

  it('custo/preço vazios não alteram; quantidade soma', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'Q25', nome: 'QTD VAZIO', estoque: 20, precoCompra: 5, precoVenda: 12
    });
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQtd('Q25', 'QTD VAZIO')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'q25.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_custo_label, LABEL_NAO_ALTERAR);
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_preco_label, LABEL_NAO_ALTERAR);
    await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    const p = await get(db, `SELECT estoque_atual, preco_compra, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 30);
    assert.equal(Number(p.preco_compra), 5);
    assert.equal(Number(p.preco_venda), 12);
  });

  it('19) rollback de custo/preço no modo quantidades desfaz estoque', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'QRB', nome: 'QTD ROLLBACK', estoque: 20, precoCompra: 5, precoVenda: 12
    });
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQtd('QRB', 'QTD ROLLBACK', {
        'Custo unitário': 8,
        'Preço venda unitário': 15
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'qrb.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    await assert.rejects(
      () => executarAtualizacaoQuantidades(db, validacao, {
        importId: 'qrb',
        pastaBackup,
        dbPath,
        forcarFalhaCustoPreco: true
      }),
      /custo\/preço/i
    );
    const p = await get(db, `SELECT estoque_atual, preco_compra, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 20);
    assert.equal(Number(p.preco_compra), 5);
    assert.equal(Number(p.preco_venda), 12);
  });
});

describe('V1.1 — prévia UI', () => {
  it('tela mostra ATUALIZAR, NOVO e — não alterar —', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /EXISTENTE_ATUALIZAR/);
    assert.match(src, /EXISTENTE — ATUALIZAR/);
    assert.match(src, />NOVO</);
    assert.match(src, /não alterar/);
    assert.match(src, /Est\. Fiscal/);
    assert.match(src, /Est\. Não Fiscal/);
    assert.match(src, /Est\. Total/);
  });
});
