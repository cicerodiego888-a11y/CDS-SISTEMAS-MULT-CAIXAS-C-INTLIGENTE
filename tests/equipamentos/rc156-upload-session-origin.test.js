/**
 * RC15.6 — Auditoria da origem da sessão no Upload PLU
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');
const SessionOriginAudit = require('../../backend/motores/equipamentos/connection/SessionOriginAudit');
const sessionRegistry = require('../../backend/motores/equipamentos/connection/EquipmentSessionRegistry');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.6 — ConnectionPool resolve aliases eq↔hp', () => {
  it('get por equipamentoId encontra entry com primary hp', () => {
    const pool = new ConnectionPool();
    const entry = { host: '10.0.0.170', porta: 9000, equipamentoId: 1, fsm: { ativo: true } };
    pool.set('10.0.0.170', 9000, entry);
    assert.equal(pool.get({ equipamentoId: 1 }), entry);
    assert.equal(pool.get('10.0.0.170', 9000), entry);
  });

  it('get por host:porta encontra entry com primary eq', () => {
    const pool = new ConnectionPool();
    const entry = { host: '10.0.0.170', porta: 9000, equipamentoId: 7, fsm: { ativo: true } };
    pool.set({ equipamentoId: 7, host: '10.0.0.170', porta: 9000 }, entry);
    assert.equal(pool.get('10.0.0.170', 9000), entry);
    assert.equal(pool.get({ equipamentoId: 7 }), entry);
  });
});

describe('RC15.6 — SessionOriginAudit', () => {
  beforeEach(() => {
    SessionOriginAudit.limparParaTestes();
    sessionRegistry.clearForTests();
  });

  it('registra diagnóstico e upload sem divergência na mesma sessão', () => {
    const cm = require('../../backend/motores/equipamentos/connection/ConnectionManager');
    const session = sessionRegistry.getOrCreate({
      host: '10.0.0.170',
      porta: 9000,
      equipamentoId: 1
    });
    session.markConnected('REUSED_SESSION', 1, {
      host: '10.0.0.170',
      porta: 9000,
      equipamentoId: 1
    });
    session.setPersistent(true);

    // mock getSession/getConnection no singleton
    const origGetSession = cm.getSession.bind(cm);
    const origGetConnection = cm.getConnection.bind(cm);
    cm.getSession = () => session;
    cm.getConnection = () => ({
      _poolKey: 'eq:1',
      host: '10.0.0.170',
      porta: 9000,
      equipamentoId: 1,
      transport: { aberto: true },
      fsm: { estado: 'CONNECTED', ativo: true },
      session
    });

    try {
      const diag = SessionOriginAudit.registrarDiagnostico({
        equipamentoId: 1,
        host: '10.0.0.170',
        porta: 9000
      }, cm);
      assert.equal(diag.sessionKey, session._registryKey || 'hp:10.0.0.170:9000');
      assert.equal(diag.connected, true);

      const cmp = SessionOriginAudit.assertMesmaSessaoQueDiagnostico({
        equipamentoId: 1,
        host: '10.0.0.170',
        porta: 9000
      }, cm);
      assert.equal(cmp.ok, true);
      assert.equal(cmp.comparado, true);
    } finally {
      cm.getSession = origGetSession;
      cm.getConnection = origGetConnection;
    }
  });

  it('detecta Session Key divergente no mesmo alvo', () => {
    const sDiag = sessionRegistry.getOrCreate({
      host: '10.0.0.170', porta: 9000, equipamentoId: 1
    });
    sDiag._registryKey = 'eq:1';
    sDiag.markConnected('REUSED_SESSION', 1);

    const sUpload = {
      host: '10.0.0.170',
      porta: 9000,
      equipamentoId: 1,
      connected: true,
      state: 'CONNECTED',
      persistent: true,
      _registryKey: 'hp:OUTRA-SESSAO',
      snapshot() {
        return {
          connected: true,
          state: 'CONNECTED',
          persistent: true,
          host: this.host,
          porta: this.porta,
          equipamentoId: this.equipamentoId
        };
      }
    };

    let fase = 'diag';
    const fakeCm = {
      __rc156InstanceId: '0xTEST',
      getSession() {
        return fase === 'diag' ? sDiag : sUpload;
      },
      getConnection() {
        return {
          _poolKey: fase === 'diag' ? 'eq:1' : 'hp:OUTRA',
          host: '10.0.0.170',
          porta: 9000,
          equipamentoId: 1,
          transport: { aberto: true },
          fsm: { estado: 'CONNECTED', ativo: true }
        };
      }
    };

    SessionOriginAudit.registrarDiagnostico({
      equipamentoId: 1, host: '10.0.0.170', porta: 9000
    }, fakeCm);

    fase = 'upload';
    assert.throws(
      () => SessionOriginAudit.assertMesmaSessaoQueDiagnostico({
        equipamentoId: 1, host: '10.0.0.170', porta: 9000
      }, fakeCm),
      (err) => err.code === 'UPLOAD_USANDO_SESSAO_DIFERENTE'
    );
  });
});

describe('RC15.6 — integração código', () => {
  it('ToledoPluEngine e Diagnóstico usam SessionOriginAudit', () => {
    const eng = read('backend/motores/equipamentos/drivers/toledo/plu/ToledoPluEngine.js');
    assert.match(eng, /SessionOriginAudit/);
    assert.match(eng, /UPLOAD_USANDO_SESSAO_DIFERENTE/);
    assert.match(eng, /equipamentoId/);

    const diag = read('backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js');
    assert.match(diag, /SessionOriginAudit/);
    assert.match(diag, /sessionOrigin/);
    assert.match(diag, /equipamentoId/);

    const drv = read('backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js');
    assert.match(drv, /equipamentoId/);
  });
});
