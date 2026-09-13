/**
 * Sprint 08.1 — Integração NFC-e autorizada do Fechamento com histórico oficial
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-1.test.js
 * NÃO transmite em produção.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const TX_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'),
  'utf8'
);
const HIST_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/NfceHistoricoOficialService.js'),
  'utf8'
);
const ROTA_FISCAL = fs.readFileSync(path.join(ROOT, 'backend/rotas/fiscal.js'), 'utf8');
const FRONT_FISCAL = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');

const {
  persistirNfceAutorizadaDoFechamento,
  sincronizarHistoricoNfceDoFechamento,
  ORIGEM_FECHAMENTO
} = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

function openMem() {
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
function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function schemaBase(db) {
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, codigo TEXT, total REAL, status TEXT
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL)`);
  await run(db, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, estoque REAL DEFAULT 0)`);
  await run(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    chave_acesso TEXT,
    ambiente INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pendente',
    xml_enviado TEXT,
    xml_retorno TEXT,
    protocolo TEXT,
    recibo TEXT,
    qr_code_url TEXT,
    danfe_html TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, status TEXT, valor_informado REAL, valor_distribuido REAL
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos (
    id INTEGER PRIMARY KEY,
    fechamento_fiscal_id INTEGER,
    status TEXT,
    numero INTEGER,
    serie TEXT,
    ambiente INTEGER,
    chave_acesso TEXT,
    protocolo TEXT,
    cstat TEXT,
    xmotivo TEXT,
    recibo TEXT,
    xml_enviado TEXT,
    xml_assinado TEXT,
    xml_retorno TEXT,
    xml_autorizado TEXT
  )`);
}

describe('Sprint 08.1 — histórico oficial NFC-e do Fechamento', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO vendas (id, codigo, total, status) VALUES (1, 'V1', 10, 'finalizada')`);
    await run(db, `INSERT INTO produtos (id, estoque) VALUES (1, 100)`);
    await run(db, `INSERT INTO nfce_notas (venda_id, numero, serie, chave_acesso, ambiente, status, protocolo)
      VALUES (1, 10, 1, 'CHAVE-VENDA-10', 1, 'autorizada', 'PROT-V')`);
    await run(db, `INSERT INTO fechamentos_fiscais (id, status, valor_informado, valor_distribuido)
      VALUES (4, 'AUTORIZADO', 44, 44)`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo, cstat, xmotivo,
      xml_enviado, xml_retorno
    ) VALUES (
      2, 4, 'AUTORIZADO', 51, '1', 1,
      '23260968645756000121650010000000511873269476',
      '223260816956854', '100', 'Autorizado o uso da NF-e',
      '<NFe>enviado</NFe>', '<ret>ok</ret>'
    )`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo, cstat, xmotivo
    ) VALUES (
      1, 4, 'REJEITADO', 50, '1', 1, 'CHAVE-REJ-50', NULL, '442', 'Rejeicao'
    )`);
  });

  after(async () => {
    await close(db);
  });

  it('A — NFC-e de venda normal continua no histórico', async () => {
    const rows = await all(db, `SELECT * FROM nfce_notas WHERE chave_acesso='CHAVE-VENDA-10'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'autorizada');
    assert.equal(rows[0].venda_id, 1);
  });

  it('B — NFC-e autorizada do fechamento aparece em nfce_notas (fonte da tela)', async () => {
    assert.match(ROTA_FISCAL, /router\.get\('\/notas'/);
    assert.match(ROTA_FISCAL, /FROM nfce_notas n/);
    assert.match(FRONT_FISCAL, /fiscal\/notas/);

    const sync = await sincronizarHistoricoNfceDoFechamento(db, 4);
    assert.equal(sync.ok, true);
    const nota = await get(
      db,
      `SELECT * FROM nfce_notas WHERE chave_acesso='23260968645756000121650010000000511873269476'`
    );
    assert.ok(nota);
    assert.equal(nota.status, 'autorizada');
    assert.equal(Number(nota.numero), 51);
    assert.equal(Number(nota.serie), 1);
    assert.equal(nota.protocolo, '223260816956854');
    assert.equal(nota.origem, ORIGEM_FECHAMENTO);
    assert.equal(Number(nota.fechamento_fiscal_id), 4);
    assert.equal(nota.venda_id, null);
  });

  it('C — NFC-e rejeitada do fechamento NÃO vira autorizada', async () => {
    const rej = await get(db, `SELECT * FROM fechamentos_fiscais_documentos WHERE id=1`);
    const r = await persistirNfceAutorizadaDoFechamento(db, rej, { fechamentoId: 4 });
    assert.equal(r.ignorado, true);
    const nota = await get(db, `SELECT * FROM nfce_notas WHERE chave_acesso='CHAVE-REJ-50'`);
    assert.equal(nota, undefined);
  });

  it('D — cancelada mantém status existente (não reautoriza)', async () => {
    await run(db, `INSERT INTO nfce_notas (venda_id, numero, serie, chave_acesso, ambiente, status)
      VALUES (1, 11, 1, 'CHAVE-CANC', 1, 'cancelada')`);
    const r = await persistirNfceAutorizadaDoFechamento(db, {
      id: 99,
      status: 'CANCELADA',
      numero: 11,
      serie: 1,
      ambiente: 1,
      chave_acesso: 'CHAVE-CANC'
    }, { fechamentoId: 4 });
    assert.equal(r.ignorado, true);
    const nota = await get(db, `SELECT status FROM nfce_notas WHERE chave_acesso='CHAVE-CANC'`);
    assert.equal(nota.status, 'cancelada');
  });

  it('E — reprocessar autorização não duplica nfce_notas', async () => {
    const antes = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas
      WHERE chave_acesso='23260968645756000121650010000000511873269476'`);
    const sync = await sincronizarHistoricoNfceDoFechamento(db, 4);
    assert.equal(sync.resultados[0].idempotente, true);
    const depois = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas
      WHERE chave_acesso='23260968645756000121650010000000511873269476'`);
    assert.equal(antes.c, 1);
    assert.equal(depois.c, 1);
  });

  it('F/G/H — não cria venda, financeiro nem baixa estoque', async () => {
    const v = await get(db, `SELECT COUNT(*) AS c FROM vendas`);
    const f = await get(db, `SELECT COUNT(*) AS c FROM financeiro`);
    const e = await get(db, `SELECT estoque FROM produtos WHERE id=1`);
    await sincronizarHistoricoNfceDoFechamento(db, 4);
    assert.equal((await get(db, `SELECT COUNT(*) AS c FROM vendas`)).c, v.c);
    assert.equal((await get(db, `SELECT COUNT(*) AS c FROM financeiro`)).c, f.c);
    assert.equal((await get(db, `SELECT estoque FROM produtos WHERE id=1`)).estoque, e.estoque);
  });

  it('I/J — chave única e número inalterado', async () => {
    const nota = await get(
      db,
      `SELECT numero, chave_acesso FROM nfce_notas WHERE chave_acesso='23260968645756000121650010000000511873269476'`
    );
    assert.equal(Number(nota.numero), 51);
    assert.equal(nota.chave_acesso, '23260968645756000121650010000000511873269476');
  });

  it('K — contrato de integração no fluxo de transmissão', () => {
    assert.match(TX_SRC, /persistirNfceAutorizadaDoFechamento/);
    assert.match(TX_SRC, /historico_nfce_persistido/);
    assert.match(HIST_SRC, /somente após AUTORIZADO|Status .* não gera NFC-e autorizada/i);
    assert.match(HIST_SRC, /fechamento_fiscal_dia/);
    assert.doesNotMatch(HIST_SRC, /enviarAutorizacao|assinarNFe/);
  });
});
