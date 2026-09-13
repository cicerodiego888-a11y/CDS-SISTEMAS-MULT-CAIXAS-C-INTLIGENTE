/**
 * Sprint 07.8 — Correção definitiva da conciliação do Fechamento Fiscal do Dia
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint07-8.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fechamento-fiscal.js'), 'utf8');

const {
  obterResumoDia
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalElegibilidadeService');
const {
  garantirSchemaFechamentoFiscal
} = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');
const {
  criarRascunho,
  adicionarRecebimento,
  gerarPrevia,
  obterPorId
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');

function openDb() {
  return new sqlite3.Database(':memory:');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function schemaComercial(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, item_fiscal INTEGER DEFAULT 0,
    estoque REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, data_venda TEXT, total REAL, valor_fiscal REAL DEFAULT 0,
    valor_nao_fiscal REAL DEFAULT 0, cancelada INTEGER DEFAULT 0, status TEXT DEFAULT 'finalizada'
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL,
    quantidade_fiscal REAL, quantidade_nao_fiscal REAL, subtotal REAL,
    valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE venda_pagamentos (id INTEGER PRIMARY KEY, venda_id INTEGER, valor REAL)`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '68645756000121')`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function montarCenario44(db) {
  await run(db, `INSERT INTO produtos (id,nome,codigo,item_fiscal,estoque,saldo_fiscal,saldo_nao_fiscal)
    VALUES (1,'Coca','C1',1,100,100,100)`);
  const itens = [
    [1, 1, 1, 1, 1, 0, 8, 8, 0, 8],
    [2, 2, 1, 1, 1, 0, 8, 8, 0, 8],
    [3, 3, 1, 1, 1, 0, 4, 4, 0, 4],
    [4, 4, 1, 1, 1, 0, 8, 8, 0, 8],
    [5, 4, 1, 1, 1, 0, 13, 13, 0, 13],
    [6, 4, 1, 1, 1, 0, 3, 3, 0, 3]
  ];
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,valor_nao_fiscal,cancelada,status)
    VALUES (1,'2026-09-13 10:00:00',8,8,0,0,'finalizada')`);
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,valor_nao_fiscal,cancelada,status)
    VALUES (2,'2026-09-13 10:05:00',8,8,0,0,'finalizada')`);
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,valor_nao_fiscal,cancelada,status)
    VALUES (3,'2026-09-13 10:10:00',4,4,0,0,'finalizada')`);
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,valor_nao_fiscal,cancelada,status)
    VALUES (4,'2026-09-13 10:15:00',24,24,0,0,'finalizada')`);
  for (const row of itens) {
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, row);
  }
}

function extrairFuncao(nome) {
  const inicio = FRONT.indexOf(`function ${nome}`);
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  let i = inicio;
  let depth = 0;
  let started = false;
  for (; i < FRONT.length; i += 1) {
    const ch = FRONT[i];
    if (ch === '{') {
      depth += 1;
      started = true;
    } else if (ch === '}') {
      depth -= 1;
      if (started && depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return FRONT.slice(inicio, i);
}

function contextoConciliacao(estado) {
  const src = [
    extrairFuncao('ffdTotalRecebimentos'),
    extrairFuncao('ffdValorReferenciaConciliacao'),
    extrairFuncao('ffdDiferencaConciliacao'),
    extrairFuncao('ffdRecebimentosConciliados')
  ].join('\n');
  const sandbox = {
    __ffdEstado: estado,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

const deps = { moduloOn: true, capturarSnapshot: false };

describe('Sprint 07.8 — conciliação pela fotografia do fechamento', { concurrency: false }, () => {
  let db;

  before(async () => {
    db = openDb();
    await schemaComercial(db);
    await montarCenario44(db);
  });

  after(async () => {
    await close(db);
  });

  it('01 — residual do dia pode ser R$0 após prévia, mas exclusão restaura R$44', async () => {
    const criado = await criarRascunho({
      data_fechamento: '2026-09-13',
      valor_alvo: 250,
      valor_min: 80,
      valor_max: 400,
      usuario_id: 1
    }, { db, ...deps });

    await adicionarRecebimento(criado.id, {
      operadora: 'Mercado pago',
      cnpj: '68645756000121',
      valor: 44
    }, { db, ...deps });

    const retorno = await gerarPrevia({
      id: criado.id,
      data: '2026-09-13',
      valor_informado: 44,
      valor_alvo: 250,
      valor_min: 80,
      valor_max: 400,
      persistir: true
    }, { db, ...deps });

    const previa = retorno.previa || retorno;
    assert.equal(Number(previa.valor_distribuido), 44);
    assert.equal(Number(previa.diferenca), 0);
    assert.equal(Boolean(previa.perfeita), true);

    const residual = await obterResumoDia(db, '2026-09-13');
    assert.equal(Number(residual.valor_fiscal_elegivel), 0);

    const comExclusao = await obterResumoDia(db, '2026-09-13', { excluirFechamentoId: criado.id });
    assert.equal(Number(comExclusao.valor_fiscal_elegivel), 44);
    assert.equal(Number(comExclusao.unidades_fiscais_elegiveis), 6);

    const ff = await obterPorId(criado.id, { db });
    assert.equal(Number(ff.valor_informado), 44);
    assert.equal(Number(ff.valor_distribuido), 44);
    assert.equal(Number(ff.diferenca), 0);
    const somaRec = (ff.recebimentos || []).reduce((s, r) => s + Number(r.valor || 0), 0);
    assert.equal(somaRec, 44);

    const ctx = contextoConciliacao({
      previa: {
        valor_distribuido: Number(ff.valor_distribuido),
        valor_informado: Number(ff.valor_informado),
        perfeita: true,
        vendas: ff.previa_vendas
      },
      recebimentos: ff.recebimentos.map((r) => ({ valor: Number(r.valor) })),
      resumo: { valor_fiscal_elegivel: residual.valor_fiscal_elegivel },
      fechamentoId: ff.id
    });
    assert.equal(ctx.ffdValorReferenciaConciliacao(), 44);
    assert.equal(ctx.ffdDiferencaConciliacao(), 0);
    assert.equal(ctx.ffdRecebimentosConciliados(), true);
  });

  it('02 — rota /resumo aceita fechamento_id e exclui o próprio fechamento', () => {
    assert.match(ROTA, /router\.get\('\/resumo'/);
    assert.match(ROTA, /fechamento_id/);
    assert.match(ROTA, /excluirFechamentoId/);
    assert.match(ROTA, /obterResumoDia\([\s\S]*opts\)/);
  });

  it('03 — frontend não usa residual diário quando existe previa.valor_distribuido', () => {
    assert.match(FRONT, /function ffdValorReferenciaConciliacao/);
    assert.match(FRONT, /previa\.valor_distribuido/);
    assert.match(FRONT, /function ffdDiferencaConciliacao/);
    assert.match(FRONT, /ffdValorReferenciaConciliacao\(\)/);
    assert.match(FRONT, /Valor da composição/);
    assert.match(FRONT, /fechamento_id/);
    assert.match(FRONT, /qsResumo\.set\('fechamento_id'/);

    const ctxComPrevia = contextoConciliacao({
      previa: { valor_distribuido: 44, valor_informado: 44, perfeita: true, vendas: [{}] },
      recebimentos: [{ valor: 44 }],
      resumo: { valor_fiscal_elegivel: 0 },
      fechamentoId: 4
    });
    assert.equal(ctxComPrevia.ffdValorReferenciaConciliacao(), 44);
    assert.equal(ctxComPrevia.ffdDiferencaConciliacao(), 0);
    assert.equal(ctxComPrevia.ffdRecebimentosConciliados(), true);

    const ctxSemPrevia = contextoConciliacao({
      previa: null,
      recebimentos: [{ valor: 44 }],
      resumo: { valor_fiscal_elegivel: 44 },
      fechamentoId: null
    });
    assert.equal(ctxSemPrevia.ffdValorReferenciaConciliacao(), 44);
    assert.equal(ctxSemPrevia.ffdDiferencaConciliacao(), 0);
  });

  it('04 — ffdCarregarDia consulta lista antes do resumo e preserva polling', () => {
    const idxLista = FRONT.indexOf('fiscal/fechamentos?data=');
    const idxResumo = FRONT.indexOf('fiscal/fechamentos/resumo?');
    assert.ok(idxLista > 0 && idxResumo > 0);
    assert.ok(idxLista < idxResumo, 'lista deve vir antes do resumo');
    assert.match(FRONT, /silencioso: true/);
    assert.match(FRONT, /ff\.previa_vendas && ff\.previa_vendas\.length && !silencioso/);
    assert.match(FRONT, /!\(__ffdEstado\.recebimentos \|\| \[\]\)\.length/);
  });

  it('05 — Motor Fiscal e transmissão automática permanecem fora do escopo', () => {
    assert.doesNotMatch(FRONT, /enviarAutorizacao|assinarNFe|autorizarNFe/);
    assert.match(FRONT, /Transmitir para SEFAZ/);
    assert.match(FRONT, /prop\('disabled'/);
  });
});
