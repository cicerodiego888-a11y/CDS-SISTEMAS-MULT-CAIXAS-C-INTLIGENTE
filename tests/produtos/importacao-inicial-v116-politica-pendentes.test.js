/**
 * V1.1.6 — Decisão do usuário sobre produtos sem classificação.
 * Executar: node --test tests/produtos/importacao-inicial-v116-politica-pendentes.test.js
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
  POLITICA_PENDENTES
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const { seedCatalogoOficialImportacao } = require('./helpers-seed-catalogo-importacao');

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

async function criarSchema(db, { seedOficial = true } = {}) {
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
  if (seedOficial) await seedCatalogoOficialImportacao(db, run, get);
  await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('Luz', 'despesa', 1)`);
  await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('TESTE', 'produto', 0)`);
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA V116',
    Categoria: overrides.Categoria === undefined ? '' : overrides.Categoria,
    Subcategoria: overrides.Subcategoria === undefined ? '' : overrides.Subcategoria,
    'Unidade base': 'UN',
    'Unidade origem': 'UN',
    'Qtd documento': 1,
    'Custo unitário': 10,
    'Markup %': 100,
    Fiscal: 'SIM',
    'Preço venda unitário': 20,
    ...overrides
  };
}

async function inserirExistente(db, {
  codigo, nome, estoque = 10, precoCompra = 5, precoVenda = 12, itemFiscal = 1,
  categoriaId = null, subcategoriaId = null
}) {
  const ins = await run(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
    ) VALUES (?, ?, ?, ?, 'un', ?, 100, ?, ?, ?, 0, ?, 1)`,
    [codigo, nome, categoriaId, subcategoriaId, precoCompra, precoVenda, estoque, itemFiscal === 1 ? estoque : 0, itemFiscal]
  );
  return ins.lastID;
}

describe('V1.1.6 — política de pendentes', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v116-'));
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

  it('1) pendente + IGNORAR não importa o pendente', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('V116-A1', 'JOELHO 90 SOLD 25MM'),
        linhaProduto('V116-P1', 'JOGO DE SOQUETES 1/2')
      ]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v116-ign.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.pode_importar, true);
    assert.equal(v.exige_politica_pendentes, true);
    const r = await executarImportacao(db, v, {
      importId: 'v116-ign', pastaBackup, dbPath,
      politica_pendentes: POLITICA_PENDENTES.IGNORAR
    });
    assert.equal(r.relatorio.ignorados, 1);
    assert.equal(r.relatorio.classificados, 1);
    assert.ok(await get(db, `SELECT id FROM produtos WHERE codigo = 'V116-A1'`));
    assert.equal(await get(db, `SELECT id FROM produtos WHERE codigo = 'V116-P1'`), null);
  });

  it('2) pendente + IMPORTAR_SEM_CLASSIFICACAO grava categoria NULL', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-P2', 'JOGO DE SOQUETES C/5PC')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v116-imp.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    const r = await executarImportacao(db, v, {
      importId: 'v116-imp', pastaBackup, dbPath,
      politica_pendentes: POLITICA_PENDENTES.IMPORTAR_SEM_CLASSIFICACAO
    });
    assert.equal(r.relatorio.importados, 1);
    assert.equal(r.relatorio.sem_classificacao, 1);
    const p = await get(db, `SELECT categoria_id, subcategoria_id, estoque_atual, item_fiscal FROM produtos WHERE codigo = 'V116-P2'`);
    assert.equal(p.categoria_id, null);
    assert.equal(p.subcategoria_id, null);
    assert.equal(Number(p.estoque_atual), 1);
    assert.equal(Number(p.item_fiscal), 1);
    const diversos = await get(db, `SELECT id FROM categorias WHERE nome IN ('Diversos', 'Outros', 'Sem Categoria') AND id = ?`, [p.categoria_id]);
    assert.equal(diversos, null);
  });

  it('3/4) classificado importa com IGNORAR e com IMPORTAR_SEM_CLASSIFICACAO', async () => {
    const v1 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-C1', 'JOELHO 45 SOLD 25MM')]
    }), { nomeArquivo: 'v116-c1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v1, {
      importId: 'v116-c1', pastaBackup, dbPath, politica_pendentes: POLITICA_PENDENTES.IGNORAR
    });
    const p1 = await get(db, `SELECT categoria_id FROM produtos WHERE codigo = 'V116-C1'`);
    assert.ok(p1.categoria_id);

    const v2 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-C2', 'JOELHO 90 ESG 40MM')]
    }), { nomeArquivo: 'v116-c2.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v2, {
      importId: 'v116-c2', pastaBackup, dbPath,
      politica_pendentes: POLITICA_PENDENTES.IMPORTAR_SEM_CLASSIFICACAO
    });
    const p2 = await get(db, `SELECT categoria_id FROM produtos WHERE codigo = 'V116-C2'`);
    assert.ok(p2.categoria_id);
  });

  it('5) existente sem categoria + classificação segura classifica', async () => {
    const id = await inserirExistente(db, { codigo: 'V116-E1', nome: 'JOELHO 90 SOLD 32MM', estoque: 4 });
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-E1', 'JOELHO 90 SOLD 32MM')]
    }), { nomeArquivo: 'v116-e1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    await executarImportacao(db, v, { importId: 'v116-e1', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`, [id]);
    assert.ok(p.categoria_id);
    assert.ok(p.subcategoria_id);
  });

  it('6) existente sem categoria + pendente + IGNORAR não altera', async () => {
    const id = await inserirExistente(db, { codigo: 'V116-E2', nome: 'FUNIL PLÁSTICO 1L', estoque: 7, precoCompra: 5 });
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-E2', 'FUNIL PLÁSTICO 1L', { 'Custo unitário': 9 })]
    }), { nomeArquivo: 'v116-e2.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    await executarImportacao(db, v, {
      importId: 'v116-e2', pastaBackup, dbPath, politica_pendentes: POLITICA_PENDENTES.IGNORAR
    });
    const p = await get(db, `SELECT categoria_id, preco_compra, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(p.categoria_id, null);
    assert.equal(Number(p.preco_compra), 5);
    assert.equal(Number(p.estoque_atual), 7);
  });

  it('7) existente sem categoria + pendente + IMPORTAR_SEM permanece NULL e atualiza custo/estoque', async () => {
    const id = await inserirExistente(db, { codigo: 'V116-E3', nome: 'GRAMPEADOR TAPECEIRO X', estoque: 2, precoCompra: 5, precoVenda: 12 });
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-E3', 'GRAMPEADOR TAPECEIRO X', {
        'Custo unitário': 8, 'Preço venda unitário': 18, 'Qtd documento': 3
      })]
    }), { nomeArquivo: 'v116-e3.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    await executarImportacao(db, v, {
      importId: 'v116-e3', pastaBackup, dbPath,
      politica_pendentes: POLITICA_PENDENTES.IMPORTAR_SEM_CLASSIFICACAO
    });
    const p = await get(db, `SELECT categoria_id, subcategoria_id, preco_compra, preco_venda, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(p.categoria_id, null);
    assert.equal(p.subcategoria_id, null);
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.preco_venda), 18);
    assert.equal(Number(p.estoque_atual), 5);
  });

  it('8) produto já classificado nunca é sobrescrito', async () => {
    const hidro = await get(db, `SELECT id FROM categorias WHERE nome = 'Hidráulica'`);
    const tubos = await get(db, `SELECT id FROM subcategorias WHERE nome = 'Tubos e Conexões' AND categoria_id = ?`, [hidro.id]);
    const id = await inserirExistente(db, {
      codigo: 'V116-E4', nome: 'DISJUNTOR 20A EXTRA', estoque: 3,
      categoriaId: hidro.id, subcategoriaId: tubos.id
    });
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-E4', 'DISJUNTOR 20A EXTRA')]
    }), { nomeArquivo: 'v116-e4.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v, { importId: 'v116-e4', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.categoria_id), Number(hidro.id));
    assert.equal(Number(p.subcategoria_id), Number(tubos.id));
  });

  it('9/10/11) quantidade idempotente; custo e preço informados', async () => {
    const v1 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-Q1', 'JOELHO 45 ESG 50MM', {
        'Qtd documento': 2, 'Custo unitário': 4.5, 'Preço venda unitário': 9
      })]
    }), { nomeArquivo: 'v116-q1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v1, { importId: 'v116-q1', pastaBackup, dbPath });
    const p1 = await get(db, `SELECT estoque_atual, preco_compra, preco_venda FROM produtos WHERE codigo = 'V116-Q1'`);
    assert.equal(Number(p1.estoque_atual), 2);
    assert.equal(Number(p1.preco_compra), 4.5);
    assert.equal(Number(p1.preco_venda), 9);
    const v2 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-Q1', 'JOELHO 45 ESG 50MM', {
        'Qtd documento': 2, 'Custo unitário': 4.5, 'Preço venda unitário': 9
      })]
    }), { nomeArquivo: 'v116-q1b.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v2, { importId: 'v116-q1b', pastaBackup, dbPath });
    const p2 = await get(db, `SELECT estoque_atual FROM produtos WHERE codigo = 'V116-Q1'`);
    assert.equal(Number(p2.estoque_atual), 2);
  });

  it('12) item_fiscal de existente é preservado', async () => {
    const id = await inserirExistente(db, {
      codigo: 'V116-F1', nome: 'JOELHO 90 SOLD 20MM', estoque: 1, itemFiscal: 0
    });
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-F1', 'JOELHO 90 SOLD 20MM')]
    }), { nomeArquivo: 'v116-f1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v, { importId: 'v116-f1', pastaBackup, dbPath });
    const p = await get(db, `SELECT item_fiscal FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.item_fiscal), 0);
  });

  it('16) politica_pendentes inválida é rejeitada', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-X1', 'JOGO DE SOQUETES ZZ')]
    }), { nomeArquivo: 'v116-x1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await assert.rejects(
      () => executarImportacao(db, v, {
        importId: 'v116-x1', pastaBackup, dbPath, politica_pendentes: 'ACEITAR_TUDO'
      }),
      /politica_pendentes inválida/
    );
    assert.equal(await get(db, `SELECT id FROM produtos WHERE codigo = 'V116-X1'`), null);
  });

  it('17) erro real faz rollback', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-RB', 'JOELHO 90 SOLD 50MM')]
    }), { nomeArquivo: 'v116-rb.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await assert.rejects(
      () => executarImportacao(db, v, {
        importId: 'v116-rb', pastaBackup, dbPath, forcarFalhaEstoque: true
      }),
      /Falha forçada/
    );
    assert.equal(await get(db, `SELECT id FROM produtos WHERE codigo = 'V116-RB'`), null);
  });
});

describe('V1.1.6 — criar categoria/sub ausentes', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v116b-'));
    dbPath = path.join(dir, 'teste.db');
    pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    db = await openDb(dbPath);
    await criarSchema(db, { seedOficial: false });
  });

  after(async () => {
    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('13/14) classificação segura cria categoria e subcategoria', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('V116-N1', 'TELHA FIBROCIMENTO')]
    }), { nomeArquivo: 'v116-n1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    assert.equal(v.linhas[0].classificacao.criar_categoria, true);
    await executarImportacao(db, v, { importId: 'v116-n1', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE codigo = 'V116-N1'`);
    const cat = await get(db, `SELECT nome, tipo FROM categorias WHERE id = ?`, [p.categoria_id]);
    const sub = await get(db, `SELECT nome FROM subcategorias WHERE id = ?`, [p.subcategoria_id]);
    assert.equal(cat.nome, 'Materiais de Construção');
    assert.equal(cat.tipo, 'produto');
    assert.equal(sub.nome, 'Telhas e Coberturas');
  });
});

describe('V1.1.6 — prévia UI', () => {
  it('15) confirmação exige escolha explícita; política vai no POST', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /PRODUTOS SEM CLASSIFICAÇÃO/);
    assert.match(src, /Não importar esses produtos/);
    assert.match(src, /Importar mesmo assim/);
    assert.match(src, /politica_pendentes/);
    assert.match(src, /Selecione o destino dos produtos sem classificação/);
    assert.match(src, /<th>Ação<\/th>/);
    assert.match(src, /NÃO SERÁ IMPORTADO/);
    assert.match(src, /IMPORTAR SEM CLASSIFICAÇÃO/);
    assert.match(src, /SERÁ CLASSIFICADO/);
    assert.match(src, /name="politicaPendentesImportacao"/);
    assert.doesNotMatch(src, /politicaPendentesImportacao" checked/);
  });
});
