/**
 * V1.0.14 — bloqueio de codigo_origem duplicado no XLSX.
 * Executar: node --test tests/produtos/importacao-inicial-codigo-duplicado-v1014.test.js
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
  chaveNomeCadastroSimples,
  mapearLinhaProduto
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const {
  mapearDuplicidadesCodigoArquivo,
  validarImportacao
} = require('../../backend/services/importacao-inicial-produtos/validator');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const { extrairDadosImportacao } = require('../../backend/services/importacao-inicial-produtos/xlsxReader');
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
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE,
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
    saldo_fiscal REAL, saldo_nao_fiscal REAL, item_fiscal INTEGER,
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
    'Qtd documento': 1,
    'Custo unitário': 10,
    'Markup %': 100,
    Fiscal: 'SIM',
    'Preço venda unitário': 20,
    ...overrides
  };
}

describe('V1.0.14 — codigo_origem duplicado no XLSX', () => {
  let dir;
  let dbPath;
  let db;
  let pastaBackup;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-imp-dup-'));
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

  it('bloqueia validação quando 5986221100 aparece 2 vezes — sem INSERT', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('5986221100', 'DISCO DIAMTD CORTE W-MAX 110X20,0 TU RBO'),
        linhaProduto('5986221100', 'DISCO DIAMTD CORTE W-MAX 110X20,0 TU RBO')
      ]
    });

    const validacao = await svc.validarArquivoBuffer(db, buffer, {
      nomeArquivo: 'dup-5986221100.xlsx'
    , modo_fiscal_importacao: 'FISCAL'});

    assert.equal(validacao.pode_importar, false);
    assert.ok(validacao.resumo.com_erro >= 2);
    assert.equal(validacao.resumo.prontos, 0);

    const dups = validacao.linhas.filter((l) => l.status === STATUS.CODIGO_DUPLICADO_ARQUIVO);
    assert.equal(dups.length, 2);
    for (const l of dups) {
      assert.ok(l.mensagens.some((m) => /Código duplicado no arquivo/i.test(m)));
      assert.equal(l.duplicidade_arquivo.codigo, '5986221100');
      assert.equal(l.duplicidade_arquivo.ocorrencias, 2);
      assert.deepEqual(l.duplicidade_arquivo.linhas, [1, 2]);
    }

    await assert.rejects(
      () => executarImportacao(db, validacao, { dbPath, pastaBackup, importId: validacao.sessao_id }),
      /erro/i
    );

    const qtd = await get(db, 'SELECT COUNT(*) AS c FROM produtos');
    assert.equal(qtd.c, 0);
  });

  it('códigos distintos 1001/1002/1003 — validação OK', async () => {
    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('1001', 'PRODUTO A'),
        linhaProduto('1002', 'PRODUTO B'),
        linhaProduto('1003', 'PRODUTO C')
      ]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'ok.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.com_erro, 0);
    assert.equal(validacao.resumo.prontos, 3);
    assert.equal(validacao.pode_importar, true);
    assert.ok(validacao.linhas.every((l) => l.status === STATUS.PRONTO));
  });

  it('preserva zero à esquerda 0637701012 e não confunde com 637701012', async () => {
    const mapped = mapearLinhaProduto(linhaProduto('0637701012', 'BROCA ZERO'));
    assert.equal(mapped.codigo_origem, '0637701012');
    assert.equal(chaveNomeCadastroSimples(mapped.codigo_origem), '0637701012');

    const dups = mapearDuplicidadesCodigoArquivo([
      { codigo_origem: '0637701012', nome: 'A' },
      { codigo_origem: '637701012', nome: 'B' }
    ]);
    assert.equal(dups.size, 0);

    const buffer = svc.gerarXlsxFixture({
      produtos: [
        linhaProduto('0637701012', 'BROCA COM ZERO'),
        linhaProduto('637701012', 'BROCA SEM ZERO')
      ]
    });
    const validacao = await svc.validarArquivoBuffer(db, buffer, { nomeArquivo: 'zeros.xlsx' , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.resumo.com_erro, 0);
    assert.equal(validacao.linhas[0].produto.codigo_origem, '0637701012');
    assert.equal(validacao.linhas[1].produto.codigo_origem, '637701012');
  });

  it('arquivo CDS_CADASTRAR_2_IMPORTACAO.xlsx — detecta 5986221100 linhas 1 e 14', async () => {
    const xlsxPath = path.join(
      process.env.USERPROFILE || '',
      'Downloads',
      'CDS_CADASTRAR_2_IMPORTACAO.xlsx'
    );
    if (!fs.existsSync(xlsxPath)) {
      // Ambiente sem o arquivo oficial — não falha o suite.
      return;
    }

    const buffer = fs.readFileSync(xlsxPath);
    const dados = extrairDadosImportacao(buffer);
    const dups = mapearDuplicidadesCodigoArquivo(dados.produtos);
    const info = dups.get(chaveNomeCadastroSimples('5986221100'));
    assert.ok(info, '5986221100 deve estar duplicado no arquivo');
    assert.equal(info.ocorrencias, 2);
    assert.deepEqual(info.linhas, [1, 14]);

    const validacao = await validarImportacao(db, dados, {
      nomeArquivo: 'CDS_CADASTRAR_2_IMPORTACAO.xlsx'
    , modo_fiscal_importacao: 'FISCAL'});
    assert.equal(validacao.pode_importar, false);
    assert.ok(validacao.resumo.com_erro >= 2);

    const linhasDup = validacao.linhas.filter(
      (l) => l.status === STATUS.CODIGO_DUPLICADO_ARQUIVO
        && String(l.produto.codigo_origem) === '5986221100'
    );
    assert.equal(linhasDup.length, 2);
    assert.deepEqual(linhasDup[0].duplicidade_arquivo.linhas, [1, 14]);

    await assert.rejects(
      () => executarImportacao(db, validacao, { dbPath, pastaBackup }),
      /erro/i
    );
    const qtd = await get(db, 'SELECT COUNT(*) AS c FROM produtos');
    assert.equal(qtd.c, 0);
  });
});
