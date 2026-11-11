/**
 * IMP-PROD-02 — tratamento interativo de erros no Importador Inicial V2.
 * Executar: node --test tests/produtos/importacao-inicial-v2-erros-interativos.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const svc = require('../../backend/services/importacao-inicial-produtos');
const { STATUS } = require('../../backend/services/importacao-inicial-produtos/helpers');
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
    codigo TEXT, nome TEXT, nome_busca TEXT, categoria_id INTEGER, subcategoria_id INTEGER, unidade TEXT,
    preco_compra REAL, lucro_percentual REAL, preco_venda REAL,
    estoque_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0, fornecedor TEXT,
    ncm TEXT, cfop TEXT, csosn TEXT, origem INTEGER, cest TEXT, codigo_barras TEXT,
    aliquota_icms REAL, aliquota_pis REAL, aliquota_cofins REAL,
    controlar_validade INTEGER, controla_estoque INTEGER DEFAULT 1,
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
  await seedParCategoriaSub(db, run, get, 'Cat', 'Sub');
}

function linhaProduto(codigo, nome, overrides = {}) {
  return {
    'Código origem': codigo,
    'Nome CDS': nome,
    Marca: 'MARCA',
    Categoria: 'Cat',
    Subcategoria: 'Sub',
    'Unidade base': 'UN',
    'Custo unitário': 1,
    'Markup %': 100,
    'Preço venda unitário': 2,
    'Qtd documento': 0,
    'Controla Estoque': 'SIM',
    'Estoque Fiscal': 0,
    'Estoque Não Fiscal': 0,
    ...overrides
  };
}

describe('IMP-PROD-02 — erros interativos Importador V2', () => {
  let dir;
  let dbPath;
  let pastaBackup;
  let db;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-erros-'));
    dbPath = path.join(dir, 't.db');
    pastaBackup = path.join(dir, 'backups');
    fs.mkdirSync(pastaBackup);
  });

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = await openDb(dbPath);
    await criarSchema(db);
  });

  afterEach(async () => {
    await new Promise((res) => db.close(() => res()));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  async function validar(produtos, nomeArquivo) {
    const buffer = svc.gerarXlsxFixture({ produtos, apresentacoes: [] });
    return svc.validarArquivoBuffer(db, buffer, { nomeArquivo });
  }

  it('TESTE 1 — produto válido sem ação de correção', async () => {
    const v = await validar([
      linhaProduto('OK-1', 'PRODUTO OK', { 'Estoque Fiscal': 1 })
    ], 't1.xlsx');
    assert.equal(v.pode_importar, true);
    assert.equal(Number(v.resumo.com_erro), 0);
    assert.equal((v.linhas_com_erro || []).length, 0);
    assert.equal(v.linhas[0].status, STATUS.PRONTO);
  });

  it('TESTE 2 — produto com erro listado com mensagem', async () => {
    const v = await validar([
      linhaProduto('ERR-1', 'PRECO BAD', { 'Preço venda unitário': 0, 'Estoque Fiscal': 1 })
    ], 't2.xlsx');
    assert.equal(Number(v.resumo.com_erro), 1);
    assert.equal(v.pode_importar, false);
    assert.equal((v.linhas_com_erro || []).length, 1);
    const err = v.linhas_com_erro[0];
    assert.equal(err.status, STATUS.ERRO);
    assert.ok((err.mensagens || []).some((m) => /preço de venda inválido/i.test(m)));
    assert.ok(Number(err.linha) >= 1);
  });

  it('TESTE 3 — editar erro e sair da lista', async () => {
    const v = await validar([
      linhaProduto('ED-1', 'CORRIGIR', { 'Preço venda unitário': 0, 'Estoque Fiscal': 2 })
    ], 't3.xlsx');
    assert.equal(v.pode_importar, false);
    const linha = v.linhas_com_erro[0].linha;
    const out = await svc.editarLinhaSessao(db, v.sessao_id, {
      linha,
      campos: { preco_venda: 9.9 }
    });
    assert.equal(Number(out.resumo.com_erro), 0);
    assert.equal(out.pode_importar, true);
    assert.equal((out.linhas_com_erro || []).length, 0);
    assert.ok(out.linha_editada);
    assert.equal(out.linha_editada.status, STATUS.PRONTO);
    const before = await all(db, `SELECT id FROM produtos`);
    assert.equal(before.length, 0);
  });

  it('TESTE 4 — editar e continuar inválido', async () => {
    const v = await validar([
      linhaProduto('ED-2', 'AINDA ERRADO', { NCM: '220210', 'Estoque Fiscal': 1 })
    ], 't4.xlsx');
    assert.equal(Number(v.resumo.com_erro), 1);
    const linha = v.linhas_com_erro[0].linha;
    const out = await svc.editarLinhaSessao(db, v.sessao_id, {
      linha,
      campos: { ncm: '123' }
    });
    assert.equal(Number(out.resumo.com_erro), 1);
    assert.equal(out.pode_importar, false);
    assert.ok((out.linha_editada.mensagens || []).some((m) => /ncm/i.test(m)));
  });

  it('TESTE 5 — excluir erro não cria no banco', async () => {
    const v = await validar([
      linhaProduto('OK-X', 'VALIDO', { 'Estoque Fiscal': 1 }),
      linhaProduto('ERR-X', 'INVALIDO', { 'Preço venda unitário': -5, 'Estoque Fiscal': 1 })
    ], 't5.xlsx');
    assert.equal(Number(v.resumo.com_erro), 1);
    const linhaErro = v.linhas_com_erro[0].linha;
    const out = await svc.excluirLinhaSessao(db, v.sessao_id, { linha: linhaErro });
    assert.equal(Number(out.resumo.com_erro), 0);
    assert.equal(Number(out.resumo.produtos_excluidos), 1);
    assert.equal(out.pode_importar, true);
    assert.equal(out.linhas.length, 1);
    assert.equal(out.linhas[0].produto.codigo_origem, 'OK-X');

    await executarImportacao(db, out, { importId: 't5', pastaBackup, dbPath });
    const rows = await all(db, `SELECT codigo, nome FROM produtos`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].codigo, 'OK-X');
    assert.equal(await get(db, `SELECT COUNT(*) AS n FROM produtos WHERE codigo = ?`, ['ERR-X']).then((r) => Number(r.n)), 0);
  });

  it('TESTE 6 — vários erros listados juntos', async () => {
    const v = await validar([
      linhaProduto('V1', 'OK', { 'Estoque Fiscal': 1 }),
      linhaProduto('E1', 'PRECO', { 'Preço venda unitário': 0, 'Estoque Fiscal': 1 }),
      linhaProduto('E2', 'NCM BAD', { NCM: '99', 'Estoque Fiscal': 1 }),
      linhaProduto('E3', 'CSOSN BAD', { CSOSN: '999', 'Estoque Fiscal': 1 })
    ], 't6.xlsx');
    assert.equal(Number(v.resumo.com_erro), 3);
    assert.equal((v.linhas_com_erro || []).length, 3);
    assert.equal(v.pode_importar, false);
  });

  it('TESTE 7 — estoque fiscal + não fiscal = um cadastro', async () => {
    const v = await validar([
      linhaProduto('EST-1', 'ARROZ 5KG', {
        'Estoque Fiscal': 10,
        'Estoque Não Fiscal': 20
      })
    ], 't7.xlsx');
    assert.equal(v.pode_importar, true);
    await executarImportacao(db, v, { importId: 't7', pastaBackup, dbPath });
    const rows = await all(db, `SELECT * FROM produtos WHERE codigo = ?`, ['EST-1']);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].saldo_fiscal), 10);
    assert.equal(Number(rows[0].saldo_nao_fiscal), 20);
    assert.equal(Number(rows[0].estoque_atual), 30);
  });

  it('TESTE 8 — duplicidade clara + exclusão resolve', async () => {
    const v = await validar([
      linhaProduto('DUP', 'PROD A', { 'Estoque Fiscal': 1 }),
      linhaProduto('DUP', 'PROD B', { 'Estoque Fiscal': 2 })
    ], 't8.xlsx');
    assert.ok(Number(v.resumo.com_erro) >= 2);
    const dups = (v.linhas_com_erro || []).filter((l) => l.status === STATUS.CODIGO_DUPLICADO_ARQUIVO);
    assert.ok(dups.length >= 2);
    assert.ok((dups[0].mensagens || []).some((m) => /duplicado/i.test(m)));

    const out1 = await svc.excluirLinhaSessao(db, v.sessao_id, { linha: dups[0].linha });
    // após excluir uma, a outra ainda pode estar duplicada se só restar 1 — deve liberar
    assert.equal(out1.linhas.length, 1);
    assert.equal(Number(out1.resumo.com_erro), 0);
    assert.equal(out1.pode_importar, true);
  });

  it('TESTE 9 — nenhum erro libera importação', async () => {
    const v = await validar([
      linhaProduto('N1', 'A', { 'Estoque Fiscal': 1 }),
      linhaProduto('N2', 'B', { 'Estoque Não Fiscal': 3 })
    ], 't9.xlsx');
    assert.equal(Number(v.resumo.com_erro), 0);
    assert.equal(v.pode_importar, true);
    assert.equal(Number(v.resumo.produtos_da_planilha), 2);
    assert.equal(Number(v.resumo.produtos_excluidos), 0);
  });

  it('edição não grava no banco até importar', async () => {
    const v = await validar([
      linhaProduto('MEM-1', 'SO MEMORIA', { 'Preço venda unitário': 0, 'Estoque Fiscal': 1 })
    ], 'mem.xlsx');
    await svc.editarLinhaSessao(db, v.sessao_id, {
      linha: v.linhas_com_erro[0].linha,
      campos: { preco_venda: 5, nome: 'NOME NOVO' }
    });
    const rows = await all(db, `SELECT id FROM produtos`);
    assert.equal(rows.length, 0);
  });
});
