/**
 * Sprint 08.4 — Prazo/timezone cancelamento NFC-e Fechamento
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-4-prazo.test.js
 * NÃO transmite cancelamento real.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fiscal.js'), 'utf8');
const CANCEL_SRC = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/cancelarNfce.js'), 'utf8');
const DT_SRC = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/fiscalDateTime.js'), 'utf8');

const {
  obterDataHoraFiscalEstabelecimento,
  calcularPrazoCancelamentoNfce,
  parseDataHoraFiscal,
  PRAZO_CANCELAMENTO_NFCE_MINUTOS
} = require('../../backend/services/fiscal/fiscalDateTime');
const {
  cancelarDocumentoFiscalFechamento,
  LOCKS
} = require('../../backend/services/fechamento-fiscal/NfceCancelamentoFechamentoService');
const { ORIGEM_FECHAMENTO } = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

const CHAVE = '23260968645756000121650010000000511873269476';

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
function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

function notaComAuth(dhAuth) {
  return {
    id: 6,
    numero: 51,
    serie: 1,
    status: 'autorizada',
    chave_acesso: CHAVE,
    protocolo: '223260816956854',
    origem: ORIGEM_FECHAMENTO,
    xml_enviado: `<NFe><infNFe><dhEmi>${dhAuth}</dhEmi></infNFe></NFe>`,
    xml_retorno: `<ret><dhRecbto>${dhAuth}</dhRecbto><cStat>100</cStat></ret>`
  };
}

function mockCancel(cStat = '135') {
  return async (id) => ({
    sefaz: `<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>${cStat}</cStat><xMotivo>${cStat === '501' ? 'Rejeicao: Prazo' : 'Evento registrado'}</xMotivo><nProt>PROT-X</nProt><dhRegEvento>2026-09-13T18:30:00-03:00</dhRegEvento></infEvento></retEvento></retEnvEvento>`,
    notaId: id,
    chaveAcesso: CHAVE,
    protocolo: '223260816956854'
  });
}

describe('Sprint 08.4 — prazo e timezone cancelamento NFC-e', () => {
  let db;
  let nfceId;

  before(async () => {
    db = openMem();
    await run(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY)');
    await run(db, 'CREATE TABLE vendas_itens (id INTEGER PRIMARY KEY)');
    await run(db, 'CREATE TABLE financeiro (id INTEGER PRIMARY KEY)');
    await run(db, 'CREATE TABLE produtos (id INTEGER PRIMARY KEY, estoque REAL DEFAULT 0)');
    await run(db, `CREATE TABLE nfce_notas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, numero INTEGER, serie INTEGER,
      chave_acesso TEXT, ambiente INTEGER, status TEXT, xml_enviado TEXT, xml_retorno TEXT,
      protocolo TEXT, fechamento_fiscal_id INTEGER, fechamento_documento_id INTEGER, origem TEXT,
      created_at TEXT, updated_at TEXT
    )`);
    await run(db, `CREATE TABLE fechamentos_fiscais (id INTEGER PRIMARY KEY, status TEXT, atualizado_em TEXT)`);
    await run(db, `CREATE TABLE fechamentos_fiscais_documentos (
      id INTEGER PRIMARY KEY, fechamento_fiscal_id INTEGER, status TEXT, cstat TEXT, xmotivo TEXT, atualizado_em TEXT
    )`);
    await run(db, "INSERT INTO produtos (id, estoque) VALUES (1, 50)");
    await run(db, "INSERT INTO fechamentos_fiscais (id, status) VALUES (4, 'AUTORIZADO')");
    await run(db, "INSERT INTO fechamentos_fiscais_documentos (id, fechamento_fiscal_id, status) VALUES (2, 4, 'AUTORIZADO')");
    const auth = '2026-09-13T18:28:02-03:00';
    await run(db, `INSERT INTO nfce_notas (
      venda_id, numero, serie, chave_acesso, ambiente, status, xml_enviado, xml_retorno, protocolo,
      fechamento_fiscal_id, fechamento_documento_id, origem
    ) VALUES (NULL, 51, 1, ?, 1, 'autorizada', ?, ?, '223260816956854', 4, 2, ?)`,
    [CHAVE, `<NFe><dhEmi>${auth}</dhEmi><total><vNF>44.00</vNF></total></NFe>`, `<ret><dhRecbto>${auth}</dhRecbto><cStat>100</cStat><nProt>223260816956854</nProt></ret>`, ORIGEM_FECHAMENTO]);
    nfceId = (await get(db, 'SELECT id FROM nfce_notas WHERE chave_acesso=?', [CHAVE])).id;
  });

  after(async () => {
    LOCKS.clear();
    await close(db);
  });

  it('A — autorização + 1 minuto => dentro do prazo', () => {
    const auth = parseDataHoraFiscal('2026-09-13T18:28:02-03:00');
    const agora = new Date(auth.getTime() + 60 * 1000);
    const p = calcularPrazoCancelamentoNfce(notaComAuth('2026-09-13T18:28:02-03:00'), agora);
    assert.equal(p.dentro_prazo, true);
  });

  it('B — autorização + 29 minutos => dentro do prazo', () => {
    const auth = parseDataHoraFiscal('2026-09-13T18:28:02-03:00');
    const agora = new Date(auth.getTime() + 29 * 60 * 1000);
    const p = calcularPrazoCancelamentoNfce(notaComAuth('2026-09-13T18:28:02-03:00'), agora);
    assert.equal(p.dentro_prazo, true);
  });

  it('C — autorização + 30 minutos => dentro (limite + tolerância sync)', () => {
    const auth = parseDataHoraFiscal('2026-09-13T18:28:02-03:00');
    const agora = new Date(auth.getTime() + 30 * 60 * 1000);
    const p = calcularPrazoCancelamentoNfce(notaComAuth('2026-09-13T18:28:02-03:00'), agora);
    assert.equal(p.dentro_prazo, true);
    assert.equal(p.prazo_minutos, PRAZO_CANCELAMENTO_NFCE_MINUTOS);
  });

  it('D — autorização + 31 minutos => fora do prazo', () => {
    const auth = parseDataHoraFiscal('2026-09-13T18:28:02-03:00');
    const agora = new Date(auth.getTime() + 31 * 60 * 1000);
    const p = calcularPrazoCancelamentoNfce(notaComAuth('2026-09-13T18:28:02-03:00'), agora);
    assert.equal(p.dentro_prazo, false);
    assert.equal(p.codigo, 'CANCELAMENTO_FORA_DO_PRAZO');
  });

  it('E — timezone -03:00 no helper', () => {
    const s = obterDataHoraFiscalEstabelecimento(new Date('2026-09-13T21:28:02.000Z'));
    assert.match(s, /-03:00$/);
    assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    // implementação não retorna UTC cru
    assert.doesNotMatch(s, /Z$/);
  });

  it('F — timestamp UTC convertido corretamente no cálculo', () => {
    const authUtcIso = '2026-09-13T21:28:02.000Z'; // = 18:28:02-03:00
    const nota = {
      xml_retorno: `<ret><dhRecbto>2026-09-13T18:28:02-03:00</dhRecbto></ret>`
    };
    const agora = new Date(authUtcIso);
    agora.setMinutes(agora.getMinutes() + 10);
    const p = calcularPrazoCancelamentoNfce(nota, agora);
    assert.equal(p.dentro_prazo, true);
    assert.ok(p.minutos_decorridos >= 9.9 && p.minutos_decorridos <= 10.1);
  });

  it('G/H — cStat 135/155 cancelam', async () => {
    for (const st of ['135', '155']) {
      await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
      await run(db, "UPDATE fechamentos_fiscais SET status='AUTORIZADO' WHERE id=4");
      const out = await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
        deps: {
          cancelarNfcePorId: mockCancel(st),
          skipSnapshot: true,
          prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
        }
      });
      assert.equal(out.status, 'cancelada');
      assert.equal((await get(db, 'SELECT status FROM nfce_notas WHERE id=?', [nfceId])).status, 'cancelada');
    }
  });

  it('I — cStat 501 permanece AUTORIZADA', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada', xml_retorno='<ret><dhRecbto>2026-09-13T18:28:02-03:00</dhRecbto><cStat>100</cStat></ret>' WHERE id=?", [nfceId]);
    await assert.rejects(
      () => cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
        deps: {
          cancelarNfcePorId: mockCancel('501'),
          skipSnapshot: true,
          prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
        }
      }),
      (err) => err.code === 'SEFAZ_PRAZO_501' || /501|prazo/i.test(err.message)
    );
    assert.equal((await get(db, 'SELECT status FROM nfce_notas WHERE id=?', [nfceId])).status, 'autorizada');
  });

  it('J/K/L — rejeição 501 não mexe estoque/financeiro/venda', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    const antes = {
      v: (await get(db, 'SELECT COUNT(*) AS c FROM vendas')).c,
      f: (await get(db, 'SELECT COUNT(*) AS c FROM financeiro')).c,
      e: (await get(db, 'SELECT estoque FROM produtos WHERE id=1')).estoque
    };
    await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: mockCancel('501'),
        skipSnapshot: false,
        prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
      }
    }).catch(() => {});
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM vendas')).c, antes.v);
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM financeiro')).c, antes.f);
    assert.equal((await get(db, 'SELECT estoque FROM produtos WHERE id=1')).estoque, antes.e);
    assert.equal((await get(db, 'SELECT venda_id FROM nfce_notas WHERE id=?', [nfceId])).venda_id, null);
  });

  it('M — FF sem venda + cancelamento autorizado permitido', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    await run(db, "UPDATE fechamentos_fiscais SET status='AUTORIZADO' WHERE id=4");
    const out = await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: mockCancel('135'),
        skipSnapshot: true,
        prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
      }
    });
    assert.equal(out.success, true);
    assert.equal(out.venda_id, null);
  });

  it('N — FF sem venda + rejeitado permanece autorizada', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: mockCancel('501'),
        skipSnapshot: true,
        prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
      }
    }).catch(() => {});
    assert.equal((await get(db, 'SELECT status FROM nfce_notas WHERE id=?', [nfceId])).status, 'autorizada');
  });

  it('O — cancelamento duplicado idempotente', async () => {
    await run(db, "UPDATE nfce_notas SET status='cancelada' WHERE id=?", [nfceId]);
    let calls = 0;
    const r = await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: async (id) => { calls += 1; return mockCancel('135')(id); },
        skipSnapshot: true
      }
    });
    assert.equal(r.idempotente, true);
    assert.equal(calls, 0);
  });

  it('P — concorrência 409', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    await run(db, "UPDATE fechamentos_fiscais SET status='AUTORIZADO' WHERE id=4");
    let calls = 0;
    const slow = async (id) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 60));
      return mockCancel('135')(id);
    };
    const p1 = cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: slow,
        skipSnapshot: true,
        prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
      }
    });
    await new Promise((r) => setTimeout(r, 5));
    const p2 = cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: slow,
        skipSnapshot: true,
        prazoOverride: { dentro_prazo: true, dh_autorizacao: '2026-09-13T18:28:02-03:00' }
      }
    });
    const results = await Promise.allSettled([p1, p2]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(calls, 1);
  });

  it('Q/R — dhEvento usa helper fiscal (sem toISOString indevido)', () => {
    assert.match(CANCEL_SRC, /obterDataHoraFiscalEstabelecimento/);
    assert.doesNotMatch(CANCEL_SRC, /toISOString\(\)/);
    assert.match(DT_SRC, /obterDataHoraFiscalEstabelecimento/);
    const dh = obterDataHoraFiscalEstabelecimento();
    assert.match(dh, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
  });

  it('contrato — pré-validação bloqueia fora do prazo e endpoint diagnóstico existe', async () => {
    assert.match(ROTA, /cancelamento-diagnostico/);
    assert.match(FRONT, /cancelamento-diagnostico/);
    assert.match(FRONT, /dentro do prazo normal de cancelamento/);
    assert.match(FRONT, /fora do prazo normal de cancelamento/);
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    await assert.rejects(
      () => cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
        deps: {
          cancelarNfcePorId: mockCancel('135'),
          skipSnapshot: true,
          agora: new Date(parseDataHoraFiscal('2026-09-13T18:28:02-03:00').getTime() + 40 * 60 * 1000)
        }
      }),
      (err) => err.code === 'CANCELAMENTO_FORA_DO_PRAZO'
    );
  });
});
