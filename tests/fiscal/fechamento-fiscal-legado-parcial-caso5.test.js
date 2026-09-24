/**
 * Sprint — Correção fechamento fiscal legado/parcial
 * Caso real: Fechamento ID 5 — 22/09/2026 — R$ 687,76
 * NFC-e 13 AUTORIZADA 249,99 | 14/15 REJEITADAS 539 (249,97 / 187,80)
 * Pendente = 437,77
 *
 * Executar: node --test tests/fiscal/fechamento-fiscal-legado-parcial-caso5.test.js
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  recalcularSaldoFechamento,
  sincronizarSaldoAoAbrir,
  continuarEmissaoFechamento,
  bloquearEmissaoIntegralSeParcial,
  statusOperacionalDoSaldo,
  obterBaseNovaEmissao
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalSaldoService');
const { DOC_STATUS, STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const { garantirSchemaFechamentoFiscal } = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');
const { toCentavos } = require('../../backend/services/fiscal/modeloTotais');

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

describe('Caso real — Fechamento #5 legado parcial (687.76 / 249.99 / 437.77)', () => {
  let db;
  let ffId;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-caso5-'));
    db = await openDb(path.join(dir, 't.db'));
    await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
    await run(db, `INSERT INTO configuracoes VALUES ('fechamento_fiscal_do_dia','ATIVADO')`);
    await run(db, `INSERT INTO configuracoes VALUES ('cnpj','12345678000199')`);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
    });
    for (const sql of [
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_principal REAL`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_emitido_autorizado REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_pendente_emissao REAL NOT NULL DEFAULT 0`
    ]) {
      try { await run(db, sql); } catch (_) { /* already */ }
    }

    const ins = await run(
      db,
      `INSERT INTO fechamentos_fiscais (
        data_fechamento, cnpj, valor_informado, valor_distribuido, status, valor_principal
      ) VALUES ('2026-09-22','12345678000199',687.76,687.76,'REJEITADO',687.76)`
    );
    ffId = ins.lastID;

    // NFC-e 13 AUTORIZADA
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 1, DOC_STATUS.AUTORIZADO, 249.99, '100', 'PROT13',
        '23260912345678000199650010000000131123456789', 13
      ]
    );
    // NFC-e 14 REJEITADA 539
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, numero)
       VALUES (?,?,?,?,?,?)`,
      [ffId, 2, DOC_STATUS.REJEITADO, 249.97, '539', 14]
    );
    // NFC-e 15 REJEITADA 539
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, numero)
       VALUES (?,?,?,?,?,?)`,
      [ffId, 3, DOC_STATUS.REJEITADO, 187.80, '539', 15]
    );
  });

  it('1) abrir fechamento recalcula saldo (RECUPERACAO)', async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); };
    try {
      const sync = await sincronizarSaldoAoAbrir(db, ffId);
      assert.equal(toCentavos(sync.valor_principal), 68776);
      assert.equal(toCentavos(sync.valor_emitido_autorizado), 24999);
      assert.equal(toCentavos(sync.valor_pendente_emissao), 43777);
      assert.equal(sync.status, STATUS.AUTORIZACAO_PARCIAL);
      assert.ok(
        logs.some((l) =>
          /\[FECHAMENTO_FISCAL\]\[SALDO\]\[RECUPERACAO\]/.test(l)
          && /fechamentoId=/.test(l)
          && /principal=687\.76/.test(l)
          && /autorizado=249\.99/.test(l)
          && /pendente=437\.77/.test(l)
          && /status=AUTORIZACAO_PARCIAL/.test(l)
        ),
        `log RECUPERACAO ausente: ${logs.join(' | ')}`
      );
    } finally {
      console.log = orig;
    }
  });

  it('2) status operacional = AUTORIZACAO_PARCIAL (não esconde atrás de REJEITADO)', async () => {
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(statusOperacionalDoSaldo(s, STATUS.REJEITADO), STATUS.AUTORIZACAO_PARCIAL);
    const row = await get(db, `SELECT status FROM fechamentos_fiscais WHERE id=?`, [ffId]);
    assert.equal(row.status, STATUS.AUTORIZACAO_PARCIAL);
  });

  it('3) rejeição não reduz saldo autorizado', async () => {
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 24999);
    assert.equal(toCentavos(s.valor_pendente_emissao), 43777);
  });

  it('4) rota antiga bloqueada com FECHAMENTO_AUTORIZACAO_PARCIAL', () => {
    const saldo = {
      valor_principal: 687.76,
      valor_emitido_autorizado: 249.99,
      valor_pendente_emissao: 437.77
    };
    const err = bloquearEmissaoIntegralSeParcial(saldo, {});
    assert.ok(err);
    assert.equal(err.code, 'FECHAMENTO_AUTORIZACAO_PARCIAL');
    assert.equal(toCentavos(err.valor_principal), 68776);
    assert.equal(toCentavos(err.valor_emitido_autorizado), 24999);
    assert.equal(toCentavos(err.valor_pendente_emissao), 43777);
    assert.equal(bloquearEmissaoIntegralSeParcial(saldo, { continuar_emissao: true }), null);
  });

  it('5) CONTINUAR prepara somente 437.77 + log CONTINUAR', async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); };
    try {
      const base = await continuarEmissaoFechamento(ffId, { db });
      assert.equal(toCentavos(base.valor_base_continuacao), 43777);
      assert.equal(toCentavos(base.saldo.valor_pendente_emissao), 43777);
      assert.notEqual(toCentavos(base.valor_base_continuacao), 68776);
      assert.ok(
        logs.some((l) =>
          /\[FECHAMENTO_FISCAL\]\[CONTINUAR\]/.test(l)
          && /valor=437\.77/.test(l)
        ),
        `log CONTINUAR ausente: ${logs.join(' | ')}`
      );
    } finally {
      console.log = orig;
    }
  });

  it('6) nova autorização reduz saldo', async () => {
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 4, DOC_STATUS.AUTORIZADO, 100.00, '100', 'PROT100',
        '23260912345678000199650010000001001123456789', 100
      ]
    );
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 34999);
    assert.equal(toCentavos(s.valor_pendente_emissao), 33777);
    const base = await obterBaseNovaEmissao(db, ffId);
    assert.equal(toCentavos(base.valor_nova_tentativa), 33777);
  });

  it('7) pendente zero → AUTORIZADO / concluído', async () => {
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 5, DOC_STATUS.AUTORIZADO, 337.77, '100', 'PROT337',
        '23260912345678000199650010000003371123456789', 337
      ]
    );
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_pendente_emissao), 0);
    assert.equal(s.concluido, true);
    assert.equal(statusOperacionalDoSaldo(s, STATUS.AUTORIZACAO_PARCIAL), STATUS.AUTORIZADO);
  });

  it('8) UI não trata parcial como Emitir fechamento; tem Continuar', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'),
      'utf8'
    );
    assert.match(ui, /ffdEhAutorizacaoParcial/);
    assert.match(ui, /Continuar emissão/);
    assert.match(ui, /VALOR PRINCIPAL/);
    assert.match(ui, /ffdBtnEmitir.*d-none|addClass\('d-none'\)/);
    assert.match(ui, /continuar-emissao/);
    assert.ok(!/AUTORIZACAO_PARCIAL.*CONCLUIDO/.test(
      ui.slice(ui.indexOf('function ffdFechamentoFinalizado'), ui.indexOf('function ffdFechamentoFinalizado') + 400)
    ) || !ui.includes("st === 'AUTORIZACAO_PARCIAL'")
      || !/function ffdFechamentoFinalizado[\s\S]{0,350}AUTORIZACAO_PARCIAL/.test(ui));
    // Parcial não deve ser "finalizado"
    const finalizadoFn = ui.slice(
      ui.indexOf('function ffdFechamentoFinalizado'),
      ui.indexOf('function ffdEhAutorizacaoParcial')
    );
    assert.ok(
      !finalizadoFn.includes("AUTORIZACAO_PARCIAL"),
      'AUTORIZACAO_PARCIAL não pode estar em ffdFechamentoFinalizado'
    );
  });

  it('9) backend/preparar e transmitir referenciam FECHAMENTO_AUTORIZACAO_PARCIAL', () => {
    const prep = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService.js'),
      'utf8'
    );
    const tx = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'),
      'utf8'
    );
    const svc = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalService.js'),
      'utf8'
    );
    assert.match(prep, /bloquearEmissaoIntegralSeParcial|FECHAMENTO_AUTORIZACAO_PARCIAL|continuar_emissao/);
    assert.match(tx, /bloquearEmissaoIntegralSeParcial|FECHAMENTO_AUTORIZACAO_PARCIAL/);
    assert.match(svc, /sincronizarSaldoAoAbrir/);
    assert.match(svc, /continuar_emissao:\s*true/);
  });
});
