/**
 * Sprint 08.5 — Cancelamento extemporâneo NFC-e CE (auditoria/suporte, SEM transmissão).
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-5-extemporaneo.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');

const {
  RESULTADO_PESQUISA,
  CANCELAMENTO_STATUS,
  POLITICA_NFCE_65_CE,
  POLITICA_NFE_55_CE,
  avaliarCancelamentoExtemporaneo,
  obterPoliticaCancelamentoPorModelo
} = require('../../backend/services/fiscal/cancelamentoExtemporaneoNfceCe');
const {
  montarDiagnosticoCancelamento,
  calcularPrazoCancelamentoNfce
} = require('../../backend/services/fiscal/fiscalDateTime');
const {
  cancelarDocumentoFiscalFechamento,
  LOCKS
} = require('../../backend/services/fechamento-fiscal/NfceCancelamentoFechamentoService');
const { ORIGEM_FECHAMENTO } = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

const CHAVE = '23260968645756000121650010000000511873269476';
const JUST = 'Cancelamento de teste sprint 08.5 — documento fiscal.';

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

function notaBase(dhAuth, extra) {
  return Object.assign({
    id: 6,
    numero: 51,
    serie: 1,
    status: 'autorizada',
    chave_acesso: CHAVE,
    protocolo: '223260816956854',
    origem: ORIGEM_FECHAMENTO,
    venda_id: null,
    fechamento_fiscal_id: 4,
    ambiente: 1,
    xml_enviado: `<NFe><infNFe><ide><mod>65</mod></ide><dhEmi>${dhAuth}</dhEmi></infNFe></NFe>`,
    xml_retorno: `<ret><dhRecbto>${dhAuth}</dhRecbto><cStat>100</cStat></ret>`
  }, extra || {});
}

function mockCancel(cStat) {
  return async (id) => ({
    sefaz: `<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>${cStat}</cStat><xMotivo>${cStat === '501' ? 'Rejeicao: Prazo' : 'Evento registrado'}</xMotivo><nProt>PROT-X</nProt><dhRegEvento>2026-09-13T18:30:00-03:00</dhRegEvento></infEvento></retEvento></retEnvEvento>`,
    notaId: id,
    chaveAcesso: CHAVE
  });
}

describe('Sprint 08.5 — extemporâneo NFC-e CE (sem TX real)', () => {
  let db;
  let nfceId;

  before(async () => {
    db = openMem();
    await run(db, `CREATE TABLE nfce_notas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER,
      numero INTEGER, serie INTEGER, chave_acesso TEXT, protocolo TEXT,
      status TEXT, ambiente INTEGER, origem TEXT, fechamento_fiscal_id INTEGER,
      fechamento_documento_id INTEGER, xml_enviado TEXT, xml_retorno TEXT,
      created_at TEXT, updated_at TEXT
    )`);
    await run(db, `CREATE TABLE vendas (id INTEGER PRIMARY KEY, codigo TEXT)`);
    await run(db, `CREATE TABLE vendas_itens (id INTEGER PRIMARY KEY, venda_id INTEGER)`);
    await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY)`);
    await run(db, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, estoque REAL)`);
    await run(db, `INSERT INTO produtos (id, estoque) VALUES (1, 10)`);

    const dh = '2026-09-13T18:28:02-03:00';
    const r = await run(
      db,
      `INSERT INTO nfce_notas (venda_id, numero, serie, chave_acesso, protocolo, status, ambiente, origem, fechamento_fiscal_id, xml_enviado, xml_retorno, created_at)
       VALUES (NULL, 51, 1, ?, '223260816956854', 'autorizada', 1, ?, 4, ?, ?, datetime('now','localtime'))`,
      [
        CHAVE,
        ORIGEM_FECHAMENTO,
        `<NFe><infNFe><ide><mod>65</mod></ide><dhEmi>${dh}</dhEmi></infNFe></NFe>`,
        `<ret><dhRecbto>${dh}</dhRecbto><cStat>100</cStat></ret>`
      ]
    );
    nfceId = r.id;
  });

  after(async () => {
    LOCKS.clear();
    await close(db);
  });

  it('A. NFC-e dentro dos 30 min => pode cancelar normalmente', () => {
    const auth = '2026-09-13T18:00:00-03:00';
    const agora = new Date('2026-09-13T18:01:00-03:00');
    const diag = montarDiagnosticoCancelamento(notaBase(auth), agora);
    assert.equal(diag.dentro_prazo_normal, true);
    assert.equal(diag.pode_transmitir_110111, true);
    assert.equal(diag.cancelamento_status, CANCELAMENTO_STATUS.DENTRO_PRAZO_NORMAL);
  });

  it('B. NFC-e fora dos 30 min => bloqueada', () => {
    const auth = '2026-09-13T18:00:00-03:00';
    const agora = new Date('2026-09-13T18:31:00-03:00');
    const diag = montarDiagnosticoCancelamento(notaBase(auth), agora);
    assert.equal(diag.dentro_prazo_normal, false);
    assert.equal(diag.pode_transmitir_110111, false);
    assert.equal(diag.cancelamento_status, CANCELAMENTO_STATUS.FORA_DO_PRAZO);
    assert.equal(diag.status_fiscal, 'autorizada');
  });

  it('C. NF-e 55 com regra extemporânea => não aplicar automaticamente à NFC-e 65', () => {
    const nfe55 = obterPoliticaCancelamentoPorModelo('55');
    const nfce65 = obterPoliticaCancelamentoPorModelo('65');
    assert.equal(nfe55.cancelamento_extemporaneo_comprovado, true);
    assert.equal(nfce65.cancelamento_extemporaneo_comprovado, false);
    assert.equal(nfce65.resultado_pesquisa, RESULTADO_PESQUISA);

    const eval55 = avaliarCancelamentoExtemporaneo({ modelo: '55', dentroPrazoNormal: false });
    const eval65 = avaliarCancelamentoExtemporaneo({ modelo: '65', dentroPrazoNormal: false });
    assert.equal(eval55.cancelamento_extemporaneo_comprovado, true);
    assert.equal(eval65.cancelamento_extemporaneo_disponivel, false);
    assert.notEqual(eval55.modelo, eval65.modelo);
    assert.match(String(POLITICA_NFE_55_CE.observacao), /Proibido aplicar automaticamente/);
  });

  it('D. NFC-e 65 sem procedimento comprovado => não permitir transmissão extemporânea', () => {
    assert.equal(POLITICA_NFCE_65_CE.cancelamento_extemporaneo_comprovado, false);
    assert.equal(POLITICA_NFCE_65_CE.cancelamento_extemporaneo_disponivel, false);
    const ev = avaliarCancelamentoExtemporaneo({ modelo: '65', dentroPrazoNormal: false });
    assert.equal(ev.pode_transmitir_extemporaneo, false);
    assert.equal(ev.cancelamento_extemporaneo_disponivel, false);
    assert.match(ev.motivo_bloqueio, /EXTEMPORANEO_NFCE_NAO_COMPROVADO/);
  });

  it('E. NFC-e 65 com procedimento oficialmente comprovado => AGUARDANDO_PROCEDIMENTO', () => {
    const ev = avaliarCancelamentoExtemporaneo({
      modelo: '65',
      dentroPrazoNormal: false,
      politicaOverride: {
        cancelamento_extemporaneo_comprovado: true,
        cancelamento_extemporaneo_disponivel: true,
        procedimento_extemporaneo: 'PAE hipotético (somente teste)',
        resultado_pesquisa: 'EXTEMPORANEO_COMPROVADO_TESTE'
      }
    });
    assert.equal(ev.cancelamento_status, CANCELAMENTO_STATUS.AGUARDANDO_PROCEDIMENTO);
    assert.equal(ev.cancelamento_extemporaneo_disponivel, true);
    assert.equal(ev.pode_transmitir_110111, false);
    assert.equal(ev.pode_transmitir_extemporaneo, false);
  });

  it('F. NFC-e 65 com autorização administrativa comprovada => estado específico sem TX automática', () => {
    const ev = avaliarCancelamentoExtemporaneo({
      modelo: '65',
      dentroPrazoNormal: false,
      autorizacaoAdministrativaComprovada: true,
      politicaOverride: {
        cancelamento_extemporaneo_comprovado: true,
        cancelamento_extemporaneo_disponivel: true,
        procedimento_extemporaneo: 'deferimento_teste',
        resultado_pesquisa: 'EXTEMPORANEO_COMPROVADO_TESTE'
      }
    });
    assert.equal(ev.cancelamento_status, CANCELAMENTO_STATUS.AUTORIZADO_ADMINISTRATIVO);
    assert.equal(ev.pode_transmitir_extemporaneo, false);
  });

  it('G. cStat 501 => permanece AUTORIZADA', async () => {
    const auth = '2026-09-13T18:28:02-03:00';
    await run(db, `UPDATE nfce_notas SET status='autorizada', xml_enviado=?, xml_retorno=? WHERE id=?`, [
      `<NFe><infNFe><ide><mod>65</mod></ide><dhEmi>${auth}</dhEmi></infNFe></NFe>`,
      `<ret><dhRecbto>${auth}</dhRecbto><cStat>100</cStat></ret>`,
      nfceId
    ]);
    await assert.rejects(
      () => cancelarDocumentoFiscalFechamento(db, nfceId, JUST, {
        deps: {
          cancelarNfcePorId: mockCancel('501'),
          ignorarPrazoLocal: true,
          skipSnapshot: true,
          agora: new Date('2026-09-13T18:29:00-03:00')
        }
      }),
      (err) => err.code === 'SEFAZ_PRAZO_501'
    );
    const nota = await get(db, 'SELECT status, venda_id FROM nfce_notas WHERE id=?', [nfceId]);
    assert.equal(nota.status, 'autorizada');
    assert.equal(nota.venda_id, null);
  });

  it('H. NFC-e FF sem venda => continua sem venda', async () => {
    const nota = await get(db, 'SELECT venda_id, origem FROM nfce_notas WHERE id=?', [nfceId]);
    assert.equal(nota.venda_id, null);
    assert.equal(nota.origem, ORIGEM_FECHAMENTO);
  });

  it('I. NFC-e FF cancelada => não cria venda', async () => {
    const vendasAntes = await get(db, 'SELECT COUNT(*) AS c FROM vendas');
    const auth = '2026-09-13T18:28:02-03:00';
    await run(db, `UPDATE nfce_notas SET status='autorizada', xml_enviado=?, xml_retorno=? WHERE id=?`, [
      `<NFe><infNFe><ide><mod>65</mod></ide><dhEmi>${auth}</dhEmi></infNFe></NFe>`,
      `<ret><dhRecbto>${auth}</dhRecbto><cStat>100</cStat></ret>`,
      nfceId
    ]);
    const r = await cancelarDocumentoFiscalFechamento(db, nfceId, JUST, {
      deps: {
        cancelarNfcePorId: mockCancel('135'),
        ignorarPrazoLocal: true,
        skipSnapshot: false,
        agora: new Date('2026-09-13T18:29:00-03:00')
      }
    });
    assert.equal(r.status, 'cancelada');
    assert.equal(r.venda_id, null);
    const vendasDepois = await get(db, 'SELECT COUNT(*) AS c FROM vendas');
    assert.equal(vendasDepois.c, vendasAntes.c);
    const nota = await get(db, 'SELECT venda_id, status FROM nfce_notas WHERE id=?', [nfceId]);
    assert.equal(nota.venda_id, null);
    assert.equal(nota.status, 'cancelada');
  });

  it('J. cancelamento duplicado => idempotente', async () => {
    const r = await cancelarDocumentoFiscalFechamento(db, nfceId, JUST, {
      deps: { cancelarNfcePorId: mockCancel('135'), skipSnapshot: true }
    });
    assert.equal(r.idempotente, true);
    assert.equal(r.status, 'cancelada');
  });

  it('K. duas solicitações simultâneas => lock 409', async () => {
    await run(db, `UPDATE nfce_notas SET status='autorizada' WHERE id=?`, [nfceId]);
    LOCKS.set(nfceId, Date.now());
    await assert.rejects(
      () => cancelarDocumentoFiscalFechamento(db, nfceId, JUST, {
        deps: { cancelarNfcePorId: mockCancel('135'), ignorarPrazoLocal: true, skipSnapshot: true }
      }),
      (err) => err.statusCode === 409 && err.code === 'CONCORRENCIA'
    );
    LOCKS.delete(nfceId);
  });

  it('UI e política: textos de fora do prazo / sem extemporâneo comprovado', () => {
    assert.match(FRONT, /Cancelamento fora do prazo/);
    assert.match(FRONT, /Não foi identificado procedimento de cancelamento extemporâneo/);
    assert.match(FRONT, /pode_transmitir_110111/);
    assert.equal(RESULTADO_PESQUISA, 'EXTEMPORANEO_NFCE_NAO_COMPROVADO');
    assert.equal(POLITICA_NFCE_65_CE.cancelamento_por_substituicao_110112.aplicavel_como_escape_de_prazo, false);
    assert.equal(POLITICA_NFCE_65_CE.cancelamento_por_substituicao_110112.implementado_no_cds, false);
  });

  it('Diagnóstico expandido: campos Sprint 08.5', () => {
    const auth = '2026-09-13T18:28:02-03:00';
    const agora = new Date('2026-09-13T19:20:00-03:00');
    const diag = montarDiagnosticoCancelamento(notaBase(auth), agora);
    assert.equal(diag.modelo, '65');
    assert.equal(diag.status_fiscal, 'autorizada');
    assert.equal(diag.cancelamento_status, 'FORA_DO_PRAZO');
    assert.equal(diag.cancelamento_extemporaneo_disponivel, false);
    assert.equal(diag.cancelamento_extemporaneo_comprovado, false);
    assert.equal(diag.procedimento_extemporaneo, null);
    assert.equal(diag.pode_transmitir_110111, false);
    assert.ok(diag.motivo_bloqueio);
    assert.equal(diag.resultado_pesquisa_extemporaneo, RESULTADO_PESQUISA);
    const prazo = calcularPrazoCancelamentoNfce(notaBase(auth), agora);
    assert.ok(prazo.minutos_decorridos > 30);
  });
});
