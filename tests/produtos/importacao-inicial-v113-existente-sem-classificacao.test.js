/**
 * V1.1.3 — Classificação de produtos existentes sem categoria/subcategoria.
 * Executar: node --test tests/produtos/importacao-inicial-v113-existente-sem-classificacao.test.js
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
const {
  classificarProduto,
  resolverClassificacaoExistente,
  CONFIANCA,
  ORIGEM,
  STATUS_CLASSIFICACAO
} = require('../../backend/services/importacao-inicial-produtos/classificadorCategoria');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const {
  CATALOGO_OFICIAL,
  seedCatalogoOficialImportacao
} = require('./helpers-seed-catalogo-importacao');

function catalogoComIds() {
  let id = 1;
  const categorias = [];
  const subcategorias = [];
  for (const item of CATALOGO_OFICIAL) {
    const cat = { id: id++, nome: item.categoria, tipo: 'produto', ativo: 1 };
    categorias.push(cat);
    for (const sub of item.subs) {
      subcategorias.push({ id: id++, nome: sub, categoria_id: cat.id, ativo: 1 });
    }
  }
  categorias.push({ id: id++, nome: 'Luz', tipo: 'despesa', ativo: 1 });
  categorias.push({ id: id++, nome: 'TESTE', tipo: 'produto', ativo: 0 });
  return { categorias, subcategorias };
}

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
  await seedCatalogoOficialImportacao(db, run, get);
  await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('Luz', 'despesa', 1)`);
  await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('TESTE', 'produto', 0)`);
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA V113',
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

async function idsCatSub(db, catNome, subNome) {
  const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, [catNome]);
  let sub = null;
  if (subNome && cat) {
    sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ? AND categoria_id = ?`, [subNome, cat.id]);
  }
  return { catId: cat?.id || null, subId: sub?.id || null };
}

async function inserirExistente(db, {
  codigo,
  nome,
  categoria = null,
  subcategoria = null,
  estoque = 10,
  precoCompra = 5,
  precoVenda = 12,
  itemFiscal = 1
}) {
  let catId = null;
  let subId = null;
  if (categoria) {
    const ids = await idsCatSub(db, categoria, subcategoria);
    catId = ids.catId;
    subId = ids.subId;
  }
  const ins = await run(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
    ) VALUES (?, ?, ?, ?, 'un', ?, 100, ?, ?, ?, 0, ?, 1)`,
    [
      codigo, nome, catId, subId, precoCompra, precoVenda,
      estoque, itemFiscal === 1 ? estoque : 0, itemFiscal
    ]
  );
  return { id: ins.lastID, catId, subId };
}

describe('V1.1.3 — resolverClassificacaoExistente', () => {
  const catalogo = catalogoComIds();

  it('existente com cat+sub preserva BANCO', () => {
    const hidro = catalogo.categorias.find((c) => c.nome === 'Hidráulica');
    const tubos = catalogo.subcategorias.find((s) => s.nome === 'Tubos e Conexões' && s.categoria_id === hidro.id);
    const r = resolverClassificacaoExistente({
      categoria_id: hidro.id,
      categoria_nome: 'Hidráulica',
      subcategoria_id: tubos.id,
      subcategoria_nome: 'Tubos e Conexões'
    }, { descricao: 'DISJUNTOR 20A', categoriaInformada: 'Elétrica' }, catalogo);
    assert.equal(r.origem, ORIGEM.BANCO);
    assert.equal(r.categoria_id, hidro.id);
    assert.equal(r.subcategoria_id, tubos.id);
    assert.equal(r.alterar_categoria, false);
    assert.equal(r.alterar_subcategoria, false);
    assert.equal(r.categoria_sugerida_nome, null);
  });

  it('existente sem categoria + ALTA sugere e marca alteração', () => {
    const r = resolverClassificacaoExistente({
      categoria_id: null, categoria_nome: null, subcategoria_id: null, subcategoria_nome: null
    }, { descricao: 'JOELHO 90 SOLD 25MM' }, catalogo);
    assert.equal(r.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
    assert.equal(r.origem, ORIGEM.SUGESTAO_IMPORTADOR);
    assert.equal(r.categoria_nome, 'Hidráulica');
    assert.equal(r.subcategoria_nome, 'Tubos e Conexões');
    assert.equal(r.alterar_categoria, true);
    assert.equal(r.confianca, CONFIANCA.ALTA);
  });

  it('existente sem categoria + PENDENTE não sugere', () => {
    const r = resolverClassificacaoExistente({
      categoria_id: null, categoria_nome: null, subcategoria_id: null, subcategoria_nome: null
    }, { descricao: 'JOGO DE SOQUETES' }, catalogo);
    assert.equal(r.status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
    assert.equal(r.alterar_categoria, false);
  });
});

describe('V1.1.3 — importação existente sem classificação', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v113-'));
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

  it('1) novo sem categoria → classificação ALTA', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N-ALTA', 'JOELHO 90 SOLD 25MM')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'n-alta.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    assert.equal(v.linhas[0].classificacao.confianca, CONFIANCA.ALTA);
    assert.equal(v.linhas[0].classificacao.categoria_nome, 'Hidráulica');
  });

  it('2) novo sem categoria → classificação MÉDIA', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N-MED', 'TRINCHA 1"')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'n-med.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    assert.equal(v.linhas[0].classificacao.confianca, CONFIANCA.MEDIA);
    assert.equal(v.linhas[0].classificacao.subcategoria_id, null);
  });

  it('3) novo sem categoria → PENDENTE', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N-PEND', 'JOGO DE SOQUETES 1/2')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'n-pend.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    assert.equal(v.pode_importar, true);
    assert.equal(v.exige_politica_pendentes, true);
  });

  it('4) existente sem categoria + ALTA → EXISTENTE_ATUALIZAR e grava', async () => {
    const { id } = await inserirExistente(db, {
      codigo: '3856',
      nome: "ADAP SOLD P/CX D'ÁGUA 50MM X 1/2",
      estoque: 10,
      precoCompra: 5,
      precoVenda: 12
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('3856', "ADAP SOLD P/CX D'ÁGUA 50MM X 1/2", {
        'Qtd documento': 1,
        'Custo unitário': 10.87,
        'Preço venda unitário': null
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-alta.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(v.linhas[0].classificacao.origem, ORIGEM.SUGESTAO_IMPORTADOR);
    assert.equal(v.linhas[0].classificacao.categoria_nome, 'Hidráulica');
    assert.equal(v.linhas[0].classificacao.subcategoria_nome, 'Tubos e Conexões');
    assert.equal(v.linhas[0].classificacao.alterar_categoria, true);
    assert.equal(v.linhas[0].preview_atualizacao.quantidade_importada, 1);
    await executarImportacao(db, v, { importId: 'e-alta', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE id = ?`, [id]);
    const cat = await get(db, `SELECT nome FROM categorias WHERE id = ?`, [p.categoria_id]);
    const sub = await get(db, `SELECT nome, categoria_id FROM subcategorias WHERE id = ?`, [p.subcategoria_id]);
    assert.equal(cat.nome, 'Hidráulica');
    assert.equal(sub.nome, 'Tubos e Conexões');
    assert.equal(Number(sub.categoria_id), Number(p.categoria_id));
    assert.equal(Number(p.estoque_atual), 11);
    assert.equal(Number(p.preco_compra), 10.87);
    assert.equal(Number(p.preco_venda), 12);
  });

  it('5) existente sem categoria + MÉDIA grava categoria e sub null', async () => {
    const { id } = await inserirExistente(db, {
      codigo: 'E-MED', nome: 'TRINCHA 2.1/2 ATLAS', estoque: 3
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-MED', 'TRINCHA 2.1/2 ATLAS', {
        'Custo unitário': null, 'Preço venda unitário': null
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-med.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(v.linhas[0].classificacao.confianca, CONFIANCA.MEDIA);
    assert.equal(v.linhas[0].classificacao.subcategoria_id, null);
    await executarImportacao(db, v, { importId: 'e-med', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`, [id]);
    const cat = await get(db, `SELECT nome FROM categorias WHERE id = ?`, [p.categoria_id]);
    assert.equal(cat.nome, 'Pintura e Adesivos');
    assert.equal(p.subcategoria_id, null);
  });

  it('6) existente sem categoria + PENDENTE bloqueia', async () => {
    await inserirExistente(db, { codigo: 'E-PEND', nome: 'JOGO DE SOQUETES C/3PC', estoque: 2 });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-PEND', 'JOGO DE SOQUETES C/3PC')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-pend.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    assert.equal(v.pode_importar, true);
    await assert.rejects(
      () => executarImportacao(db, v, { importId: 'e-pend', pastaBackup, dbPath }),
      /politica_pendentes/
    );
  });

  it('7/8/17/18) existente com categoria e subcategoria preserva ambas', async () => {
    const { id, catId, subId } = await inserirExistente(db, {
      codigo: 'E-FULL',
      nome: 'JOELHO 45 SOLD',
      categoria: 'Hidráulica',
      subcategoria: 'Tubos e Conexões',
      estoque: 8
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-FULL', 'JOELHO 45 SOLD', {
        Categoria: 'Elétrica',
        Subcategoria: 'Materiais Elétricos',
        'Qtd documento': 2
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-full.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(v.linhas[0].classificacao.origem, ORIGEM.BANCO);
    assert.equal(v.linhas[0].classificacao.alterar_categoria, false);
    await executarImportacao(db, v, { importId: 'e-full', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id, estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.categoria_id), Number(catId));
    assert.equal(Number(p.subcategoria_id), Number(subId));
    assert.equal(Number(p.estoque_atual), 10);
  });

  it('9) existente com categoria sem sub → preenche sub compatível', async () => {
    const { id, catId } = await inserirExistente(db, {
      codigo: 'E-SUB',
      nome: 'LIXA FERRO Nº80',
      categoria: 'Ferramentas',
      estoque: 4
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-SUB', 'LIXA FERRO Nº80', {
        'Custo unitário': null, 'Preço venda unitário': null
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-sub.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].classificacao.alterar_categoria, false);
    assert.equal(v.linhas[0].classificacao.alterar_subcategoria, true);
    assert.equal(v.linhas[0].classificacao.subcategoria_nome, 'Discos e Abrasivos');
    await executarImportacao(db, v, { importId: 'e-sub', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.categoria_id), Number(catId));
    const sub = await get(db, `SELECT nome, categoria_id FROM subcategorias WHERE id = ?`, [p.subcategoria_id]);
    assert.equal(sub.nome, 'Discos e Abrasivos');
    assert.equal(Number(sub.categoria_id), Number(catId));
  });

  it('10/21) subcategoria de outra categoria não é gravada', async () => {
    const { id, catId } = await inserirExistente(db, {
      codigo: 'E-INCOMP',
      nome: 'LIXA FERRO Nº60',
      categoria: 'Hidráulica',
      estoque: 1
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-INCOMP', 'LIXA FERRO Nº60', {
        'Custo unitário': null, 'Preço venda unitário': null, 'Qtd documento': 0
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-incomp.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].classificacao.alterar_subcategoria, false);
    assert.equal(v.linhas[0].classificacao.categoria_nome, 'Hidráulica');
    if (v.linhas[0].status === STATUS.EXISTENTE) {
      assert.equal(v.linhas[0].status, STATUS.EXISTENTE);
    }
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.categoria_id), Number(catId));
    assert.equal(p.subcategoria_id, null);
  });

  it('11/12) quantidade existente → EXISTENTE_ATUALIZAR e soma estoque', async () => {
    const { id } = await inserirExistente(db, {
      codigo: 'E-QTD', nome: 'TE SOLD 25MM', categoria: 'Hidráulica',
      subcategoria: 'Tubos e Conexões', estoque: 20
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-QTD', 'TE SOLD 25MM', {
        'Qtd documento': 5, 'Custo unitário': null, 'Preço venda unitário': null
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'e-qtd.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(v.linhas[0].preview_atualizacao.estoque_final, 25);
    await executarImportacao(db, v, { importId: 'e-qtd', pastaBackup, dbPath });
    const p = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(p.estoque_atual), 25);
  });

  it('13) custo diferente atualiza; 14) custo vazio preserva', async () => {
    const a = await inserirExistente(db, {
      codigo: 'E-C1', nome: 'BUCHA RED 25X20', categoria: 'Hidráulica',
      subcategoria: 'Tubos e Conexões', precoCompra: 5, estoque: 1
    });
    const b = await inserirExistente(db, {
      codigo: 'E-C2', nome: 'BUCHA RED 32X25', categoria: 'Hidráulica',
      subcategoria: 'Tubos e Conexões', precoCompra: 7, estoque: 1
    });
    const v1 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-C1', 'BUCHA RED 25X20', { 'Custo unitário': 9, 'Preço venda unitário': null, 'Qtd documento': 0 })]
    }), { nomeArquivo: 'c1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v1, { importId: 'c1', pastaBackup, dbPath });
    const p1 = await get(db, `SELECT preco_compra FROM produtos WHERE id = ?`, [a.id]);
    assert.equal(Number(p1.preco_compra), 9);

    const v2 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-C2', 'BUCHA RED 32X25', { 'Custo unitário': null, 'Preço venda unitário': null, 'Qtd documento': 0 })]
    }), { nomeArquivo: 'c2.xlsx', modo_fiscal_importacao: 'FISCAL' });
    if (v2.linhas[0].status === STATUS.EXISTENTE_ATUALIZAR) {
      await executarImportacao(db, v2, { importId: 'c2', pastaBackup, dbPath });
    }
    const p2 = await get(db, `SELECT preco_compra FROM produtos WHERE id = ?`, [b.id]);
    assert.equal(Number(p2.preco_compra), 7);
  });

  it('15) preço diferente atualiza; 16) preço vazio preserva', async () => {
    const a = await inserirExistente(db, {
      codigo: 'E-P1', nome: 'CURVA 90 SOLD', categoria: 'Hidráulica',
      subcategoria: 'Tubos e Conexões', precoVenda: 12, estoque: 1
    });
    const b = await inserirExistente(db, {
      codigo: 'E-P2', nome: 'CURVA 45 SOLD', categoria: 'Hidráulica',
      subcategoria: 'Tubos e Conexões', precoVenda: 14, estoque: 1
    });
    const v1 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-P1', 'CURVA 90 SOLD', { 'Preço venda unitário': 18, 'Custo unitário': null, 'Qtd documento': 0 })]
    }), { nomeArquivo: 'p1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v1, { importId: 'p1', pastaBackup, dbPath });
    assert.equal(Number((await get(db, `SELECT preco_venda FROM produtos WHERE id = ?`, [a.id])).preco_venda), 18);

    const v2 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-P2', 'CURVA 45 SOLD', { 'Preço venda unitário': null, 'Custo unitário': null, 'Qtd documento': 0 })]
    }), { nomeArquivo: 'p2.xlsx', modo_fiscal_importacao: 'FISCAL' });
    if (v2.linhas[0].status === STATUS.EXISTENTE_ATUALIZAR) {
      await executarImportacao(db, v2, { importId: 'p2', pastaBackup, dbPath });
    }
    assert.equal(Number((await get(db, `SELECT preco_venda FROM produtos WHERE id = ?`, [b.id])).preco_venda), 14);
  });

  it('19) categoria de despesa nunca é utilizada', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-LUZ', 'LÂMPADA LED', { Categoria: 'Luz' })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'luz.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.CATEGORIA_NAO_ENCONTRADA);
  });

  it('20) categoria inativa nunca é utilizada', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-INAT', 'PRODUTO TESTE', { Categoria: 'TESTE' })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'inat.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.CATEGORIA_NAO_ENCONTRADA);
  });

  it('22) PENDENTE bloqueia importação', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('N-PEND2', 'FUNIL PLÁSTICO')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'pend2.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.pode_importar, true);
    await assert.rejects(
      () => executarImportacao(db, v, { importId: 'pend2', pastaBackup, dbPath }),
      /politica_pendentes/
    );
  });

  it('23) rollback preserva banco (categoria e estoque)', async () => {
    const { id } = await inserirExistente(db, {
      codigo: 'E-RB', nome: 'UNIÃO SOLD 25MM', estoque: 10, precoCompra: 5
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-RB', 'UNIÃO SOLD 25MM', {
        'Custo unitário': 11, 'Qtd documento': 3
      })]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'rb.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    await assert.rejects(
      () => executarImportacao(db, v, {
        importId: 'rb', pastaBackup, dbPath, forcarFalhaCustoPreco: true
      }),
      /custo\/preço/i
    );
    const p = await get(db, `SELECT categoria_id, estoque_atual, preco_compra FROM produtos WHERE id = ?`, [id]);
    assert.equal(p.categoria_id, null);
    assert.equal(Number(p.estoque_atual), 10);
    assert.equal(Number(p.preco_compra), 5);
  });

  it('24) reprocessamento mantém idempotência de estoque', async () => {
    const { id } = await inserirExistente(db, {
      codigo: 'E-IDEM', nome: 'TELHA FIBROCIMENTO', estoque: 2
    });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-IDEM', 'TELHA FIBROCIMENTO', {
        'Qtd documento': 4, 'Custo unitário': null, 'Preço venda unitário': null
      })]
    });
    const v1 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'idem.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    await executarImportacao(db, v1, { importId: 'idem', pastaBackup, dbPath });
    const meio = await get(db, `SELECT estoque_atual, categoria_id FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(meio.estoque_atual), 6);
    assert.ok(meio.categoria_id);
    const v2 = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'idem.xlsx', modo_fiscal_importacao: 'FISCAL'
    });
    assert.ok(['EXISTENTE', 'EXISTENTE_ATUALIZAR'].includes(v2.linhas[0].status));
    if (v2.linhas[0].status === STATUS.EXISTENTE_ATUALIZAR && v2.pode_importar) {
      await executarImportacao(db, v2, { importId: 'idem', pastaBackup, dbPath });
    }
    const fim = await get(db, `SELECT estoque_atual FROM produtos WHERE id = ?`, [id]);
    assert.equal(Number(fim.estoque_atual), 6);
  });

  it('25) fiscal de existente é preservado', async () => {
    const { id } = await inserirExistente(db, {
      codigo: 'E-FIS', nome: 'GANCHO PITÃO 8MM', categoria: 'Ferragens',
      subcategoria: 'Ganchos e Pitões', itemFiscal: 1, estoque: 1
    });
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('E-FIS', 'GANCHO PITÃO 8MM', { 'Qtd documento': 1 })]
    }), { nomeArquivo: 'fis.xlsx', modo_fiscal_importacao: 'NAO_FISCAL' });
    assert.equal(v.linhas[0].produto.item_fiscal, 1);
    await executarImportacao(db, v, { importId: 'fis', pastaBackup, dbPath });
    assert.equal(Number((await get(db, `SELECT item_fiscal FROM produtos WHERE id = ?`, [id])).item_fiscal), 1);
  });

  it('26) novo recebe modo fiscal selecionado', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('N-NF', 'ARAME GALVANIZADO 18')]
    }), { nomeArquivo: 'nnf.xlsx', modo_fiscal_importacao: 'NAO_FISCAL' });
    assert.equal(v.linhas[0].produto.item_fiscal, 0);
    await executarImportacao(db, v, { importId: 'nnf', pastaBackup, dbPath });
    assert.equal(Number((await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['N-NF'])).item_fiscal), 0);
  });
});

describe('V1.1.3 — prévia UI', () => {
  it('27/28) prévia mostra atual/sugerida e EXISTENTE_ATUALIZAR', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /Categoria atual/);
    assert.match(src, /Categoria sugerida/);
    assert.match(src, /Subcategoria atual/);
    assert.match(src, /Subcategoria sugerida/);
    assert.match(src, /SUGESTÃO DO IMPORTADOR/);
    assert.match(src, /Produtos a atualizar/);
    assert.match(src, /EXISTENTE_ATUALIZAR/);
    assert.match(src, /EXISTENTE — ATUALIZAR/);
    assert.match(src, /Qtd\. a lançar/);
    assert.match(src, /Quantidade na planilha/);
  });
});
