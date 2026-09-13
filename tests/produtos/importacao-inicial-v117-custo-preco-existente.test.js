/**
 * V1.1.7 — Atualização de custo unitário e preço de venda em produtos existentes.
 * Executar: node --test tests/produtos/importacao-inicial-v117-custo-preco-existente.test.js
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
  LABEL_NAO_ALTERAR,
  LABEL_SEM_ALTERACAO
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

async function inserirProdutoExistente(db, {
  codigo,
  nome,
  precoCompra = 10,
  precoVenda = 20,
  estoque = 40,
  categoria = 'Cat V11',
  subcategoria = 'Sub V11',
  itemFiscal = 1
}) {
  const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, [categoria]);
  const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ? AND categoria_id = ?`, [
    subcategoria, cat.id
  ]);
  const ins = await run(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
    ) VALUES (?, ?, ?, ?, 'un', ?, 100, ?, ?, ?, 0, ?, 1)`,
    [codigo, nome, cat.id, sub.id, precoCompra, precoVenda, estoque, estoque, itemFiscal]
  );
  return { id: ins.lastID, categoriaId: cat.id, subcategoriaId: sub.id };
}

function linhaPlanilhaReal(codigo, nome, overrides = {}) {
  return {
    Código: codigo,
    Produto: nome,
    Quantidade: null,
    'Custo Unitário': null,
    'Preço de Venda': null,
    Categoria: 'Cat V11',
    Subcategoria: 'Sub V11',
    ...overrides
  };
}

describe('V1.1.7 — headers reais da planilha', () => {
  it('Preço de Venda e Custo Unitário são reconhecidos; 0 não é vazio', () => {
    const p = mapearLinhaProduto({
      Código: 'A1',
      Produto: 'Item',
      'Custo Unitário': 0,
      'Preço de Venda': 25,
      Quantidade: null
    });
    assert.equal(p.custo_informado, 0);
    assert.equal(p.preco_informado, 25);
    assert.equal(p.quantidade_documento, null);

    const vazio = mapearLinhaProduto({
      Código: 'A2',
      Produto: 'Item 2',
      'Custo Unitário': null,
      'Preço de Venda': null
    });
    assert.equal(vazio.custo_informado, null);
    assert.equal(vazio.preco_informado, null);

    const compra = mapearLinhaProduto({
      Código: 'A3',
      Produto: 'Item 3',
      'Preço de Compra': 12,
      'Preço Unitário': 30
    });
    assert.equal(compra.custo_informado, 12);
    assert.equal(compra.preco_informado, 30);
  });
});

describe('V1.1.7 — produto existente custo/preço', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v117-'));
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

  it('custo 12 e venda 25: atualiza ambos, EXISTENTE_ATUALIZAR, prévia com seta', async () => {
    const { id, categoriaId, subcategoriaId } = await inserirProdutoExistente(db, {
      codigo: 'T10', nome: 'CASO 10-20', precoCompra: 10, precoVenda: 20, estoque: 40
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaPlanilhaReal('T10', 'CASO 10-20', {
        'Custo Unitário': 12,
        'Preço de Venda': 25
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-ambos.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    const linha = validacao.linhas[0];
    assert.equal(linha.status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.resumo.produtos_a_atualizar, 1);
    assert.equal(validacao.resumo.atualizacoes_custo, 1);
    assert.equal(validacao.resumo.atualizacoes_preco_venda, 1);
    assert.equal(linha.preview_atualizacao.custo_exibicao, 'R$ 10,00 → R$ 12,00');
    assert.equal(linha.preview_atualizacao.preco_exibicao, 'R$ 20,00 → R$ 25,00');
    assert.equal(linha.preview_atualizacao.alterar_estoque, false);

    await executarImportacao(db, validacao, { importId: 'v117-ambos', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 12);
    assert.equal(Number(p.preco_venda), 25);
    assert.equal(Number(p.estoque_atual), 40);
    assert.equal(Number(p.categoria_id), Number(categoriaId));
    assert.equal(Number(p.subcategoria_id), Number(subcategoriaId));
    assert.equal(Number(p.item_fiscal), 1);

    const deNovo = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-ambos.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(deNovo.linhas[0].status, STATUS.EXISTENTE);
    assert.equal(deNovo.resumo.produtos_a_atualizar, 0);
    assert.equal(deNovo.resumo.atualizacoes_custo, 0);
    assert.equal(deNovo.resumo.atualizacoes_preco_venda, 0);
    assert.equal(deNovo.linhas[0].preview_atualizacao.custo_exibicao, 'R$ 12,00');
    assert.equal(deNovo.linhas[0].preview_atualizacao.preco_exibicao, 'R$ 25,00');
    assert.equal(deNovo.linhas[0].preview_atualizacao.custo_sem_alteracao, true);
    assert.equal(deNovo.linhas[0].preview_atualizacao.preco_sem_alteracao, true);
    assert.equal(deNovo.linhas[0].preview_atualizacao.label_sem_alteracao, LABEL_SEM_ALTERACAO);
  });

  it('custo vazio e venda 25: só atualiza preco_venda', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'T11', nome: 'SO SO VENDA', precoCompra: 10, precoVenda: 20, estoque: 15
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaPlanilhaReal('T11', 'SO SO VENDA', { 'Preço de Venda': 25 })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-venda.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.resumo.atualizacoes_custo, 0);
    assert.equal(validacao.resumo.atualizacoes_preco_venda, 1);
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_custo_label, LABEL_NAO_ALTERAR);
    assert.equal(validacao.linhas[0].preview_atualizacao.custo_exibicao, 'R$ 10,00');
    assert.equal(validacao.linhas[0].preview_atualizacao.preco_exibicao, 'R$ 20,00 → R$ 25,00');

    await executarImportacao(db, validacao, { importId: 'v117-venda', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 10);
    assert.equal(Number(p.preco_venda), 25);
    assert.equal(Number(p.estoque_atual), 15);
  });

  it('custo 12 e venda vazia: só atualiza preco_compra', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'T12', nome: 'SO SO CUSTO', precoCompra: 10, precoVenda: 20, estoque: 15
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaPlanilhaReal('T12', 'SO SO CUSTO', { 'Custo Unitário': 12 })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-custo.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.resumo.atualizacoes_custo, 1);
    assert.equal(validacao.resumo.atualizacoes_preco_venda, 0);
    assert.equal(validacao.linhas[0].preview_atualizacao.novo_preco_label, LABEL_NAO_ALTERAR);
    assert.equal(validacao.linhas[0].preview_atualizacao.custo_exibicao, 'R$ 10,00 → R$ 12,00');
    assert.equal(validacao.linhas[0].preview_atualizacao.preco_exibicao, 'R$ 20,00');

    await executarImportacao(db, validacao, { importId: 'v117-custo', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 12);
    assert.equal(Number(p.preco_venda), 20);
  });

  it('custo 10 e venda 20 iguais ao banco: EXISTENTE, nenhum UPDATE', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'T13', nome: 'IGUAL', precoCompra: 10, precoVenda: 20, estoque: 15
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaPlanilhaReal('T13', 'IGUAL', {
        'Custo Unitário': 10,
        'Preço de Venda': 20
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-igual.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE);
    assert.equal(validacao.resumo.produtos_a_atualizar, 0);
    assert.equal(validacao.resumo.atualizacoes_custo, 0);
    assert.equal(validacao.resumo.atualizacoes_preco_venda, 0);

    const r = await executarImportacao(db, validacao, { importId: 'v117-igual', pastaBackup, dbPath });
    assert.equal(r.relatorio.atualizacoes, 0);
    const p = await get(db, `SELECT preco_compra, preco_venda, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 10);
    assert.equal(Number(p.preco_venda), 20);
    assert.equal(Number(p.estoque_atual), 15);
  });

  it('custo 0 informado atualiza preco_compra para 0', async () => {
    const { id } = await inserirProdutoExistente(db, {
      codigo: 'T0', nome: 'ZERO', precoCompra: 10, precoVenda: 20, estoque: 8
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaPlanilhaReal('T0', 'ZERO', { 'Custo Unitário': 0 })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-zero.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.resumo.atualizacoes_custo, 1);
    await executarImportacao(db, validacao, { importId: 'v117-zero', pastaBackup, dbPath });
    const p = await get(db, `SELECT preco_compra, preco_venda, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.preco_compra), 0);
    assert.equal(Number(p.preco_venda), 20);
    assert.equal(Number(p.estoque_atual), 8);
  });

  it('classificação existente não é sobrescrita pela planilha', async () => {
    const { id, categoriaId, subcategoriaId } = await inserirProdutoExistente(db, {
      codigo: 'T14', nome: 'CAT PRES', precoCompra: 10, precoVenda: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaPlanilhaReal('T14', 'CAT PRES', {
        'Preço de Venda': 22,
        Categoria: 'Outra Categoria',
        Subcategoria: 'Outra Sub'
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-cat.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    await executarImportacao(db, validacao, { importId: 'v117-cat', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id, preco_venda FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.categoria_id), Number(categoriaId));
    assert.equal(Number(p.subcategoria_id), Number(subcategoriaId));
    assert.equal(Number(p.preco_venda), 22);
  });

  it('106 produtos: venda reconhecida, importação e idempotência', async () => {
    const linhas = [];
    for (let i = 1; i <= 106; i += 1) {
      const codigo = `P${String(i).padStart(3, '0')}`;
      await inserirProdutoExistente(db, {
        codigo,
        nome: `Prod ${i}`,
        precoCompra: 10,
        precoVenda: 20,
        estoque: 7
      });
      linhas.push(linhaPlanilhaReal(codigo, `Prod ${i}`, { 'Preço de Venda': 25 }));
    }
    const buffer = svc.gerarXlsxFixture({ produtos: linhas });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-106.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.resumo.produtos_encontrados, 106);
    assert.equal(validacao.resumo.produtos_existentes, 106);
    assert.equal(validacao.resumo.produtos_a_atualizar, 106);
    assert.equal(validacao.resumo.atualizacoes_custo, 0);
    assert.equal(validacao.resumo.atualizacoes_preco_venda, 106);
    assert.ok(validacao.linhas.every((l) => l.status === STATUS.EXISTENTE_ATUALIZAR));
    assert.ok(validacao.linhas.every((l) => l.preview_atualizacao.preco_exibicao === 'R$ 20,00 → R$ 25,00'));
    assert.ok(validacao.linhas.every((l) => l.preview_atualizacao.custo_exibicao === 'R$ 10,00'));
    assert.ok(validacao.linhas.every((l) => l.preview_atualizacao.alterar_estoque === false));

    await executarImportacao(db, validacao, { importId: 'v117-106', pastaBackup, dbPath });
    const depois = await all(db, `SELECT preco_compra, preco_venda, estoque_atual FROM produtos WHERE codigo LIKE 'P%'`);
    assert.equal(depois.length, 106);
    for (const p of depois) {
      assert.equal(Number(p.preco_compra), 10);
      assert.equal(Number(p.preco_venda), 25);
      assert.equal(Number(p.estoque_atual), 7);
    }

    const deNovo = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v117-106.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.ok(deNovo.linhas.every((l) => l.status === STATUS.EXISTENTE));
    assert.equal(deNovo.resumo.produtos_a_atualizar, 0);
    assert.equal(deNovo.resumo.atualizacoes_preco_venda, 0);
  });
});

describe('V1.1.7 — prévia UI', () => {
  it('resumo e detalhe mostram custo/venda com seta e sem alteração', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /Atualizações de custo/);
    assert.match(src, /Atualizações de preço de venda/);
    assert.match(src, /Produtos a atualizar/);
    assert.match(src, /sem alteração/);
    assert.match(src, /não alterar/);
    assert.match(src, /EXISTENTE — ATUALIZAR/);
    assert.match(src, /htmlCampoMoedaExistente/);
  });
});
