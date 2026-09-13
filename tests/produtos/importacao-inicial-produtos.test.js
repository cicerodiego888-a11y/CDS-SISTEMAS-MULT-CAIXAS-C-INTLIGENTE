/**
 * Importação Inicial de Produtos V1.0.1 — testes (parser + abraçadeira + idempotência).
 * Executar: node --test tests/produtos/importacao-inicial-produtos.test.js
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
  calcularCustoUnitarioDeEmbalagem,
  calcularPrecoPorMarkup,
  calcularEstoqueInicial,
  resolverFatorConversao,
  calcularCustoTotalEstoqueInicial,
  MARKUP_PADRAO,
  mapearLinhaProduto,
  mapearLinhaApresentacao,
  chaveHeader
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { resolverCustosEPrecos, montarEstoquePreview } = require('../../backend/services/importacao-inicial-produtos/validator');
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

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function chaveEq(a, b) {
  return String(a || '').trim().toLocaleLowerCase('pt-BR') === String(b || '').trim().toLocaleLowerCase('pt-BR');
}

/** Linha no formato EXATO do XLSX oficial CDS. */
function linhaProdutoOficial(overrides = {}) {
  return {
    'Código origem': 12277,
    'Nome CDS': 'ABRAÇADEIRA NYLON 2,5 X 200MM',
    Marca: 'RAYCO',
    Categoria: 'Ferragens',
    Subcategoria: 'Abraçadeiras',
    'Unidade base': 'UN',
    'Unidade origem': 'PC',
    'Qtd documento': 1,
    'Custo unitário': 0.0389,
    'Markup %': 100,
    Fiscal: 'SIM',
    'Preço venda unitário': 0.0778,
    'Custo apresentação/origem': 3.89,
    'Total documento': 3.89,
    'Referência fabricante': 12114,
    Observações: '',
    ...overrides
  };
}

function linhaApresentacaoOficial(overrides = {}) {
  return {
    'Código origem': 12277,
    Tipo: 'PCT',
    Descrição: 'PACOTE COM 100 UN',
    'Quantidade conversão': 100,
    'Unidade base': 'UN',
    'Valor compra apresentação': 3.89,
    'Preço venda apresentação': 7.78,
    Principal: 1,
    Compra: 1,
    Venda: 1,
    Estoque: 1,
    Ativa: 1,
    Origem: 'IMPORTACAO',
    Observação: '',
    Classificação: 'FISCAL',
    ...overrides
  };
}

function gerarPlanilhaOficial112() {
  const produtos = [linhaProdutoOficial()];
  for (let i = 1; i < 112; i += 1) {
    produtos.push(linhaProdutoOficial({
      'Código origem': 20000 + i,
      'Nome CDS': `PRODUTO TESTE ${i}`,
      Marca: i % 2 === 0 ? 'RAYCO' : 'GENERICA',
      'Custo unitário': 1 + (i / 100),
      'Preço venda unitário': 2 + (i / 100),
      'Custo apresentação/origem': null,
      'Referência fabricante': 30000 + i
    }));
  }
  const apresentacoes = [linhaApresentacaoOficial()];
  for (let i = 1; i < 20; i += 1) {
    apresentacoes.push(linhaApresentacaoOficial({
      'Código origem': 20000 + i,
      Descrição: `PACOTE ${i}`,
      'Valor compra apresentação': 10 + i,
      'Preço venda apresentação': 20 + i
    }));
  }
  return svc.gerarXlsxFixture({ produtos, apresentacoes });
}

