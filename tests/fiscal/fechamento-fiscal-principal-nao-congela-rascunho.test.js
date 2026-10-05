/**
 * Sprint 4 (saneamento) — valor_principal NÃO congela em RASCUNHO/PRÉVIA.
 *
 * Regressão: abrir/editar o rascunho (adicionarRecebimento → montarDetalhe →
 * sincronizarSaldoAoAbrir) congelava valor_principal no 1º recebimento (400);
 * a prévia de 700 voltava valor_informado para 400 e a preparação falhava
 * ("Valor distribuído deve ser igual ao valor informado").
 *
 * Executar: node --test tests/fiscal/fechamento-fiscal-principal-nao-congela-rascunho.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  garantirSchemaFechamentoFiscal,
  criarRascunho,
  adicionarRecebimento,
  gerarPrevia,
  prepararEmissao,
  obterPorId,
  STATUS
} = require('../../backend/services/fechamento-fiscal');
const moduloConfig = require('../../backend/services/fechamento-fiscal/fechamentoFiscalModuloConfig');

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

const CFG_HOMOLOG = {
  codigoUf: '23',
  cnpj: '12345678000199',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  numeroAtual: 100,
  nomeEmpresa: 'EMPRESA TESTE LTDA',
  logradouro: 'RUA A',
  numero: '100',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipioCodigo: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '8835110000',
  tpImp: 4,
  csosn_padrao: '102',
  certificadoPath: null
};

async function schemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, preco_venda REAL DEFAULT 0, preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0, produto_fracionado INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN',
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
    ncm TEXT, cest TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, data_venda TEXT, total REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    status TEXT DEFAULT 'concluida', cancelada INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
    quantidade REAL DEFAULT 0, quantidade_fiscal REAL DEFAULT 0, quantidade_nao_fiscal REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    preco_unitario REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER, produto_id INTEGER,
    quantidade REAL, valor_unitario REAL, valor_total REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '12345678000199')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fiscal_ambiente', '2')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fiscal_serie', '1')`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function seedComercial(db, data = '2026-09-11') {
  const produtos = [
    [1, 'Pastel Carne', 10, 50], [2, 'Pastel Frango', 12, 50], [3, 'Açaí 500ml', 18, 50],
    [4, 'Pizza', 40, 50], [5, 'Refrigerante', 6, 50], [8, 'Item Caro', 1000, 5]
  ];
  for (const [id, nome, preco, saldo] of produtos) {
    await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
      VALUES (?,?,?,?,?,1,'UN',?,?,1,'21069090','5102','102',0)`, [id, nome, String(id), preco, preco / 2, saldo, saldo]);
  }
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada) VALUES (1,?,1784,1784,'concluida',0)`, [data]);
  const itens = [
    [1, 1, 20, 200, 10], [2, 2, 10, 120, 12], [3, 3, 8, 144, 18],
    [4, 4, 5, 200, 40], [5, 5, 20, 120, 6], [7, 8, 1, 1000, 1000]
  ];
  for (const [id, prod, qtd, sub, pu] of itens) {
    await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
      VALUES (?,1,?,?,?,0,?,?,?,?)`, [id, prod, qtd, qtd, sub, sub, sub, pu]);
  }
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada) VALUES (2,?,36,36,'concluida',0)`, [data]);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (8,2,1,3,3,0,36,36,36,12)`);
}

function depsPrep(db) {
  return {
    db,
    getFiscalConfig: async () => ({ ...CFG_HOMOLOG }),
    certificadoOpcional: true,
    bloquearProducaoEmTeste: true,
    capturarSnapshot: true
  };
}

async function linha(db, id) {
  return get(db, `SELECT status, valor_principal, valor_informado, valor_emitido_autorizado, valor_pendente_emissao
    FROM fechamentos_fiscais WHERE id = ?`, [id]);
}

describe('Fechamento fiscal — valor_principal não congela antes da 1ª emissão', () => {
  let dir;
  let db;

  before(async () => {
    moduloConfig._resetCacheForTests();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-principal-'));
    db = await openDb(path.join(dir, 'test.db'));
    await schemaBase(db);
    await seedComercial(db);
  });

  after(() => new Promise((resolve) => db.close(() => resolve())));

  it('RASCUNHO com vários recebimentos → prévia 700 → preparação OK; principal só congela na preparação', async () => {
    const ff = await criarRascunho({ data_fechamento: '2026-09-11', cnpj: '12345678000199' }, { db });

    await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 400, cnpj: '12345678000199' }, { db });
    let row = await linha(db, ff.id);
    assert.equal(row.status, STATUS.RASCUNHO);
    assert.equal(Number(row.valor_principal || 0), 0, 'RASCUNHO não pode congelar valor_principal no 1º recebimento');

    await adicionarRecebimento(ff.id, { operadora: 'Stone', valor: 180, cnpj: '12345678000199' }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'Mercado Pago', valor: 120, cnpj: '12345678000199' }, { db });
    await obterPorId(ff.id, { db });
    row = await linha(db, ff.id);
    assert.equal(Number(row.valor_principal || 0), 0, 'abrir o rascunho não congela valor_principal');

    const prev = await gerarPrevia({ id: ff.id, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    assert.ok(prev.previa.perfeita, prev.previa.mensagem);
    row = await linha(db, ff.id);
    assert.equal(row.status, STATUS.PREVIA);
    assert.equal(Number(row.valor_informado), 700, 'prévia não pode voltar valor_informado ao 1º recebimento');
    assert.equal(Number(row.valor_principal || 0), 0, 'PRÉVIA não congela valor_principal');

    await obterPorId(ff.id, { db });
    row = await linha(db, ff.id);
    assert.equal(Number(row.valor_informado), 700);
    assert.equal(Number(row.valor_principal || 0), 0);

    const prep = await prepararEmissao(ff.id, { gerarXml: true }, depsPrep(db));
    assert.equal(prep.ok, true);
    assert.equal(prep.status, STATUS.PRONTO_EMISSAO);

    row = await linha(db, ff.id);
    assert.equal(Number(row.valor_principal), 700, 'preparação congela o principal no valor da prévia');
    assert.equal(Number(row.valor_emitido_autorizado || 0), 0);
    assert.equal(Number(row.valor_pendente_emissao), 700);

    await obterPorId(ff.id, { db });
    row = await linha(db, ff.id);
    assert.equal(Number(row.valor_principal), 700, 'após congelado, abrir não altera o principal');
  });
});
