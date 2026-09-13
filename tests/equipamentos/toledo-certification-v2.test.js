/**
 * Sprint 14.12 — Testes Certificação e Homologação V2.0
 * Sem novas funcionalidades de negócio — auditoria, estabilidade simulada, checklist.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { getVersion } = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoVersion');
const { auditArchitecture } = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ArchitectureAuditor');
const { avaliarChecklist, CHECKLIST } = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/HomologacaoChecklist');
const {
  health,
  diagnostics,
  recordLatency,
  recordError,
  resetStatsForTests,
  performanceReport
} = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics');
const { buildCertificationReport } = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/CertificationReport');
const DiagnosticsController = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/DiagnosticsController');
const { getCapabilities } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoCapabilities');
const { ToledoOperationEngine } = require('../../backend/motores/equipamentos/drivers/toledo/operations/ToledoOperationEngine');
const OperationResult = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationResult');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');

describe('Certificação V2 — Versão / API', () => {
  it('expõe versão e controller', () => {
    const v = getVersion();
    assert.equal(v.homologacao, '14.12-V2.0');
    assert.ok(v.driverVersion);
    assert.ok(v.protocolVersion);
    assert.equal(typeof DiagnosticsController.health, 'function');
    assert.equal(typeof DiagnosticsController.diagnostics, 'function');
    assert.equal(typeof DiagnosticsController.version, 'function');
  });
});

describe('Certificação V2 — Auditoria Arquitetural', () => {
  it('todos os módulos 14.x presentes e sem net direto', () => {
    const r = auditArchitecture();
    assert.equal(r.success, true, JSON.stringify(r.resultados.filter((x) => x.status !== 'OK')));
    assert.equal(r.fail, 0);
    assert.equal(r.total, 11);
  });
});

describe('Certificação V2 — Health / Diagnostics / Checklist', () => {
  before(() => resetStatsForTests());

  it('health e diagnostics', async () => {
    recordLatency('ping', 2);
    recordLatency('handshake', 5);
    recordLatency('upload', 12);
    recordLatency('download', 20);
    recordLatency('peso', 8);
    recordLatency('config', 15);
    const h = health({});
    assert.equal(h.success, true);
    assert.ok(h.status === 'OK' || h.status === 'DEGRADED');
    const d = await diagnostics({});
    assert.equal(d.success, true);
    assert.ok(d.version);
    assert.ok(d.capabilities.handshake);
    assert.ok(d.capabilities.readWeight);
    assert.ok(d.arquitetura.success);
    assert.equal(d.checklist.homologado, true);
    const perf = performanceReport();
    assert.equal(perf.pingMs, 2);
  });

  it('checklist completo', () => {
    const ev = Object.fromEntries(CHECKLIST.map((c) => [c.id, true]));
    const r = avaliarChecklist(ev);
    assert.equal(r.homologado, true);
    assert.equal(r.resumo.ok, CHECKLIST.length);
  });

  it('relatório consolidado', async () => {
    const report = await buildCertificationReport({});
    assert.ok(report.titulo.includes('Homologação'));
    assert.equal(report.resumo.arquiteturaOk, true);
    assert.equal(report.resumo.homologado, true);
  });
});

describe('Certificação V2 — Estabilidade / Recuperação / Volume (simulado)', () => {
  it('operações repetidas sem crescimento de drivers no engine', async () => {
    const drivers = new Map();
    const engine = new ToledoOperationEngine({
      persistir: false,
      drivers,
      driverFactory: (host, porta) => ({
        host,
        porta,
        isOnline() { return true; },
        async connect() { return { status: 'CONNECTED' }; },
        async ping() {
          return { ok: true, frame: { raw: frameBuilder.buildAck(), isAck: true } };
        },
        async handshake() {
          return { ok: true, latencia: 1, frame: { raw: frameBuilder.buildAck() } };
        }
      })
    });

    for (let i = 0; i < 50; i += 1) {
      const r = await engine.ping({ host: '10.0.0.170', porta: 9000, persistir: false });
      assert.equal(r.success, true);
    }
    assert.equal(drivers.size, 1, 'não deve criar múltiplos drivers por host:porta');
  });

  it('timeout / falha de conexão não corrompe estado', async () => {
    resetStatsForTests();
    const engine = new ToledoOperationEngine({
      persistir: false,
      driverFactory: () => ({
        isOnline() { return true; },
        async connect() { return { status: 'CONNECTED' }; },
        async ping() {
          const err = new Error('TIMEOUT');
          err.code = 'TIMEOUT';
          throw err;
        }
      })
    });
    const r = await engine.ping({ host: '10.0.0.171', porta: 9000, persistir: false, timeout: 100 });
    assert.equal(r.success, false);
    recordError({ code: 'TIMEOUT', message: 'cabo removido / timeout' });
    const h = health({});
    assert.equal(h.erros, 1);
    assert.ok(h.ultimoErro);

    // recuperação: ping OK
    const engine2 = new ToledoOperationEngine({
      persistir: false,
      driverFactory: () => ({
        isOnline() { return true; },
        async connect() { return { status: 'CONNECTED' }; },
        async ping() {
          return { ok: true, frame: { raw: frameBuilder.buildAck(), isAck: true } };
        }
      })
    });
    const ok = await engine2.ping({ host: '10.0.0.171', porta: 9000, persistir: false });
    assert.equal(ok.success, true);
  });

  it('volume: 1000 itens de plano sync em memória', () => {
    const comparator = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncComparator');
    const planner = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner');
    const cds = [];
    const bal = [];
    for (let i = 1; i <= 1000; i += 1) {
      cds.push({ plu: String(i), descricao: `P${i}`, preco: i });
      if (i % 2 === 0) bal.push({ plu: String(i), descricao: `P${i}`, preco: i });
      else bal.push({ plu: String(i), descricao: `Old${i}`, preco: i - 1 });
    }
    const cmp = comparator.compare(cds, bal);
    const plano = planner.plan(cmp);
    assert.equal(cmp.length, 1000);
    assert.ok(plano.resumo.total === 1000);
    assert.ok(plano.resumo.alterados + plano.resumo.iguais === 1000);
  });

  it('cancelamento de operação', () => {
    const ToledoOperation = require('../../backend/motores/equipamentos/drivers/toledo/operations/ToledoOperation');
    const op = new ToledoOperation({ operation: 'PING', timeout: 1000 });
    op.cancel();
    assert.equal(op.cancelled, true);
    assert.equal(op.status, 'CANCELLED');
  });
});

describe('Certificação V2 — Documentação e capabilities', () => {
  it('capabilities homologadas e doc presente', () => {
    const caps = getCapabilities().capabilities;
    assert.equal(caps.handshake, true);
    assert.equal(caps.ping, true);
    assert.equal(caps.uploadPLU, true);
    assert.equal(caps.downloadPLU, true);
    assert.equal(caps.syncPLU, true);
    assert.equal(caps.readWeight, true);
    assert.equal(caps.monitor, true);
    assert.equal(caps.downloadConfig, true);
    assert.equal(caps.writeConfig, true);
    assert.equal(caps.writeLabel, false);
    assert.equal(caps.firmwareUpdate, false);
    assert.equal(caps.autoReconnect, false);

    const doc = path.resolve(
      __dirname,
      '../../docs/equipamentos/toledo-prix-iv-uno-homologacao-v2.md'
    );
    assert.ok(fs.existsSync(doc), 'documentação de homologação deve existir');
    const docTxt = fs.readFileSync(doc, 'utf8');
    assert.match(docTxt, /Capabilities homologadas/);
    assert.match(docTxt, /`uploadPLU`/);
    assert.match(docTxt, /`readWeight`/);
  });
});
