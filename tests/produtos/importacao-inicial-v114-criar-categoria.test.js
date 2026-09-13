/**
 * V1.1.4 — Criação automática de categoria/subcategoria no Importador Inicial.
 * Executar: node --test tests/produtos/importacao-inicial-v114-criar-categoria.test.js
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
  CONFIANCA,
  ORIGEM,
  STATUS_CLASSIFICACAO,
  chaveCategoriaEquivalente
} = require('../../backend/services/importacao-inicial-produtos/classificadorCategoria');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');

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
  await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('Luz', 'despesa', 1)`);
  await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('TESTE', 'produto', 0)`);
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA V114',
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

function catalogoVazioComBloqueios() {
  return {
    categorias: [
      { id: 1, nome: 'Luz', tipo: 'despesa', ativo: 1 },
      { id: 2, nome: 'TESTE', tipo: 'produto', ativo: 0 }
    ],
    subcategorias: []
  };
}

describe('V1.1.4 — classificador cria estrutura virtual', () => {
  it('equivalência ignora caixa e espaços', () => {
    assert.equal(chaveCategoriaEquivalente('Hidráulica'), chaveCategoriaEquivalente('HIDRÁULICA'));
    assert.equal(chaveCategoriaEquivalente('Hidráulica'), chaveCategoriaEquivalente('hidráulica '));
    assert.equal(chaveCategoriaEquivalente('Hidráulica'), chaveCategoriaEquivalente('Hidraulica'));
  });

  it('sem catálogo: JOELHO não fica PENDENTE — marca criação', () => {
    const r = classificarProduto({ descricao: 'JOELHO 90 SOLD 25MM' }, catalogoVazioComBloqueios());
    assert.equal(r.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
    assert.equal(r.confianca, CONFIANCA.ALTA);
    assert.equal(r.categoria_nome, 'Hidráulica');
    assert.equal(r.subcategoria_nome, 'Tubos e Conexões');
    assert.equal(r.criar_categoria, true);
    assert.equal(r.criar_subcategoria, true);
    assert.equal(r.origem, ORIGEM.NOVA_CATEGORIA);
  });

  it('categoria de despesa continua bloqueada', () => {
    const r = classificarProduto(
      { descricao: 'LÂMPADA', categoriaInformada: 'Luz' },
      catalogoVazioComBloqueios()
    );
    assert.equal(r.status, STATUS_CLASSIFICACAO.CATEGORIA_NAO_ENCONTRADA);
    assert.equal(r.criar_categoria, false);
  });
});

describe('V1.1.4 — importação cria/reutiliza categoria e subcategoria', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v114-'));
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

  it('1) categoria existente → reutiliza', async () => {
    await run(db, `INSERT INTO categorias (nome, tipo, ativo) VALUES ('Hidráulica', 'produto', 1)`);
    const hidro = await get(db, `SELECT id FROM categorias WHERE nome = 'Hidráulica'`);
    await run(db, `INSERT INTO subcategorias (nome, categoria_id, ativo) VALUES ('Tubos e Conexões', ?, 1)`, [hidro.id]);
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C1', 'JOELHO 90 SOLD 25MM')]
    }), { nomeArquivo: 'c1.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].classificacao.criar_categoria, false);
    assert.equal(Number(v.linhas[0].classificacao.categoria_id), Number(hidro.id));
    await executarImportacao(db, v, { importId: 'c1', pastaBackup, dbPath });
    const qtd = await get(db, `SELECT COUNT(*) AS c FROM categorias WHERE tipo = 'produto' AND ativo = 1`);
    assert.equal(Number(qtd.c), 1);
    const p = await get(db, `SELECT categoria_id FROM produtos WHERE codigo = 'C1'`);
    assert.equal(Number(p.categoria_id), Number(hidro.id));
  });

  it('2) categoria inexistente → cria', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C2', 'DISJUNTOR MON 20A')]
    }), { nomeArquivo: 'c2.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    assert.equal(v.linhas[0].classificacao.criar_categoria, true);
    assert.equal(v.resumo.categorias_novas, 1);
    assert.equal(await get(db, `SELECT id FROM categorias WHERE nome = 'Elétrica'`), null);
    await executarImportacao(db, v, { importId: 'c2', pastaBackup, dbPath });
    const cat = await get(db, `SELECT tipo, ativo FROM categorias WHERE nome = 'Elétrica'`);
    assert.equal(cat.tipo, 'produto');
    assert.equal(Number(cat.ativo), 1);
  });

  it('3) categoria equivalente → não duplica', async () => {
    const antes = await get(db, `SELECT COUNT(*) AS c FROM categorias WHERE tipo = 'produto'`);
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C3', 'LUVA SOLD 25MM', { Categoria: 'HIDRÁULICA  ' })]
    }), { nomeArquivo: 'c3.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].classificacao.criar_categoria, false);
    await executarImportacao(db, v, { importId: 'c3', pastaBackup, dbPath });
    const depois = await get(db, `SELECT COUNT(*) AS c FROM categorias WHERE tipo = 'produto'`);
    assert.equal(Number(depois.c), Number(antes.c));
  });

  it('4) subcategoria existente → reutiliza', async () => {
    const hidro = await get(db, `SELECT id FROM categorias WHERE nome = 'Hidráulica'`);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = 'Tubos e Conexões' AND categoria_id = ?`, [hidro.id]);
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C4', 'BUCHA SOLD 20MM')]
    }), { nomeArquivo: 'c4.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].classificacao.criar_subcategoria, false);
    await executarImportacao(db, v, { importId: 'c4', pastaBackup, dbPath });
    const p = await get(db, `SELECT subcategoria_id FROM produtos WHERE codigo = 'C4'`);
    assert.equal(Number(p.subcategoria_id), Number(sub.id));
  });

  it('5/6) subcategoria inexistente → cria vinculada à categoria correta', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C5', 'PRODUTO NOVO SUB', {
        Categoria: 'Hidráulica',
        Subcategoria: 'Reservatórios Novos'
      })]
    }), { nomeArquivo: 'c5.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].classificacao.criar_subcategoria, true);
    assert.equal(v.resumo.subcategorias_novas, 1);
    await executarImportacao(db, v, { importId: 'c5', pastaBackup, dbPath });
    const hidro = await get(db, `SELECT id FROM categorias WHERE nome = 'Hidráulica'`);
    const sub = await get(db, `SELECT categoria_id FROM subcategorias WHERE nome = 'Reservatórios Novos'`);
    assert.equal(Number(sub.categoria_id), Number(hidro.id));
  });

  it('7) categoria de despesa nunca é utilizada nem criada como produto', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C7', 'CONTA LUZ', { Categoria: 'Luz' })]
    }), { nomeArquivo: 'c7.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.CATEGORIA_NAO_ENCONTRADA);
    const luzProd = await get(db, `SELECT id FROM categorias WHERE nome = 'Luz' AND tipo = 'produto'`);
    assert.equal(luzProd, null);
  });

  it('8) produto existente classificado → preserva', async () => {
    const hidro = await get(db, `SELECT id FROM categorias WHERE nome = 'Hidráulica'`);
    const tubos = await get(db, `SELECT id FROM subcategorias WHERE nome = 'Tubos e Conexões' AND categoria_id = ?`, [hidro.id]);
    await run(db, `INSERT INTO produtos (codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra, preco_venda, estoque_atual, item_fiscal, controla_estoque)
      VALUES ('C8', 'EXIST CLASSIF', ?, ?, 'un', 5, 12, 2, 1, 1)`, [hidro.id, tubos.id]);
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C8', 'EXIST CLASSIF', {
        Categoria: 'Elétrica',
        Subcategoria: 'Materiais Elétricos',
        'Qtd documento': 1
      })]
    }), { nomeArquivo: 'c8.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].classificacao.origem, ORIGEM.BANCO);
    await executarImportacao(db, v, { importId: 'c8', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE codigo = 'C8'`);
    assert.equal(Number(p.categoria_id), Number(hidro.id));
    assert.equal(Number(p.subcategoria_id), Number(tubos.id));
  });

  it('9) produto existente sem categoria → classifica e pode criar', async () => {
    await run(db, `INSERT INTO produtos (codigo, nome, unidade, preco_compra, preco_venda, estoque_atual, item_fiscal, controla_estoque)
      VALUES ('C9', 'GANCHO PITÃO 8MM', 'un', 5, 12, 1, 1, 1)`);
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C9', 'GANCHO PITÃO 8MM', { 'Qtd documento': 1 })]
    }), { nomeArquivo: 'c9.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(v.linhas[0].classificacao.categoria_nome, 'Ferragens');
    await executarImportacao(db, v, { importId: 'c9', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id FROM produtos WHERE codigo = 'C9'`);
    const cat = await get(db, `SELECT nome, tipo FROM categorias WHERE id = ?`, [p.categoria_id]);
    assert.equal(cat.nome, 'Ferragens');
    assert.equal(cat.tipo, 'produto');
  });

  it('10) produto novo → cria produto + classificação', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C10', 'LIXA DÁGUA 100')]
    }), { nomeArquivo: 'c10.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
    await executarImportacao(db, v, { importId: 'c10', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id FROM produtos WHERE codigo = 'C10'`);
    const cat = await get(db, `SELECT nome FROM categorias WHERE id = ?`, [p.categoria_id]);
    const sub = await get(db, `SELECT nome, categoria_id FROM subcategorias WHERE id = ?`, [p.subcategoria_id]);
    assert.equal(cat.nome, 'Ferramentas');
    assert.equal(sub.nome, 'Discos e Abrasivos');
    assert.equal(Number(sub.categoria_id), Number(p.categoria_id));
  });

  it('11) pendente real continua bloqueando', async () => {
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C11', 'JOGO DE SOQUETES 1/2')]
    }), { nomeArquivo: 'c11.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    assert.equal(v.pode_importar, true);
    await assert.rejects(
      () => executarImportacao(db, v, { importId: 'c11', pastaBackup, dbPath }),
      /politica_pendentes/
    );
    assert.equal(await get(db, `SELECT id FROM produtos WHERE codigo = 'C11'`), null);
  });

  it('12) rollback remove criação parcial', async () => {
    const antes = await get(db, `SELECT id FROM categorias WHERE nome = 'Materiais de Construção'`);
    assert.equal(antes, null);
    const v = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C12', 'TELHA FIBROCIMENTO', { 'Custo unitário': 11 })]
    }), { nomeArquivo: 'c12.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v.linhas[0].classificacao.criar_categoria, true);
    await assert.rejects(
      () => executarImportacao(db, v, {
        importId: 'c12', pastaBackup, dbPath, forcarFalhaEstoque: true
      }),
      /Falha forçada/
    );
    assert.equal(await get(db, `SELECT id FROM categorias WHERE nome = 'Materiais de Construção'`), null);
    assert.equal(await get(db, `SELECT id FROM produtos WHERE codigo = 'C12'`), null);
  });

  it('13) reimportação não cria categorias duplicadas', async () => {
    const v1 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C13', 'ABRAÇADEIRA TIPO U 3/4')]
    }), { nomeArquivo: 'c13.xlsx', modo_fiscal_importacao: 'FISCAL' });
    await executarImportacao(db, v1, { importId: 'c13', pastaBackup, dbPath });
    const meio = await all(db, `SELECT id FROM categorias WHERE nome = 'Ferragens'`);
    assert.equal(meio.length, 1);
    const v2 = await svc.validarArquivoBuffer(db, svc.gerarXlsxFixture({
      produtos: [linhaProduto('C13B', 'GANCHO PITÃO 10MM')]
    }), { nomeArquivo: 'c13b.xlsx', modo_fiscal_importacao: 'FISCAL' });
    assert.equal(v2.linhas[0].classificacao.criar_categoria, false);
    await executarImportacao(db, v2, { importId: 'c13b', pastaBackup, dbPath });
    const fim = await all(db, `SELECT id FROM categorias WHERE nome = 'Ferragens'`);
    assert.equal(fim.length, 1);
  });
});

describe('V1.1.4 — prévia UI', () => {
  it('resumo e origem de categoria nova', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /Categorias novas/);
    assert.match(src, /Subcategorias novas/);
    assert.match(src, /NOVA CATEGORIA — SERÁ CRIADA/);
    assert.match(src, /NOVA → será criada/);
  });
});