function gerarPlanilhaOficial348() {
  const produtos = [];
  const apresentacoes = [];
  for (let i = 0; i < 348; i += 1) {
    produtos.push(linhaProdutoOficial({
      'Código origem': 40000 + i,
      'Nome CDS': `PRODUTO LOTE 348 ${i}`,
      Marca: i % 2 === 0 ? 'RAYCO' : 'GENERICA',
      'Qtd documento': 1,
      'Custo unitário': 1 + (i / 100),
      'Preço venda unitário': 2 + (i / 100),
      'Custo apresentação/origem': null,
      'Referência fabricante': 50000 + i
    }));
  }
  return svc.gerarXlsxFixture({ produtos, apresentacoes });
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
    saldo_fiscal REAL, saldo_nao_fiscal REAL, item_fiscal INTEGER,
    permite_venda_unidade INTEGER, peso_medio_unidade REAL, preco_unidade REAL,
    marca_id INTEGER, observacoes TEXT, imagem_principal TEXT,
    unidade_comercial TEXT, quantidade_por_embalagem REAL, compra_por_embalagem INTEGER DEFAULT 0, valor_compra_embalagem REAL,
    updated_at DATETIME
  )`);
  await run(db, `CREATE TABLE produto_embalagens (
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
  await run(db, `CREATE TABLE produtos_ajustes_estoque (
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
  await seedParCategoriaSub(db, run, get, 'Ferragens', 'Abraçadeiras');
}

describe('V1.0.1 — normalização de cabeçalhos oficiais', () => {
  it('Nome CDS / Markup % / Custo unitário normalizam corretamente', () => {
    assert.equal(chaveHeader('Nome CDS'), 'nome_cds');
    assert.equal(chaveHeader('Markup %'), 'markup');
    assert.equal(chaveHeader('Custo unitário'), 'custo_unitario');
    assert.equal(chaveHeader('CUSTO UNITÁRIO'), 'custo_unitario');
    assert.equal(chaveHeader('Preço venda unitário'), 'preco_venda_unitario');
    assert.equal(chaveHeader('Quantidade conversão'), 'quantidade_conversao');
    assert.equal(chaveHeader('Valor compra apresentação'), 'valor_compra_apresentacao');
  });

  it('mapa da primeira linha (12277) com cabeçalhos oficiais', () => {
    const p = mapearLinhaProduto(linhaProdutoOficial());
    assert.equal(p.codigo_origem, '12277');
    assert.equal(p.nome, 'ABRAÇADEIRA NYLON 2,5 X 200MM');
    assert.equal(p.marca, 'RAYCO');
    assert.equal(p.categoria, 'Ferragens');
    assert.equal(p.subcategoria, 'Abraçadeiras');
    assert.equal(p.unidade_base, 'un');
    assert.equal(p.unidade_origem, 'PC');
    assert.equal(p.quantidade_documento, 1);
    assert.equal(p.custo_informado, 0.0389);
    assert.equal(p.markup, 100);
    assert.equal(p.preco_informado, 0.0778);
    assert.equal(p.custo_apresentacao, 3.89);
    assert.equal(p.referencia_fabricante, '12114');
    assert.equal(p.item_fiscal, 1);

    const a = mapearLinhaApresentacao(linhaApresentacaoOficial());
    assert.equal(a.codigo_origem, '12277');
    assert.equal(a.tipo, 'PCT');
    assert.equal(a.descricao, 'PACOTE COM 100 UN');
    assert.equal(a.quantidade, 100);
    assert.equal(a.unidade, 'un');
    assert.equal(a.custo, 3.89);
    assert.equal(a.preco, 7.78);
    assert.equal(a.principal, 1);
    assert.equal(a.fiscal_rotulo, 'FISCAL');
  });
});

describe('Importação Inicial — pricing abraçadeira (MotorUnidadesMedida)', () => {
  it('custo pacote 3,89 / 100 = 0,0389; markup 100%; preços corretos', () => {
    const custoUn = calcularCustoUnitarioDeEmbalagem(3.89, 100, 'PCT');
    assert.equal(custoUn, 0.0389);
    assert.equal(MARKUP_PADRAO, 100);

    const pricing = resolverCustosEPrecos(
      {
        nome: 'ABRAÇADEIRA NYLON 2,5 X 200MM',
        marca: 'RAYCO',
        markup: 100,
        unidade_base: 'UN',
        custo_informado: 0.0389,
        preco_informado: 0.0778
      },
      [{ tipo: 'PCT', quantidade: 100, unidade: 'UN', custo: 3.89, preco: 7.78, principal: 1 }]
    );
    assert.equal(pricing.custo_unitario, 0.0389);
    assert.equal(pricing.apresentacao_principal.preco, 7.78);
    assert.equal(pricing.preco_venda, 0.0778);
  });
});

describe('V1.0.3/V1.0.7 — estoque inicial e conversão (motor oficial)', () => {
  const { calcularFormacaoPrecoOficial } = require('../../backend/services/importacao-inicial-produtos/helpers');

  it('quantidade UN: 12 × 1 = 12', () => {
    const calc = calcularEstoqueInicial({ quantidadeDocumento: 12, fatorConversao: 1 });
    assert.equal(calc.estoque_inicial, 12);
  });

  it('conversão CX → UN e várias caixas', () => {
    assert.equal(calcularEstoqueInicial({ quantidadeDocumento: 1, fatorConversao: 12 }).estoque_inicial, 12);
    assert.equal(calcularEstoqueInicial({ quantidadeDocumento: 3, fatorConversao: 12 }).estoque_inicial, 36);
  });

  it('produto sem conversão usa fator 1', () => {
    const fator = resolverFatorConversao([]);
    assert.equal(fator.fator, 1);
    const calc = calcularEstoqueInicial({ quantidadeDocumento: 25, fatorConversao: fator.fator });
    assert.equal(calc.estoque_inicial, 25);
  });

  it('ADAPT FLANGE: 12 UN, custo 9,39, total 112,68, preço 18,78', () => {
    const produto = {
      nome: "ADAPT FLANGE P/ CX D'AGUA 20 X 1/2",
      unidade_base: 'UN',
      unidade_origem: 'UN',
      quantidade_documento: 12,
      markup: 100,
      custo_informado: 9.39,
      preco_informado: null
    };
    const pricing = resolverCustosEPrecos(produto, []);
    const estoque = montarEstoquePreview(produto, pricing);
    assert.equal(estoque.estoque_inicial, 12);
    assert.equal(Number(pricing.custo_unitario), 9.39);
    assert.equal(Number(pricing.preco_venda), 18.78);
    assert.equal(calcularCustoTotalEstoqueInicial({
      quantidadeOrigem: 12,
      custoUnitario: 9.39,
      apresentacao: null
    }), 112.68);
  });

  it('TINTA BISNAGA: 1 CX × 12 = 12 UN; custo/preço via MotorUnidadesMedida', () => {
    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 42.759,
      quantidadePorEmbalagem: 12,
      tipo: 'CX',
      markup: 100
    });
    // Custo 4 casas; preço unitário 4 casas (markup sem arredondar antes); apresentação moeda
    assert.equal(formacao.custo_unitario, 3.5633);
    assert.equal(formacao.preco_venda, 7.1266);
    assert.equal(formacao.preco_apresentacao, 85.52);

    const produto = {
      nome: 'TINTA BISNAGA AM C/ 12UN',
      unidade_base: 'UN',
      unidade_origem: 'CX',
      quantidade_documento: 1,
      markup: 100,
      custo_informado: null,
      preco_informado: null
    };
    const apr = [{ tipo: 'CX', quantidade: 12, unidade: 'UN', custo: 42.759, preco: null, principal: 1 }];
    const pricing = resolverCustosEPrecos(produto, apr);
    const estoque = montarEstoquePreview(produto, pricing);
    assert.equal(estoque.estoque_inicial, 12);
    assert.equal(Number(pricing.custo_unitario), 3.5633);
    assert.equal(Number(pricing.preco_venda), 7.1266);
    assert.equal(estoque.qtd_origem_label, '1 CX');
    assert.equal(estoque.conversao_label, '12 UN');
  });
});

describe('V1.0.1 — leitura planilha oficial (112 + 20)', () => {
  it('encontra 112 produtos e 20 apresentações; abraçadeira 12277 correta', () => {
    const buffer = gerarPlanilhaOficial112();
    const dados = svc.extrairDadosImportacao(buffer);
    assert.equal(dados.produtos.length, 112);
    assert.equal(dados.apresentacoes.length, 20);

    const abr = dados.produtos.find((p) => p.codigo_origem === '12277');
    assert.ok(abr);
    assert.equal(abr.nome, 'ABRAÇADEIRA NYLON 2,5 X 200MM');
    assert.equal(abr.marca, 'RAYCO');
    assert.equal(abr.custo_informado, 0.0389);
    assert.equal(abr.markup, 100);
    assert.equal(abr.preco_informado, 0.0778);
    assert.equal(abr.item_fiscal, 1);

    const apr = dados.apresentacoes.find((a) => a.codigo_origem === '12277');
    assert.ok(apr);
    assert.equal(apr.tipo, 'PCT');
    assert.equal(apr.quantidade, 100);
    assert.equal(apr.custo, 3.89);
    assert.equal(apr.preco, 7.78);
  });
});

describe('Importação Inicial — validação + importação + idempotência', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-imp-'));
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

  it('valida 112 produtos oficiais e importa abraçadeira com estoque inicial', async () => {
    const buffer = gerarPlanilhaOficial112();
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'CDS_Importacao_Produtos_PRODUTOS_FISCAL.xlsx'
    , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.produtos_encontrados, 112);
    assert.equal(validacao.resumo.com_erro, 0);
    assert.ok(validacao.resumo.produtos_validos >= 112);
    assert.ok(Number(validacao.resumo.estoque_inicial_total) > 0);

    const linha12277 = validacao.linhas.find((l) => l.produto.codigo_origem === '12277');
    assert.ok(linha12277);
    assert.equal(linha12277.produto.custo_unitario, 0.0389);
    assert.equal(linha12277.produto.markup, 100);
    assert.equal(linha12277.produto.item_fiscal, 1);
    assert.equal(linha12277.status, 'PRONTO');
    assert.equal(linha12277.estoque.estoque_inicial, 100); // 1 × 100
    assert.match(linha12277.estoque.estoque_inicial_label, /100/);

    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.criados, 112);
    assert.ok(resultado.relatorio.estoque_lancado > 0);
    assert.ok(resultado.relatorio.movimentacoes_estoque > 0);

    const produto = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['12277']);
    assert.ok(produto);
    assert.equal(produto.item_fiscal, 1);
    assert.equal(Number(produto.estoque_atual), 100);
    assert.equal(Number(produto.saldo_fiscal), 100);
    assert.equal(Number(produto.preco_compra), 0.0389);
    assert.equal(Number(produto.lucro_percentual), 100);

    const emb = await all(db, `SELECT * FROM produto_embalagens WHERE produto_id = ?`, [produto.id]);
    assert.equal(emb.length, 1);
    assert.equal(emb[0].tipo, 'PCT');
    assert.equal(Number(emb[0].quantidade), 100);
    assert.equal(emb[0].descricao, 'PACOTE COM 100 UN');
    assert.equal(Number(emb[0].valor_compra), 3.89);
    assert.equal(Number(emb[0].principal), 1);
    assert.equal(Number(emb[0].compra), 1);
    assert.equal(Number(emb[0].venda), 1);
    assert.equal(Number(emb[0].estoque), 1);
    assert.equal(Number(emb[0].ativa), 1);
    assert.equal(emb[0].origem, 'IMPORTACAO_INICIAL');

    const ajustes = await all(db, `
      SELECT * FROM produtos_ajustes_estoque
      WHERE produto_id = ? AND motivo LIKE 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS%'
    `, [produto.id]);
    assert.equal(ajustes.length, 1);
    assert.equal(Number(ajustes[0].ajuste_fiscal), 100);
  });

  it('segunda importação marca EXISTENTE e não duplica produto nem estoque', async () => {
    const buffer = gerarPlanilhaOficial112();
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'reimport.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.prontos, 0);
    assert.ok(validacao.resumo.existentes >= 112);

    const estoqueAntes = await get(db, `SELECT estoque_atual, saldo_fiscal FROM produtos WHERE codigo = ?`, ['12277']);
    const ajustesAntes = await get(db, `
      SELECT COUNT(*) AS c FROM produtos_ajustes_estoque
      WHERE motivo LIKE 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS%'
    `);

    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.criados, 0);
    assert.equal(resultado.relatorio.estoque_lancado, 0);

    const qtd = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(qtd.c, 112);
    const qtd12277 = await get(db, `SELECT COUNT(*) AS c FROM produtos WHERE codigo = ?`, ['12277']);
    assert.equal(qtd12277.c, 1);

    const estoqueDepois = await get(db, `SELECT estoque_atual, saldo_fiscal FROM produtos WHERE codigo = ?`, ['12277']);
    assert.equal(Number(estoqueDepois.estoque_atual), Number(estoqueAntes.estoque_atual));
    assert.equal(Number(estoqueDepois.saldo_fiscal), Number(estoqueAntes.saldo_fiscal));

    const ajustesDepois = await get(db, `
      SELECT COUNT(*) AS c FROM produtos_ajustes_estoque
      WHERE motivo LIKE 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS%'
    `);
    assert.equal(ajustesDepois.c, ajustesAntes.c);
  });

  it('planilha com 348 produtos valida contagem e estoque na prévia', async () => {
    const buffer = gerarPlanilhaOficial348();
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'lote348.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.produtos_encontrados, 348);
    assert.equal(validacao.resumo.com_erro, 0);
    assert.equal(validacao.resumo.estoque_inicial_total, 348); // 348 × 1 UN
  });

  it('rollback completo se falhar no estoque', async () => {
    const dirRb = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-imp-rb-'));
    const dbPathRb = path.join(dirRb, 'rb.db');
    const pastaBackupRb = path.join(dirRb, 'backups');
    fs.mkdirSync(pastaBackupRb);
    const dbRb = await openDb(dbPathRb);
    await criarSchema(dbRb);

    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProdutoOficial({
        'Código origem': 77701,
        'Nome CDS': 'PRODUTO ROLLBACK ESTOQUE',
        'Qtd documento': 5,
        'Custo unitário': 10,
        'Preço venda unitário': 20,
        'Custo apresentação/origem': null
      })]
    });
    const validacao = await svc.validarArquivoBuffer(dbRb, buffer, { nomeArquivo: 'rb.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.prontos, 1);

    await assert.rejects(
      () => executarImportacao(dbRb, validacao, {
        dbPath: dbPathRb,
        pastaBackup: pastaBackupRb,
        importId: validacao.sessao_id,
        forcarFalhaEstoque: true
      }),
      /Falha forçada/
    );

    const qtd = await get(dbRb, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(qtd.c, 0);
    const ajustes = await get(dbRb, `SELECT COUNT(*) AS c FROM produtos_ajustes_estoque`);
    assert.equal(ajustes.c, 0);

    await new Promise((resolve) => dbRb.close(() => resolve()));
    fs.rmSync(dirRb, { recursive: true, force: true });
  });

  it('marca e categoria são reutilizadas', async () => {
    const marcas = await all(db, `SELECT * FROM marcas`);
    const cats = await all(db, `SELECT * FROM categorias`);
    assert.equal(marcas.filter((m) => String(m.nome).toUpperCase() === 'RAYCO').length, 1);
    assert.equal(cats.filter((c) => chaveEq(c.nome, 'Ferragens')).length, 1);
  });
});

describe('Importação Inicial — segurança', () => {
  it('nunca executa SQL do arquivo (somente dados)', () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaProdutoOficial({
        'Nome CDS': 'DROP TABLE produtos;--',
        'Código origem': 999
      })]
    });
    const dados = svc.extrairDadosImportacao(buffer);
    assert.equal(dados.produtos[0].nome, 'DROP TABLE produtos;--');
  });
});

describe('V1.0.2 — Limpar Importação (reset de sessão UI)', () => {
  const Estado = require('../../frontend/erp/js/importacao-inicial-estado.js');
  const { criarSessao, obterSessao, removerSessao } = require('../../backend/services/importacao-inicial-produtos/sessionStore');

  it('reset zera estado da tela sem manter linhas/sessão', () => {
    const anterior = {
      modo: 'CADASTRO_INICIAL',
      arquivoNome: 'CDS_Importacao_Produtos_PRODUTOS_FISCAL.xlsx',
      sessaoId: 'abc123',
      resumo: { produtos_encontrados: 112, produtos_validos: 112, com_erro: 0, possiveis_duplicados: 0 },
      linhas: [{ status: 'PRONTO' }],
      resultado: { relatorio: { criados: 112 } }
    };
    const { estado, sessaoAnterior } = Estado.resetarEstadoImportacaoInicial(anterior);
    assert.equal(sessaoAnterior, 'abc123');
    assert.equal(estado.arquivoNome, null);
    assert.equal(estado.sessaoId, null);
    assert.equal(estado.resumo, null);
    assert.deepEqual(estado.linhas, []);
    assert.equal(estado.resultado, null);
    assert.equal(estado.modo, 'CADASTRO_INICIAL');
    assert.deepEqual(Estado.contadoresZerados(), {
      produtos_encontrados: 0,
      produtos_validos: 0,
      com_erro: 0,
      possiveis_duplicados: 0,
      estoque_inicial_total: 0
    });
  });

  it('trocar modo limpa sessão e preserva apenas o novo modo', () => {
    const anterior = {
      modo: 'CADASTRO_INICIAL',
      arquivoNome: 'a.xlsx',
      sessaoId: 's1',
      linhas: [{ status: 'PRONTO' }],
      resumo: { prontos: 1 },
      resultado: null
    };
    const { estado, modoAnterior } = Estado.trocarModoImportacao(anterior, 'ATUALIZAR_QUANTIDADES');
    assert.equal(modoAnterior, 'CADASTRO_INICIAL');
    assert.equal(estado.modo, 'ATUALIZAR_QUANTIDADES');
    assert.equal(estado.sessaoId, null);
    assert.deepEqual(estado.linhas, []);
    assert.deepEqual(Estado.contadoresZerados('ATUALIZAR_QUANTIDADES'), {
      produtos_no_arquivo: 0,
      produtos_encontrados: 0,
      produtos_nao_encontrados: 0,
      quantidade_total_a_lancar: 0
    });
  });

  it('remover sessão em memória não altera banco; revalidar volta 112', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-imp-clear-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);

    const buffer = gerarPlanilhaOficial112();
    const v1 = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'a.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(v1.resumo.produtos_encontrados, 112);
    assert.ok(obterSessao(v1.sessao_id));

    const qtdAntes = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    removerSessao(v1.sessao_id);
    assert.equal(obterSessao(v1.sessao_id), null);

    const { estado } = Estado.resetarEstadoImportacaoInicial({
      arquivoNome: 'a.xlsx',
      sessaoId: v1.sessao_id,
      resumo: v1.resumo,
      linhas: v1.linhas,
      resultado: null
    });
    assert.equal(estado.sessaoId, null);
    assert.deepEqual(estado.linhas, []);

    const qtdDepois = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(qtdDepois.c, qtdAntes.c);

    const v2 = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'a.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(v2.resumo.produtos_encontrados, 112);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('V1.0.4 — Atualizar Quantidades', () => {
  function linhaQuantidadeOficial(overrides = {}) {
    return {
      'Código origem': 12277,
      'Nome CDS': 'ABRAÇADEIRA NYLON 2,5 X 200MM',
      'Unidade base': 'UN',
      'Unidade origem': 'PC',
      'Qtd documento': 1,
      'Fator conversão': 100,
      'Quantidade estoque inicial': 100,
      'Referência fabricante': 12114,
      Origem: 'PRIMEIRA_IMPORTACAO',
      ...overrides
    };
  }

  function gerarPlanilhaQuantidades112() {
    const quantidades = [linhaQuantidadeOficial()];
    for (let i = 1; i < 112; i += 1) {
      quantidades.push(linhaQuantidadeOficial({
        'Código origem': 20000 + i,
        'Nome CDS': `PRODUTO TESTE ${i}`,
        'Qtd documento': 1,
        'Fator conversão': 1,
        'Quantidade estoque inicial': 1,
        'Unidade origem': 'UN',
        'Referência fabricante': 30000 + i
      }));
    }
    return svc.gerarXlsxQuantidadesFixture({ quantidades });
  }

  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-qtd-'));
    dbPath = path.join(dir, 'teste.db');
    pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    db = await openDb(dbPath);
    await criarSchema(db);

    // Cadastro prévio (simula produtos já existentes)
    const cadastro = gerarPlanilhaOficial112();
    const v = await svc.validarArquivoBuffer(db, cadastro, {
      nomeArquivo: 'cadastro-base.xlsx',
      modo: 'CADASTRO_INICIAL'
    , modo_fiscal_importacao: 'FISCAL'});
    await svc.importarSessao(db, v.sessao_id, { dbPath, pastaBackup });
  });

  after(async () => {
    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cálculo UN: 12 × 1 = 12', () => {
    const calc = svc.calcularQuantidadeALancar({
      quantidade_documento: 12,
      fator_conversao: 1,
      unidade_origem: 'UN',
      unidade_base: 'UN'
    });
    assert.equal(calc.quantidade_a_lancar, 12);
  });

  it('cálculo PCT: 1 × 100 = 100', () => {
    const calc = svc.calcularQuantidadeALancar({
      quantidade_documento: 1,
      fator_conversao: 100,
      unidade_origem: 'PC',
      unidade_base: 'UN'
    });
    assert.equal(calc.quantidade_a_lancar, 100);
    assert.match(calc.quantidade_label, /\+100/);
  });

  it('planilha 112: todos encontrados; abraçadeira +100 UN; sem criar produto', async () => {
    const qtdAntes = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    const abrAntes = await get(db, `
      SELECT id, nome, preco_compra, preco_venda, lucro_percentual, item_fiscal,
             estoque_atual, saldo_fiscal
      FROM produtos WHERE codigo = ?
    `, ['12277']);
    assert.ok(abrAntes);

    const buffer = gerarPlanilhaQuantidades112();
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'CDS_Atualizacao_Quantidades_PRIMEIRA_IMPORTACAO.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });

    assert.equal(validacao.modo, 'ATUALIZAR_QUANTIDADES');
    assert.equal(validacao.resumo.produtos_no_arquivo, 112);
    assert.equal(validacao.resumo.produtos_encontrados, 112);
    assert.equal(validacao.resumo.produtos_nao_encontrados, 0);
    assert.equal(validacao.pode_importar, true);

    const linha12277 = validacao.linhas.find((l) => l.produto.codigo_origem === '12277');
    assert.ok(linha12277);
    assert.equal(linha12277.status, 'OK');
    assert.equal(linha12277.quantidade.quantidade_a_lancar, 100);

    const estoqueAntes = Number(abrAntes.estoque_atual);
    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.criados, 0);
    assert.equal(resultado.relatorio.cadastro_alterado, 0);
    assert.ok(resultado.relatorio.estoque_lancado >= 100);
    assert.ok(resultado.relatorio.movimentacoes_estoque >= 1);

    const qtdDepois = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(qtdDepois.c, qtdAntes.c);

    const abrDepois = await get(db, `
      SELECT id, nome, preco_compra, preco_venda, lucro_percentual, item_fiscal,
             estoque_atual, saldo_fiscal
      FROM produtos WHERE codigo = ?
    `, ['12277']);
    assert.equal(abrDepois.id, abrAntes.id);
    assert.equal(abrDepois.nome, abrAntes.nome);
    assert.equal(Number(abrDepois.preco_compra), Number(abrAntes.preco_compra));
    assert.equal(Number(abrDepois.preco_venda), Number(abrAntes.preco_venda));
    assert.equal(Number(abrDepois.lucro_percentual), Number(abrAntes.lucro_percentual));
    assert.equal(Number(abrDepois.item_fiscal), Number(abrAntes.item_fiscal));
    assert.equal(Number(abrDepois.estoque_atual), estoqueAntes + 100);

    const ajustes = await all(db, `
      SELECT * FROM produtos_ajustes_estoque
      WHERE produto_id = ? AND motivo LIKE 'ATUALIZAÇÃO DE QUANTIDADES — IMPORTAÇÃO%'
    `, [abrDepois.id]);
    assert.ok(ajustes.length >= 1);
    assert.equal(Number(ajustes[ajustes.length - 1].ajuste_fiscal), 100);
  });

  it('segunda execução do mesmo arquivo não duplica quantidade', async () => {
    const abrAntes = await get(db, `SELECT estoque_atual FROM produtos WHERE codigo = ?`, ['12277']);
    const ajustesAntes = await get(db, `
      SELECT COUNT(*) AS c FROM produtos_ajustes_estoque
      WHERE motivo LIKE 'ATUALIZAÇÃO DE QUANTIDADES — IMPORTAÇÃO%'
    `);

    const buffer = gerarPlanilhaQuantidades112();
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'CDS_Atualizacao_Quantidades_PRIMEIRA_IMPORTACAO.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.estoque_lancado, 0);
    assert.ok(resultado.relatorio.ignorados_ja_processados >= 112);

    const abrDepois = await get(db, `SELECT estoque_atual FROM produtos WHERE codigo = ?`, ['12277']);
    assert.equal(Number(abrDepois.estoque_atual), Number(abrAntes.estoque_atual));

    const ajustesDepois = await get(db, `
      SELECT COUNT(*) AS c FROM produtos_ajustes_estoque
      WHERE motivo LIKE 'ATUALIZAÇÃO DE QUANTIDADES — IMPORTAÇÃO%'
    `);
    assert.equal(ajustesDepois.c, ajustesAntes.c);
  });

  it('produto não encontrado: bloqueia e não cria produto', async () => {
    const qtdAntes = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQuantidadeOficial({
        'Código origem': 999999,
        'Nome CDS': 'PRODUTO INEXISTENTE XYZ',
        'Qtd documento': 5,
        'Fator conversão': 1
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'nao-encontrado.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(validacao.resumo.produtos_nao_encontrados, 1);
    assert.equal(validacao.pode_importar, false);
    assert.equal(validacao.linhas[0].status, 'NAO_ENCONTRADO');

    await assert.rejects(
      () => svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup }),
      /não encontrados|erro/i
    );

    const qtdDepois = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(qtdDepois.c, qtdAntes.c);
  });

  it('V1.0.7 — sem fator no arquivo usa produto_embalagens (abraçadeira +100)', async () => {
    const buffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [linhaQuantidadeOficial({
        'Fator conversão': null,
        'Quantidade estoque inicial': null,
        Origem: 'SEM_FATOR_ARQUIVO'
      })]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'qtd-sem-fator.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(validacao.linhas[0].status, 'OK');
    assert.equal(validacao.linhas[0].quantidade.quantidade_a_lancar, 100);
    assert.equal(validacao.linhas[0].fator_fonte, 'produto_embalagens');
  });
});

describe('V1.0.7 — ProdutoEmbalagemService + paridade', () => {
  const {
    montarEmbalagensParaServico,
    calcularFormacaoPrecoOficial
  } = require('../../backend/services/importacao-inicial-produtos/helpers');
  const { obterProdutoEmbalagemService } = require('../../backend/services/produto-embalagem/ProdutoEmbalagemService');
  const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');

  function linhaCabo() {
    return {
      'Código origem': 88001,
      'Nome CDS': 'CABO FLEXÍVEL 1,5MM² AM',
      Marca: 'GENERICA',
      Categoria: 'Elétrica',
      Subcategoria: 'Cabos',
      'Unidade base': 'M',
      'Unidade origem': 'ROLO',
      'Qtd documento': 1,
      'Custo unitário': null,
      'Markup %': 100,
      Fiscal: 'SIM',
      'Preço venda unitário': null,
      'Custo apresentação/origem': 161.497,
      'Total documento': 161.497,
      'Referência fabricante': 'CF15AM'
    };
  }

  function linhaCaboApresentacao() {
    return {
      'Código origem': 88001,
      Tipo: 'ROLO',
      Descrição: 'ROLO 100 METROS',
      'Quantidade conversão': 100,
      'Unidade base': 'M',
      'Valor compra apresentação': 161.497,
      'Preço venda apresentação': null,
      Principal: 1,
      Compra: 1,
      Venda: 1,
      Estoque: 1,
      Ativa: 1,
      Origem: 'IMPORTACAO',
      Classificação: 'FISCAL'
    };
  }

  it('montarEmbalagensParaServico preserva descrição, flags e valor compra', () => {
    const payload = montarEmbalagensParaServico([{
      tipo: 'ROLO',
      descricao: 'ROLO 100 METROS',
      quantidade: 100,
      custo: 161.497,
      principal: 1,
      compra: 1,
      venda: 1,
      estoque: 1,
      ativa: 1,
      codigo_fornecedor: 'FORN-1',
      fornecedor_nome: 'Fornecedor X',
      gtin: '789'
    }], 'mt');
    assert.equal(payload[0].descricao, 'ROLO 100 METROS');
    assert.equal(payload[0].valor_compra, 161.497);
    assert.equal(payload[0].principal, 1);
    assert.equal(payload[0].codigo_fornecedor, 'FORN-1');
    assert.equal(payload[0].fornecedor_nome, 'Fornecedor X');
    assert.equal(payload[0].gtin, '789');
  });

  it('importa CABO ROLO 100 M via ProdutoEmbalagemService', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-cabo-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);
    await seedParCategoriaSub(db, run, get, 'Elétrica', 'Cabos');

    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaCabo()],
      apresentacoes: [linhaCaboApresentacao()]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'cabo.xlsx',
      modo: 'CADASTRO_INICIAL'
    , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.com_erro, 0);
    const linha = validacao.linhas[0];
    assert.equal(linha.estoque.estoque_inicial, 100);
    // Cadastro manual: Metro = "mt"
    assert.equal(linha.produto.unidade_base, 'mt');

    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 161.497,
      quantidadePorEmbalagem: 100,
      tipo: 'ROLO',
      markup: 100
    });
    assert.equal(formacao.custo_unitario, 1.615);
    assert.equal(formacao.preco_venda, 3.23);

    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.criados, 1);
    assert.equal(resultado.relatorio.estoque_lancado, 100);

    const produto = await get(db, `SELECT * FROM produtos WHERE codigo = ?`, ['88001']);
    assert.equal(String(produto.unidade).toLowerCase(), 'mt');
    assert.equal(Number(produto.estoque_atual), 100);
    assert.equal(Number(produto.preco_compra), 1.615);
    assert.equal(Number(produto.preco_venda), 3.23);

    const emb = await get(db, `SELECT * FROM produto_embalagens WHERE produto_id = ?`, [produto.id]);
    assert.equal(emb.tipo, 'ROLO');
    assert.equal(emb.descricao, 'ROLO 100 METROS');
    assert.equal(Number(emb.quantidade), 100);
    // Serviço oficial normaliza valor_compra com 2 casas (mesmo do cadastro manual)
    assert.equal(Number(emb.valor_compra), 161.5);
    assert.equal(Number(emb.principal), 1);
    assert.equal(Number(emb.compra), 1);
    assert.equal(Number(emb.venda), 1);
    assert.equal(Number(emb.estoque), 1);
    assert.equal(Number(emb.ativa), 1);
    assert.equal(emb.origem, 'IMPORTACAO_INICIAL');

    // Paridade: serviço oficial com mesmo payload produz mesma estrutura
    const svcEmb = obterProdutoEmbalagemService(db);
    const payloadManual = montarEmbalagensParaServico([{
      tipo: 'ROLO',
      descricao: 'ROLO 100 METROS',
      quantidade: 100,
      valor_compra: 161.497,
      principal: 1,
      compra: 1,
      venda: 1,
      estoque: 1,
      ativa: 1
    }], 'mt', { origem: 'CADASTRO' });

    await new Promise((resolve, reject) => {
      svcEmb.sincronizarEmbalagensProduto(produto.id, payloadManual, 'mt', { id: 1 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    const embManual = await get(db, `SELECT * FROM produto_embalagens WHERE produto_id = ?`, [produto.id]);
    assert.equal(embManual.tipo, emb.tipo);
    assert.equal(embManual.descricao, 'ROLO 100 METROS');
    assert.equal(Number(embManual.quantidade), 100);
    assert.equal(Number(embManual.valor_compra), 161.5);
    assert.equal(Number(embManual.principal), 1);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rollback se falhar na apresentação — não deixa produto órfão', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-rb-apr-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);
    await seedParCategoriaSub(db, run, get, 'Elétrica', 'Cabos');

    const buffer = svc.gerarXlsxFixture({
      produtos: [linhaCabo()],
      apresentacoes: [linhaCaboApresentacao()]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'rb-apr.xlsx' , modo_fiscal_importacao: 'FISCAL'});

    await assert.rejects(
      () => executarImportacao(db, validacao, {
        dbPath,
        pastaBackup,
        importId: validacao.sessao_id,
        forcarFalhaApresentacao: true
      }),
      /Falha forçada na criação da apresentação/
    );

    const qtd = await get(db, `SELECT COUNT(*) AS c FROM produtos`);
    assert.equal(qtd.c, 0);
    const emb = await get(db, `SELECT COUNT(*) AS c FROM produto_embalagens`);
    assert.equal(emb.c, 0);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Atualizar Quantidades CABO sem fator: +100 M pela apresentação', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-qtd-cabo-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);
    await seedParCategoriaSub(db, run, get, 'Elétrica', 'Cabos');

    const cadastro = svc.gerarXlsxFixture({
      produtos: [linhaCabo()],
      apresentacoes: [linhaCaboApresentacao()]
    });
    const vCad = await svc.validarArquivoBuffer(db, cadastro, { nomeArquivo: 'cad-cabo.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    await svc.importarSessao(db, vCad.sessao_id, { dbPath, pastaBackup });

    const estoqueAposCadastro = await get(db, `SELECT estoque_atual FROM produtos WHERE codigo = ?`, ['88001']);
    assert.equal(Number(estoqueAposCadastro.estoque_atual), 100);

    const qtdBuffer = svc.gerarXlsxQuantidadesFixture({
      quantidades: [{
        'Código origem': 88001,
        'Nome CDS': 'CABO FLEXÍVEL 1,5MM² AM',
        'Unidade base': 'M',
        'Unidade origem': 'ROLO',
        'Qtd documento': 1,
        'Fator conversão': null,
        Origem: 'ATUALIZACAO_CABO'
      }]
    });
    const vQtd = await svc.validarArquivoBuffer(db, qtdBuffer, {
      nomeArquivo: 'qtd-cabo.xlsx',
      modo: 'ATUALIZAR_QUANTIDADES'
    });
    assert.equal(vQtd.linhas[0].status, 'OK');
    assert.equal(vQtd.linhas[0].quantidade.quantidade_a_lancar, 100);
    assert.equal(vQtd.linhas[0].fator_fonte, 'produto_embalagens');

    await svc.importarSessao(db, vQtd.sessao_id, { dbPath, pastaBackup });
    const depois = await get(db, `SELECT estoque_atual, unidade FROM produtos WHERE codigo = ?`, ['88001']);
    assert.equal(String(depois.unidade).toLowerCase(), 'mt');
    assert.equal(Number(depois.estoque_atual), 200);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('V1.0.8 — Enriquecimento de produto existente (apresentação)', () => {
  const {
    calcularFormacaoPrecoOficial,
    mesclarApresentacoesParaSync,
    normalizarUnidadeBaseCadastro,
    STATUS
  } = require('../../backend/services/importacao-inicial-produtos/helpers');
  const { obterProdutoEmbalagemService } = require('../../backend/services/produto-embalagem/ProdutoEmbalagemService');

  function linha13100(overrides = {}) {
    return {
      'Código origem': 13100,
      'Nome CDS': 'CABO FLEXÍVEL 1,5MM² AM',
      Marca: 'GENERICA',
      Categoria: 'Elétrica',
      Subcategoria: 'Cabos',
      'Unidade base': 'M',
      'Unidade origem': 'ROLO',
      'Qtd documento': 1,
      'Custo unitário': null,
      'Markup %': 100,
      Fiscal: 'SIM',
      'Preço venda unitário': null,
      'Custo apresentação/origem': 161.497,
      'Total documento': 161.497,
      'Referência fabricante': 'CF15AM',
      ...overrides
    };
  }

  function apresentacao13100(overrides = {}) {
    return {
      'Código origem': 13100,
      Tipo: 'ROLO',
      Descrição: 'ROLO 100 METROS',
      'Quantidade conversão': 100,
      'Unidade base': 'M',
      'Valor compra apresentação': 161.497,
      'Preço venda apresentação': null,
      Principal: 1,
      Compra: 1,
      Venda: 1,
      Estoque: 1,
      Ativa: 1,
      Origem: 'IMPORTACAO',
      Classificação: 'FISCAL',
      ...overrides
    };
  }

  async function inserirProdutoExistenteSemApresentacao(db, {
    codigo = '13100',
    nome = 'CABO FLEXÍVEL 1,5MM² AM',
    unidade = 'un',
    marca = 'GENERICA'
  } = {}) {
    await run(db, `INSERT INTO marcas (nome, ativo) VALUES (?, 1)`, [marca]);
    const marcaRow = await get(db, `SELECT id FROM marcas WHERE nome = ?`, [marca]);
    await run(db, `INSERT OR IGNORE INTO categorias (nome, tipo, ativo) VALUES (?, 'produto', 1)`, ['Elétrica']);
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, ['Elétrica']);
    await run(db, `INSERT INTO subcategorias (nome, categoria_id, ativo) VALUES (?, ?, 1)`, ['Cabos', cat.id]);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = ?`, ['Cabos']);
    const ins = await run(db, `
      INSERT INTO produtos (
        codigo, nome, categoria_id, subcategoria_id, unidade,
        preco_compra, lucro_percentual, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal,
        marca_id, controla_estoque, ncm, cest
      ) VALUES (?, ?, ?, ?, ?, 0, 100, 0, 0, 0, 0, 1, ?, 1, '85444900', NULL)
    `, [codigo, nome, cat.id, sub.id, unidade, marcaRow.id]);
    return ins.lastID;
  }

  it('produto existente + apresentação nova (13100 ROLO 100 M)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-13100-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);

    const produtoId = await inserirProdutoExistenteSemApresentacao(db);
    const nomeAntes = (await get(db, `SELECT nome, ncm FROM produtos WHERE id = ?`, [produtoId])).nome;
    const ncmAntes = (await get(db, `SELECT ncm FROM produtos WHERE id = ?`, [produtoId])).ncm;

    const buffer = svc.gerarXlsxFixture({
      produtos: [linha13100({ Marca: 'OUTRA MARCA XLSX' })],
      apresentacoes: [apresentacao13100()]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13100.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.com_erro, 0);
    assert.equal(validacao.resumo.enriquecimentos, 1);
    assert.equal(validacao.resumo.apresentacoes_novas, 1);
    assert.equal(validacao.resumo.estoque_inicial_total, 100);
    assert.equal(validacao.pode_importar, true);

    const linha = validacao.linhas[0];
    assert.equal(linha.status, STATUS.EXISTENTE_APRESENTACAO_NOVA);
    assert.equal(linha.enriquecimento.apresentacoes_novas, 1);
    assert.equal(linha.enriquecimento.corrigir_unidade_base, true);
    assert.equal(linha.estoque.estoque_inicial, 100);

    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 161.497,
      quantidadePorEmbalagem: 100,
      tipo: 'ROLO',
      markup: 100
    });
    assert.equal(formacao.custo_unitario, 1.615);
    assert.equal(formacao.preco_venda, 3.23);

    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.criados, 0);
    assert.equal(resultado.relatorio.enriquecidos, 1);
    assert.equal(resultado.relatorio.apresentacoes_novas, 1);
    assert.equal(resultado.relatorio.estoque_lancado, 100);

    const qtdProd = await get(db, `SELECT COUNT(*) AS c FROM produtos WHERE codigo = ?`, ['13100']);
    assert.equal(qtdProd.c, 1);

    const produto = await get(db, `SELECT * FROM produtos WHERE id = ?`, [produtoId]);
    assert.equal(produto.nome, nomeAntes);
    assert.equal(produto.ncm, ncmAntes);
    // Cadastro manual: option Metro = value "mt"
    assert.equal(String(produto.unidade).toLowerCase(), 'mt');
    assert.equal(Number(produto.estoque_atual), 100);
    assert.equal(Number(produto.saldo_fiscal), 100);
    assert.equal(Number(produto.preco_compra), 1.615);
    assert.equal(Number(produto.preco_venda), 3.23);

    const emb = await all(db, `SELECT * FROM produto_embalagens WHERE produto_id = ?`, [produtoId]);
    assert.equal(emb.length, 1);
    assert.equal(emb[0].tipo, 'ROLO');
    assert.equal(emb[0].descricao, 'ROLO 100 METROS');
    assert.equal(Number(emb[0].quantidade), 100);
    assert.equal(Number(emb[0].valor_compra), 161.5);
    assert.equal(Number(emb[0].principal), 1);
    assert.equal(Number(emb[0].compra), 1);
    assert.equal(Number(emb[0].venda), 1);
    assert.equal(Number(emb[0].estoque), 1);
    assert.equal(Number(emb[0].ativa), 1);
    assert.equal(emb[0].origem, 'IMPORTACAO_INICIAL');

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('idempotência 13100 — segunda importação não duplica apresentação nem estoque', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-13100-idemp-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);
    await inserirProdutoExistenteSemApresentacao(db);

    const buffer = svc.gerarXlsxFixture({
      produtos: [linha13100()],
      apresentacoes: [apresentacao13100()]
    });
    const v1 = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13100-a.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    await svc.importarSessao(db, v1.sessao_id, { dbPath, pastaBackup });

    const v2 = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13100-b.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(v2.linhas[0].status, STATUS.EXISTENTE);
    assert.equal(v2.resumo.enriquecimentos, 0);

    const r2 = await svc.importarSessao(db, v2.sessao_id, { dbPath, pastaBackup });
    assert.equal(r2.relatorio.criados, 0);
    assert.equal(r2.relatorio.enriquecidos || 0, 0);
    assert.equal(r2.relatorio.estoque_lancado, 0);

    const emb = await get(db, `SELECT COUNT(*) AS c FROM produto_embalagens`);
    assert.equal(emb.c, 1);
    const produto = await get(db, `SELECT estoque_atual FROM produtos WHERE codigo = ?`, ['13100']);
    assert.equal(Number(produto.estoque_atual), 100);
    const ajustes = await get(db, `
      SELECT COUNT(*) AS c FROM produtos_ajustes_estoque
      WHERE motivo LIKE 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS%'
    `);
    assert.equal(ajustes.c, 1);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('produto existente + apresentação ROLO 100 M deve persistir unidade base mt', async () => {
    assert.equal(normalizarUnidadeBaseCadastro('M'), 'mt');
    assert.equal(normalizarUnidadeBaseCadastro('metro'), 'mt');
    assert.equal(normalizarUnidadeBaseCadastro('mt'), 'mt');
    assert.equal(normalizarUnidadeBaseCadastro('UN'), 'un');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-13100-mt-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);
    await inserirProdutoExistenteSemApresentacao(db, { unidade: 'un' });

    const buffer = svc.gerarXlsxFixture({
      produtos: [linha13100()],
      apresentacoes: [apresentacao13100()]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13100-mt.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].produto.unidade_base, 'mt');
    await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });

    const produto = await get(db, `SELECT unidade, estoque_atual FROM produtos WHERE codigo = ?`, ['13100']);
    assert.equal(produto.unidade, 'mt');
    assert.equal(Number(produto.estoque_atual), 100);
    const emb = await get(db, `SELECT tipo, quantidade FROM produto_embalagens WHERE produto_id = (
      SELECT id FROM produtos WHERE codigo = '13100'
    )`);
    assert.equal(emb.tipo, 'ROLO');
    assert.equal(Number(emb.quantidade), 100);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('produto existente com apresentação prévia — não duplica (sincroniza serviço oficial)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-13100-prev-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);

    const produtoId = await inserirProdutoExistenteSemApresentacao(db, { unidade: 'mt' });
    const svcEmb = obterProdutoEmbalagemService(db);
    await new Promise((resolve, reject) => {
      svcEmb.sincronizarEmbalagensProduto(produtoId, [{
        tipo: 'ROLO',
        descricao: 'ROLO 100 METROS',
        quantidade: 100,
        unidade: 'mt',
        valor_compra: 161.497,
        preco_venda: 0,
        principal: 1,
        compra: 1,
        venda: 1,
        estoque: 1,
        ativa: 1,
        origem: 'CADASTRO'
      }], 'mt', { id: 1 }, (err) => (err ? reject(err) : resolve()));
    });

    const buffer = svc.gerarXlsxFixture({
      produtos: [linha13100()],
      apresentacoes: [apresentacao13100()]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13100-sync.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    // Sem estoque inicial prévio → ainda pode enriquecer estoque; apresentação é existente
    assert.ok(
      validacao.linhas[0].status === STATUS.EXISTENTE
      || validacao.linhas[0].status === STATUS.EXISTENTE_APRESENTACAO_NOVA
      || validacao.linhas[0].status === STATUS.EXISTENTE_ATUALIZAR
    );
    if (validacao.linhas[0].status === STATUS.EXISTENTE_APRESENTACAO_NOVA) {
      assert.equal(validacao.linhas[0].enriquecimento.apresentacoes_novas, 0);
    }

    await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    const emb = await all(db, `SELECT * FROM produto_embalagens WHERE produto_id = ?`, [produtoId]);
    assert.equal(emb.length, 1);
    assert.equal(emb[0].tipo, 'ROLO');
    assert.equal(Number(emb[0].quantidade), 100);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mesclarApresentacoesParaSync preserva apresentação do banco não presente no arquivo', () => {
    const { merged, classif } = mesclarApresentacoesParaSync(
      [{ tipo: 'ROLO', quantidade: 100, unidade: 'M', valor_compra: 161.497, principal: 1 }],
      [{ id: 9, tipo: 'CX', quantidade: 10, unidade: 'un', valor_compra: 50, principal: 0, compra: 1, venda: 1, estoque: 1, ativa: 1 }]
    );
    assert.equal(classif.novas.length, 1);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((a) => a.tipo === 'CX'));
    assert.ok(merged.some((a) => a.tipo === 'ROLO'));
  });

  it('rollback no enriquecimento não altera produto existente', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-13100-rb-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);
    const produtoId = await inserirProdutoExistenteSemApresentacao(db);

    const buffer = svc.gerarXlsxFixture({
      produtos: [linha13100()],
      apresentacoes: [apresentacao13100()]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13100-rb.xlsx' , modo_fiscal_importacao: 'FISCAL'});

    await assert.rejects(
      () => executarImportacao(db, validacao, {
        dbPath,
        pastaBackup,
        importId: validacao.sessao_id,
        forcarFalhaApresentacao: true
      }),
      /Falha forçada/
    );

    const produto = await get(db, `SELECT unidade, estoque_atual FROM produtos WHERE id = ?`, [produtoId]);
    assert.equal(String(produto.unidade).toLowerCase(), 'un');
    assert.equal(Number(produto.estoque_atual), 0);
    const emb = await get(db, `SELECT COUNT(*) AS c FROM produto_embalagens`);
    assert.equal(emb.c, 0);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('V1.0.10 — Preço unitário (não preço da apresentação)', () => {
  const {
    calcularFormacaoPrecoOficial,
    STATUS
  } = require('../../backend/services/importacao-inicial-produtos/helpers');

  it('ROLO 100 M: custo informado=valor do rolo NÃO vira preco_venda 501', () => {
    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 250.74,
      quantidadePorEmbalagem: 100,
      tipo: 'ROLO',
      markup: 100,
      custoUnitarioInformado: 250.74
    });
    assert.equal(formacao.custo_unitario, 2.5074);
    assert.equal(formacao.preco_venda, 5.0148);
    assert.equal(formacao.preco_apresentacao, 501.48);
    assert.notEqual(formacao.preco_venda, 501.47);
  });

  it('PACOTE 100 UN: unitário 0,0389 / 0,0778; pacote 7,78', () => {
    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 3.89,
      quantidadePorEmbalagem: 100,
      tipo: 'PCT',
      markup: 100,
      custoUnitarioInformado: 3.89
    });
    assert.equal(formacao.custo_unitario, 0.0389);
    assert.equal(formacao.preco_venda, 0.0778);
    assert.equal(formacao.preco_apresentacao, 7.78);
  });

  it('CAIXA 12 UN: unitário ≈ 3,5633 / 7,1266; caixa ≈ 85,52', () => {
    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 42.759,
      quantidadePorEmbalagem: 12,
      tipo: 'CX',
      markup: 100,
      custoUnitarioInformado: 42.759
    });
    assert.equal(formacao.custo_unitario, 3.5633);
    assert.equal(formacao.preco_venda, 7.1266);
    assert.equal(formacao.preco_apresentacao, 85.52);
  });

  it('sem apresentação: custo informado da unidade permanece', () => {
    const formacao = calcularFormacaoPrecoOficial({
      valorEmbalagemCompra: 0,
      quantidadePorEmbalagem: 1,
      markup: 100,
      custoUnitarioInformado: 9.39
    });
    assert.equal(formacao.custo_unitario, 9.39);
    assert.equal(formacao.preco_venda, 18.78);
    assert.equal(formacao.preco_apresentacao, null);
  });

  it('13105: corrige produtos.preco_venda de 501,47 → ≈ 5,01 sem duplicar estoque/apresentação', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-13105-'));
    const dbPath = path.join(dir, 't.db');
    const pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
    const db = await openDb(dbPath);
    await criarSchema(db);

    await run(db, `INSERT INTO marcas (nome, ativo) VALUES ('GENERICA', 1)`);
    const marca = await get(db, `SELECT id FROM marcas WHERE nome = 'GENERICA'`);
    await run(db, `INSERT OR IGNORE INTO categorias (nome, tipo, ativo) VALUES ('Elétrica', 'produto', 1)`);
    const cat = await get(db, `SELECT id FROM categorias WHERE nome = 'Elétrica'`);
    await run(db, `INSERT INTO subcategorias (nome, categoria_id, ativo) VALUES ('Cabos', ?, 1)`, [cat.id]);
    const sub = await get(db, `SELECT id FROM subcategorias WHERE nome = 'Cabos'`);
    const ins = await run(db, `
      INSERT INTO produtos (
        codigo, nome, categoria_id, subcategoria_id, unidade,
        preco_compra, lucro_percentual, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal,
        marca_id, controla_estoque, compra_por_embalagem,
        quantidade_por_embalagem, valor_compra_embalagem
      ) VALUES ('13105', 'CABO FLEXÍVEL 2,5MM² AZ', ?, ?, 'mt',
        250.735, 100, 501.47, 100, 100, 0, 1, ?, 1, 1, 100, 250.74)
    `, [cat.id, sub.id, marca.id]);
    const produtoId = ins.lastID;
    await run(db, `
      INSERT INTO produto_embalagens (
        produto_id, tipo, descricao, quantidade, unidade,
        valor_compra, preco_venda, principal, compra, venda, estoque, ativa, origem
      ) VALUES (?, 'ROLO', 'ROLO 100 METROS', 100, 'mt', 250.74, 50147, 1, 1, 1, 1, 1, 'IMPORTACAO_INICIAL')
    `, [produtoId]);
    await run(db, `
      INSERT INTO produtos_ajustes_estoque (
        produto_id, motivo, ajuste_fiscal, ajuste_nao_fiscal,
        saldo_fiscal_antes, saldo_fiscal_depois, estoque_total_antes, estoque_total_depois
      ) VALUES (?, 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS | import=prev', 100, 0, 0, 100, 0, 100)
    `, [produtoId]);

    const buffer = svc.gerarXlsxFixture({
      produtos: [{
        'Código origem': 13105,
        'Nome CDS': 'CABO FLEXÍVEL 2,5MM² AZ',
        Marca: 'GENERICA',
        Categoria: 'Elétrica',
        Subcategoria: 'Cabos',
        'Unidade base': 'M',
        'Unidade origem': 'ROLO',
        'Qtd documento': 1,
        'Custo unitário': 250.74,
        'Markup %': 100,
        Fiscal: 'SIM',
        'Preço venda unitário': null,
        'Custo apresentação/origem': 250.74
      }],
      apresentacoes: [{
        'Código origem': 13105,
        Tipo: 'ROLO',
        Descrição: 'ROLO 100 METROS',
        'Quantidade conversão': 100,
        'Unidade base': 'M',
        'Valor compra apresentação': 250.74,
        Principal: 1,
        Compra: 1,
        Venda: 1,
        Estoque: 1,
        Ativa: 1
      }]
    });

    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: '13105-fix.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.linhas[0].status, STATUS.EXISTENTE_APRESENTACAO_NOVA);
    assert.equal(Number(validacao.linhas[0].produto.custo_unitario), 2.5074);
    assert.equal(Number(validacao.linhas[0].produto.preco_venda), 5.0148);

    const resultado = await svc.importarSessao(db, validacao.sessao_id, { dbPath, pastaBackup });
    assert.equal(resultado.relatorio.criados, 0);
    assert.equal(resultado.relatorio.estoque_lancado, 0);

    const produto = await get(db, `SELECT * FROM produtos WHERE id = ?`, [produtoId]);
    assert.equal(Number(produto.preco_compra), 2.5074);
    assert.equal(Number(produto.preco_venda), 5.0148);
    assert.notEqual(Number(produto.preco_venda), 501.47);
    assert.equal(String(produto.unidade).toLowerCase(), 'mt');
    assert.equal(Number(produto.estoque_atual), 100);

    const emb = await all(db, `SELECT * FROM produto_embalagens WHERE produto_id = ?`, [produtoId]);
    assert.equal(emb.length, 1);
    assert.equal(emb[0].tipo, 'ROLO');
    assert.equal(Number(emb[0].quantidade), 100);
    assert.equal(Number(emb[0].valor_compra), 250.74);
    assert.equal(Number(emb[0].preco_venda), 501.48);

    const ajustes = await get(db, `
      SELECT COUNT(*) AS c FROM produtos_ajustes_estoque
      WHERE produto_id = ? AND motivo LIKE 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS%'
    `, [produtoId]);
    assert.equal(ajustes.c, 1);

    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolverCustosEPrecos: custo_informado=rolo não contamina preço unitário', () => {
    const pricing = resolverCustosEPrecos({
      nome: 'CABO',
      unidade_base: 'mt',
      markup: 100,
      custo_informado: 250.74,
      preco_informado: null
    }, [{
      tipo: 'ROLO',
      quantidade: 100,
      unidade: 'mt',
      valor_compra: 250.74,
      custo: 250.74,
      principal: 1
    }]);
    assert.equal(Number(pricing.custo_unitario), 2.5074);
    assert.equal(Number(pricing.preco_venda), 5.0148);
    assert.equal(Number(pricing.apresentacao_principal.preco_venda), 501.48);
  });
});
