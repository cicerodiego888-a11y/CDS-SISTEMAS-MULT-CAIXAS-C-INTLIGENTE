/**
 * V1.1.2 — Classificação automática assistida do Importador Inicial.
 * Executar: node --test tests/produtos/importacao-inicial-v112-classificacao.test.js
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
  STATUS
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const {
  classificarProduto,
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
      subcategorias.push({
        id: id++,
        nome: sub,
        categoria_id: cat.id,
        ativo: 1
      });
    }
  }
  categorias.push({ id: id++, nome: 'Luz', tipo: 'despesa', ativo: 1 });
  categorias.push({ id: id++, nome: 'TESTE', tipo: 'produto', ativo: 0 });
  return { categorias, subcategorias };
}

function classificar(descricao, extras = {}) {
  return classificarProduto({
    descricao,
    marca: extras.marca || '',
    categoriaInformada: extras.categoria || '',
    subcategoriaInformada: extras.subcategoria || ''
  }, extras.catalogo || catalogoComIds());
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
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA V112',
    Categoria: overrides.Categoria === undefined ? '' : overrides.Categoria,
    Subcategoria: overrides.Subcategoria === undefined ? '' : overrides.Subcategoria,
    'Unidade base': 'UN',
    'Unidade origem': 'UN',
    'Qtd documento': 5,
    'Custo unitário': 10,
    'Markup %': 100,
    Fiscal: 'SIM',
    'Preço venda unitário': 20,
    ...overrides
  };
}

describe('V1.1.2 — regras determinísticas do classificador', () => {
  const casosAltaHidraulica = [
    ['TE 50 SOLDÁVEL', 'TE'],
    ['JOELHO 90° SOLD 25MM', 'JOELHO'],
    ['BUCHA REDUÇÃO 25X20', 'BUCHA'],
    ['LUVA SOLD 25MM', 'LUVA SOLD'],
    ['CURVA 90 SOLD 32', 'CURVA'],
    ['UNIÃO SOLD 25', 'UNIÃO']
  ];

  for (const [descricao, rotulo] of casosAltaHidraulica) {
    it(`${rotulo} → Hidráulica / Tubos e Conexões`, () => {
      const r = classificar(descricao);
      assert.equal(r.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
      assert.equal(r.origem, ORIGEM.AUTOMATICA);
      assert.equal(r.confianca, CONFIANCA.ALTA);
      assert.equal(r.categoria_nome, 'Hidráulica');
      assert.equal(r.subcategoria_nome, 'Tubos e Conexões');
    });
  }

  it('LIXA → Ferramentas / Discos e Abrasivos', () => {
    const r = classificar('LIXA FERRO 80');
    assert.equal(r.categoria_nome, 'Ferramentas');
    assert.equal(r.subcategoria_nome, 'Discos e Abrasivos');
    assert.equal(r.confianca, CONFIANCA.ALTA);
  });

  it('DISJUNTOR → Elétrica / Materiais Elétricos', () => {
    const r = classificar('DISJUNTOR DIN 20A');
    assert.equal(r.categoria_nome, 'Elétrica');
    assert.equal(r.subcategoria_nome, 'Materiais Elétricos');
    assert.equal(r.confianca, CONFIANCA.ALTA);
  });

  it('INTERRUPTOR → Elétrica / Interruptores e Tomadas', () => {
    const r = classificar('INTERRUPTOR SIMPLES');
    assert.equal(r.categoria_nome, 'Elétrica');
    assert.equal(r.subcategoria_nome, 'Interruptores e Tomadas');
  });

  it('PLUG → Elétrica / Plugues e Conectores', () => {
    const r = classificar('PLUG MACHO 2P 10A');
    assert.equal(r.categoria_nome, 'Elétrica');
    assert.equal(r.subcategoria_nome, 'Plugues e Conectores');
  });

  it('ARAME → Materiais de Construção / Arames e Grampos', () => {
    const r = classificar('ARAME GALVANIZADO 18');
    assert.equal(r.categoria_nome, 'Materiais de Construção');
    assert.equal(r.subcategoria_nome, 'Arames e Grampos');
  });

  it('GANCHO → Ferragens / Ganchos e Pitões', () => {
    const r = classificar('GANCHO PITÃO 6MM');
    assert.equal(r.categoria_nome, 'Ferragens');
    assert.equal(r.subcategoria_nome, 'Ganchos e Pitões');
  });

  it('TELHA → Materiais de Construção / Telhas e Coberturas', () => {
    const r = classificar('TELHA FIBROCIMENTO 2,44M');
    assert.equal(r.categoria_nome, 'Materiais de Construção');
    assert.equal(r.subcategoria_nome, 'Telhas e Coberturas');
  });

  it('TRINCHA → Pintura e Adesivos, subcategoria null, confiança MÉDIA', () => {
    const r = classificar('TRINCHA 2.1/2');
    assert.equal(r.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
    assert.equal(r.categoria_nome, 'Pintura e Adesivos');
    assert.equal(r.subcategoria_id, null);
    assert.equal(r.confianca, CONFIANCA.MEDIA);
  });

  it('SOQUETE ambíguo → não forçar', () => {
    const r = classificar('SOQUETE 1/2 13MM');
    assert.equal(r.status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
    assert.equal(r.categoria_id, null);
  });

  it('JOGO DE SOQUETES → pendente', () => {
    const r = classificar('JOGO DE SOQUETES 1/2');
    assert.equal(r.status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
  });

  it('FUNIL / GRAMPEADOR / ÓLEO SINGER → pendente', () => {
    assert.equal(classificar('FUNIL PLÁSTICO').status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
    assert.equal(classificar('GRAMPEADOR TAPECEIRO').status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
    assert.equal(classificar('ÓLEO SINGER 100ML').status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
  });

  it('não usa Diversos para esconder ambiguidade', () => {
    const r = classificar('SOQUETE');
    assert.notEqual(r.categoria_nome, 'Diversos');
    assert.equal(r.status, STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO);
  });

  it('categoria informada no XLSX é respeitada', () => {
    const r = classificar('JOELHO 90', { categoria: 'Hidráulica' });
    assert.equal(r.origem, ORIGEM.XLSX);
    assert.equal(r.categoria_nome, 'Hidráulica');
    assert.equal(r.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
  });

  it('subcategoria incompatível → erro', () => {
    const r = classificar('JOELHO 90', {
      categoria: 'Hidráulica',
      subcategoria: 'Cabos e Fios'
    });
    assert.equal(r.status, STATUS_CLASSIFICACAO.SUBCATEGORIA_INCOMPATIVEL);
    assert.equal(r.categoria_nome, 'Hidráulica');
    assert.equal(r.subcategoria_id, null);
  });

  it('categoria inexistente → será criada (V1.1.4)', () => {
    const r = classificar('PRODUTO X', { categoria: 'Disjuntores' });
    assert.equal(r.status, STATUS_CLASSIFICACAO.CLASSIFICADO);
    assert.equal(r.criar_categoria, true);
    assert.equal(r.categoria_id, null);
    assert.equal(r.categoria_nome, 'Disjuntores');
    assert.equal(r.origem, ORIGEM.NOVA_CATEGORIA);
  });

  it('categoria de despesa não é aceita', () => {
    const r = classificar('LÂMPADA', { categoria: 'Luz' });
    assert.equal(r.status, STATUS_CLASSIFICACAO.CATEGORIA_NAO_ENCONTRADA);
  });

  it('CENTRO DIST / DISJ → Elétrica', () => {
    const r = classificar('CENTRO DIST. P/ 6/6 DISJ. BR 3215 R');
    assert.equal(r.categoria_nome, 'Elétrica');
    assert.equal(r.subcategoria_nome, 'Quadros de Distribuição');
  });

  it('ABRAÇADEIRA → Ferragens / Abraçadeiras', () => {
    const r = classificar('ABRAÇADEIRA TIPO U 3/4 INCA');
    assert.equal(r.categoria_nome, 'Ferragens');
    assert.equal(r.subcategoria_nome, 'Abraçadeiras');
  });
});

describe('V1.1.2 — importação (novo / existente / bloqueio)', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-v112-'));
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

  it('produto novo grava categoria e subcategoria automáticas', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-N1', 'JOELHO 90 SOLD 25MM')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-n1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(validacao.linhas[0].classificacao.categoria_nome, 'Hidráulica');
    assert.equal(validacao.linhas[0].classificacao.subcategoria_nome, 'Tubos e Conexões');
    assert.equal(validacao.linhas[0].classificacao.origem, ORIGEM.AUTOMATICA);
    await executarImportacao(db, validacao, { importId: 'v112-n1', pastaBackup, dbPath });
    const p = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['V112-N1']);
    const cat = await get(db, `SELECT nome FROM categorias WHERE id = ?`, [p.categoria_id]);
    const sub = await get(db, `SELECT nome, categoria_id FROM subcategorias WHERE id = ?`, [p.subcategoria_id]);
    assert.equal(cat.nome, 'Hidráulica');
    assert.equal(sub.nome, 'Tubos e Conexões');
    assert.equal(Number(sub.categoria_id), Number(p.categoria_id));
    assert.equal(Number(p.preco_compra), 10);
    assert.equal(Number(p.preco_venda), 20);
    assert.equal(Number(p.estoque_atual), 5);
  });

  it('produto existente não altera categoria nem subcategoria', async () => {
    const catOrig = await get(db, `SELECT id FROM categorias WHERE nome = 'Ferragens'`);
    const subOrig = await get(db, `SELECT id FROM subcategorias WHERE nome = 'Abraçadeiras' AND categoria_id = ?`, [catOrig.id]);
    await run(
      db,
      `INSERT INTO produtos (codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque)
       VALUES ('V112-E1', 'EXIST CLASSIF', ?, ?, 'un', 5, 12, 20, 20, 0, 1, 1)`,
      [catOrig.id, subOrig.id]
    );
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-E1', 'EXIST CLASSIF', {
        Categoria: 'Elétrica',
        Subcategoria: 'Materiais Elétricos',
        'Custo unitário': 8,
        'Preço venda unitário': 15,
        'Qtd documento': 10
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-e1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_ATUALIZAR);
    assert.equal(validacao.linhas[0].classificacao.origem, ORIGEM.BANCO);
    assert.equal(validacao.linhas[0].classificacao.status, STATUS_CLASSIFICACAO.PRESERVADO);
    await executarImportacao(db, validacao, { importId: 'v112-e1', pastaBackup, dbPath });
    const p = await get(db, `SELECT categoria_id, subcategoria_id, preco_compra, estoque_atual FROM produtos WHERE codigo = ?`, ['V112-E1']);
    assert.equal(Number(p.categoria_id), Number(catOrig.id));
    assert.equal(Number(p.subcategoria_id), Number(subOrig.id));
    assert.equal(Number(p.preco_compra), 8);
    assert.equal(Number(p.estoque_atual), 30);
  });

  it('produto sem classificação segura é bloqueado', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-P1', 'JOGO DE SOQUETES 1/2')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-p1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PENDENTE_CLASSIFICACAO);
    assert.equal(validacao.resumo.pendentes_classificacao, 1);
    assert.equal(validacao.exige_politica_pendentes, true);
    assert.equal(validacao.pode_importar, true);
    await assert.rejects(
      () => executarImportacao(db, validacao, { importId: 'v112-p1', pastaBackup, dbPath }),
      /politica_pendentes/
    );
    const row = await get(db, `SELECT id FROM produtos WHERE codigo = ?`, ['V112-P1']);
    assert.equal(row, null);
  });

  it('categoria de despesa no XLSX não é aceita', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-D1', 'CONTA DE LUZ', { Categoria: 'Luz' })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-d1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.CATEGORIA_NAO_ENCONTRADA);
    assert.equal(validacao.pode_importar, false);
  });

  it('subcategoria incompatível bloqueia', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-S1', 'JOELHO 90', {
        Categoria: 'Hidráulica',
        Subcategoria: 'Cabos e Fios'
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-s1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.SUBCATEGORIA_INCOMPATIVEL);
    assert.equal(validacao.pode_importar, false);
  });

  it('TRINCHA MÉDIA permanece importável (PRONTO)', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-T1', 'TRINCHA 2.1/2')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-t1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(validacao.linhas[0].classificacao.confianca, CONFIANCA.MEDIA);
    assert.equal(validacao.linhas[0].classificacao.subcategoria_id, null);
    assert.equal(validacao.pode_importar, true);
  });

  it('V1.1 custo/preço/estoque continua funcionando no produto novo', async () => {
    const p = await get(db, `SELECT preco_compra, preco_venda, estoque_atual FROM produtos WHERE codigo = ?`, ['V112-N1']);
    assert.equal(Number(p.preco_compra), 10);
    assert.equal(Number(p.preco_venda), 20);
    assert.equal(Number(p.estoque_atual), 5);
  });

  it('V1.0.14 GTIN continua no cadastro novo', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-G1', 'JOELHO 45 SOLD', { 'GTIN/EAN': '7891234567890' })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-g1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.PRONTO);
    assert.equal(validacao.linhas[0].produto.codigo_barras, '7891234567890');
    await executarImportacao(db, validacao, { importId: 'v112-g1', pastaBackup, dbPath });
    const row = await get(db, `SELECT codigo_barras FROM produtos WHERE codigo = ?`, ['V112-G1']);
    assert.equal(row.codigo_barras, '7891234567890');
  });

  it('V1.0.16 enriquecimento GTIN em existente continua', async () => {
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = 'Hidráulica'`);
    await run(
      db,
      `INSERT INTO produtos (codigo, nome, categoria_id, unidade, preco_compra, preco_venda, estoque_atual, item_fiscal, controla_estoque, codigo_barras)
       VALUES ('V112-G2', 'EXIST SEM GTIN', ?, 'un', 5, 12, 0, 1, 1, NULL)`,
      [cat.id]
    );
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-G2', 'EXIST SEM GTIN', {
        'GTIN/EAN': '7890000111111',
        'Qtd documento': 0,
        'Custo unitário': null,
        'Preço venda unitário': null
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-g2.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_APRESENTACAO_NOVA);
    await executarImportacao(db, validacao, { importId: 'v112-g2', pastaBackup, dbPath });
    const row = await get(db, `SELECT codigo_barras FROM produtos WHERE codigo = ?`, ['V112-G2']);
    assert.equal(row.codigo_barras, '7890000111111');
  });

  it('V1.0.18 Fiscal/Não Fiscal continua (novo NÃO FISCAL)', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-F1', 'TUBO SOLD 25MM')]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-f1.xlsx',
      modo_fiscal_importacao: 'NAO_FISCAL'
    });
    assert.equal(validacao.linhas[0].produto.item_fiscal, 0);
    await executarImportacao(db, validacao, { importId: 'v112-f1', pastaBackup, dbPath });
    const p = await get(db, `SELECT item_fiscal FROM produtos WHERE codigo = ?`, ['V112-F1']);
    assert.equal(Number(p.item_fiscal), 0);
  });

  it('não cria categoria nova', async () => {
    const antes = await get(db, `SELECT COUNT(*) AS c FROM categorias WHERE tipo = 'produto'`);
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProduto('V112-X1', 'PRODUTO SEM REGRA SEGURA')]
    });
    await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'v112-x1.xlsx',
      modo_fiscal_importacao: 'FISCAL'
    });
    const depois = await get(db, `SELECT COUNT(*) AS c FROM categorias WHERE tipo = 'produto'`);
    assert.equal(depois.c, antes.c);
    const inventada = await get(db, `SELECT id FROM categorias WHERE nome = 'Disjuntores'`);
    assert.equal(inventada, null);
  });
});

describe('V1.1.2 — prévia UI', () => {
  it('grade e detalhes expõem classificação; pendente exige escolha explícita', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    assert.match(src, /<th>Categoria<\/th>/);
    assert.match(src, /<th>Subcategoria<\/th>/);
    assert.match(src, /<th>Ação<\/th>/);
    assert.match(src, /politica_pendentes/);
    assert.match(src, /PRODUTOS SEM CLASSIFICAÇÃO/);
    assert.match(src, /Não importar esses produtos/);
    assert.match(src, /Importar mesmo assim/);
    assert.match(src, /Categoria informada/);
    assert.match(src, /Categoria sugerida/);
    assert.match(src, /Confiança/);
    assert.match(src, /pendentes_classificacao/);
    assert.match(src, /Existem produtos sem classificação segura/);
    assert.match(src, /REVISÃO NECESSÁRIA/);
    assert.match(src, /AUTOMÁTICA/);
  });
});
