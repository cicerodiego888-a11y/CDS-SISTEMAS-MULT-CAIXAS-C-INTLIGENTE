/**
 * V1.1.5 — ATENÇÃO com classificação ALTA/MÉDIA não bloqueia a importação.
 * Somente PENDENTE_CLASSIFICACAO / REVISÃO NECESSÁRIA bloqueiam.
 * Executar: node --test tests/produtos/importacao-inicial-v115-atencao-pendente.test.js
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
  linhaBloqueiaPorClassificacao,
  linhaAtencaoPermiteImportar
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const {
  CONFIANCA,
  STATUS_CLASSIFICACAO
} = require('../../backend/services/importacao-inicial-produtos/classificadorCategoria');
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

function linhaAtencao(nome, overrides = {}) {
  return {
    'Código origem': '',
    'Nome CDS': nome,
    Marca: '',
    Categoria: '',
    Subcategoria: '',
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

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA V115',
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

async function inserirExistente(db, { codigo, nome, estoque = 10, precoCompra = 5, precoVenda = 12 }) {
  const ins = await run(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque
    ) VALUES (?, ?, NULL, NULL, 'un', ?, 100, ?, ?, ?, 0, 1, 1)`,
    [codigo, nome, precoCompra, precoVenda, estoque, estoque]
  );
  return ins.lastID;
}

describe('V1.1.5 — helpers de bloqueio', () => {
  it('ATENÇÃO + ALTA/MÉDIA não bloqueia; REVISÃO e PENDENTE bloqueiam', () => {
    const alta = {
      status: STATUS.ATENCAO,
      classificacao: { status: STATUS_CLASSIFICACAO.CLASSIFICADO, confianca: CONFIANCA.ALTA }
    };
    const media = {
      status: STATUS.ATENCAO,
      classificacao: { status: STATUS_CLASSIFICACAO.CLASSIFICADO, confianca: CONFIANCA.MEDIA }
    };
    const revisao = {
      status: STATUS.ATENCAO,
      classificacao: { status: STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO, confianca: CONFIANCA.BAIXA }
    };
    const pendente = {
      status: STATUS.PENDENTE_CLASSIFICACAO,
      classificacao: { status: STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO }
    };

    assert.equal(linhaBloqueiaPorClassificacao(alta), false);
    assert.equal(linhaAtencaoPermiteImportar(alta), true);
    assert.equal(linhaBloqueiaPorClassificacao(media), false);
    assert.equal(linhaAtencaoPermiteImportar(media), true);
    assert.equal(linhaBloqueiaPorClassificacao(revisao), true);
    assert.equal(linhaAtencaoPermiteImportar(revisao), false);
    assert.equal(linhaBloqueiaPorClassificacao(pendente), true);
    assert.equal(linhaAtencaoPermiteImportar(pendente), false);
  });
});

describe('V1.1.5 — ATENÇÃO x PENDENTE', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v115-'));
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

  it('1) ATENÇÃO + ALTA → pode_importar = true e status permanece ATENÇÃO', async () => {
    await inserirExistente(db, { codigo: 'V115-A1', nome: 'ARAME GALVANIZADO' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaAtencao('ARAME GALVANIZADO')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-alta.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.ATENCAO);
    assert.equal(v.linhas[0].classificacao.confianca, CONFIANCA.ALTA);
    assert.equal(v.linhas[0].classificacao.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
    assert.equal(v.linhas[0].match_motivo, 'nome_sem_marca');
    assert.equal(v.resumo.pendentes_classificacao, 0);
    assert.equal(v.resumo.atencao_importaveis, 1);
    assert.equal(v.resumo.atualizacoes, 0);
    assert.equal(v.pode_importar, true);
  });

  it('2) ATENÇÃO + MÉDIA → pode_importar = true', async () => {
    await inserirExistente(db, { codigo: 'V115-M1', nome: 'TRINCHA 1"' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaAtencao('TRINCHA 1"')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-media.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.ATENCAO);
    assert.equal(v.linhas[0].classificacao.confianca, CONFIANCA.MEDIA);
    assert.equal(v.resumo.pendentes_classificacao, 0);
    assert.equal(v.pode_importar, true);
  });

  it('3) ATENÇÃO + REVISÃO NECESSÁRIA → pode_importar = false', async () => {
    await inserirExistente(db, { codigo: 'V115-R1', nome: 'JOGO DE SOQUETES' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaAtencao('JOGO DE SOQUETES')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-revisao.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.ATENCAO);
    assert.equal(v.linhas[0].classificacao.status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
    assert.equal(v.resumo.pendentes_classificacao, 1);
    assert.equal(v.resumo.atencao_importaveis, 0);
    assert.equal(v.pode_importar, true);
    await assert.rejects(
      () => executarImportacao(db, v, { importId: 'v115-rev', pastaBackup, dbPath }),
      /politica_pendentes/
    );
  });

  it('4) PENDENTE_CLASSIFICACAO exige política, não bloqueia sozinho', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V115-P1', 'JOGO DE SOQUETES 1/2')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-pend.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    assert.equal(v.resumo.pendentes_classificacao, 1);
    assert.equal(v.pode_importar, true);
  });

  it('5) arquivo só com ATENÇÕES seguras → importação permitida', async () => {
    await inserirExistente(db, { codigo: 'V115-D1', nome: 'DISJUNTOR MON/20A ELG' });
    await inserirExistente(db, { codigo: 'V115-D2', nome: 'DISJUNTOR 16A ENG' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaAtencao('DISJUNTOR MON/20A ELG'),
        linhaAtencao('DISJUNTOR 16A ENG')
      ]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-so-atencao.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas.every((l) => l.status === STATUS.ATENCAO), true);
    assert.equal(v.resumo.pendentes_classificacao, 0);
    assert.equal(v.resumo.atencao_importaveis, 2);
    assert.equal(v.pode_importar, true);
  });

  it('6) arquivo com pelo menos um PENDENTE → importação bloqueada', async () => {
    await inserirExistente(db, { codigo: 'V115-MIX', nome: 'JOELHO 90 SOLD 25MM' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaAtencao('JOELHO 90 SOLD 25MM'),
        linhaProduto('V115-PEND-MIX', 'JOGO DE SOQUETES C/5PC')
      ]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-mix.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.ok(v.linhas.some((l) => l.status === STATUS.ATENCAO));
    assert.ok(v.linhas.some((l) =>
      l.status === STATUS.PENDENTE_CLASSIFICACAO
      || (l.status === STATUS.ATENCAO && l.classificacao?.status === STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO)
    ));
    assert.ok(v.resumo.pendentes_classificacao >= 1);
    assert.equal(v.pode_importar, true);
  });

  it('7) match por nome + ALTA permanece ATENÇÃO e pode importar', async () => {
    await inserirExistente(db, { codigo: 'V115-N1', nome: 'GANCHO ZINCADO' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaAtencao('GANCHO ZINCADO')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-nome.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.ATENCAO);
    assert.equal(v.linhas[0].match_motivo, 'nome_sem_marca');
    assert.equal(v.linhas[0].classificacao.confianca, CONFIANCA.ALTA);
    assert.notEqual(v.linhas[0].status, STATUS.PRONTO);
    assert.notEqual(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(v.pode_importar, true);
    const r = await executarImportacao(db, v, { importId: 'v115-nome', pastaBackup, dbPath });
    assert.equal(r.sucesso, true);
  });

  it('EXISTENTE_ATUALIZAR com classificação segura não bloqueia', async () => {
    await inserirExistente(db, { codigo: 'V115-E1', nome: 'JOELHO 45 SOLD 25MM' });
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V115-E1', 'JOELHO 45 SOLD 25MM')]
    });
    const v = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v115-exist.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.ok(
      v.linhas[0].classificacao.confianca === CONFIANCA.ALTA
      || v.linhas[0].classificacao.confianca === CONFIANCA.MEDIA
    );
    assert.equal(v.pode_importar, true);
  });
});

describe('V1.1.5 — prévia UI', () => {
  it('botão usa pode_importar; ATENÇÃO visível; pendentes só bloqueiam revisão', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /data\.pode_importar/);
    assert.match(src, /atencao_importaveis/);
    assert.match(src, /ATENÇÃO/);
    assert.match(src, /SUGESTÃO DO IMPORTADOR/);
    assert.match(src, /Pendentes de classificação/);
    assert.match(src, /REVISÃO NECESSÁRIA/);
    assert.match(src, /<th>Status<\/th>/);
    assert.match(src, /<th>Classificação<\/th>/);
  });
});
