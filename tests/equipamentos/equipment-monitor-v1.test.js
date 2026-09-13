/**
 * Sprint 14.10 — Testes Monitor de Equipamentos V1.0
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const MonitorScheduler = require('../../backend/motores/equipamentos/monitor/MonitorScheduler');
const MonitorSession = require('../../backend/motores/equipamentos/monitor/MonitorSession');
const { SESSION_STATUS } = require('../../backend/motores/equipamentos/monitor/MonitorSession');
const MonitorRepository = require('../../backend/motores/equipamentos/monitor/MonitorRepository');
const { MonitorEvents, EVENTS } = require('../../backend/motores/equipamentos/monitor/MonitorEvents');
const { EquipmentMonitor } = require('../../backend/motores/equipamentos/monitor/EquipmentMonitor');
const MonitorController = require('../../backend/motores/equipamentos/monitor/MonitorController');
const MonitorRoutes = require('../../backend/motores/equipamentos/monitor/MonitorRoutes');
const OperationResult = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationResult');

function mockOpEngine(ok = true, duration = 2) {
  return {
    async ping() {
      if (!ok) {
        return new OperationResult({
          success: false,
          operation: 'PING',
          duration,
          error: 'TIMEOUT'
        });
      }
      return new OperationResult({
        success: true,
        operation: 'PING',
        duration,
        data: { ok: true, ping: true }
      });
    }
  };
}

describe('Monitor V1 — Session', () => {
  it('cria sessão com campos oficiais', () => {
    const s = new MonitorSession({
      host: '10.0.0.170',
      porta: 9000,
      equipamento_id: 5,
      intervalMs: 3000
    });
    assert.ok(s.id);
    assert.equal(s.equipamento.host, '10.0.0.170');
    assert.equal(s.equipamento.porta, 9000);
    assert.equal(s.status, SESSION_STATUS.IDLE);
    assert.equal(s.config.intervalMs, 3000);
    const snap = s.snapshot();
    assert.equal(snap.heartbeat, 'UNKNOWN');
  });
});

describe('Monitor V1 — Scheduler', () => {
  it('executa ticks e pausa/retoma', async () => {
    let ticks = 0;
    const sch = new MonitorScheduler({ intervalMs: 40, timeoutMs: 20 });
    sch.start({
      immediate: true,
      onTick: async () => { ticks += 1; }
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(ticks >= 1);
    sch.pause();
    const before = ticks;
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(ticks, before);
    sch.resume();
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(ticks > before);
    sch.stop();
  });
});

describe('Monitor V1 — Events', () => {
  it('emite sequência de eventos', () => {
    const bus = new MonitorEvents();
    const seen = [];
    Object.values(EVENTS).forEach((ev) => bus.on(ev, () => seen.push(ev)));
    bus.emitStarted({});
    bus.emitHeartbeatOk({ latencia: 2 });
    bus.emitOnline({});
    bus.emitHeartbeatTimeout({});
    bus.emitOffline({});
    bus.emitStopped({});
    assert.ok(seen.includes(EVENTS.MONITOR_STARTED));
    assert.ok(seen.includes(EVENTS.HEARTBEAT_OK));
    assert.ok(seen.includes(EVENTS.DEVICE_ONLINE));
    assert.ok(seen.includes(EVENTS.HEARTBEAT_TIMEOUT));
    assert.ok(seen.includes(EVENTS.DEVICE_OFFLINE));
    assert.ok(seen.includes(EVENTS.MONITOR_STOPPED));
  });
});

describe('Monitor V1 — Repository', () => {
  it('persiste histórico e config', async () => {
    const repo = new MonitorRepository();
    const id = await repo.registrar({
      equipamento_id: 99,
      status: 'ONLINE',
      heartbeat: 'OK',
      latencia: 2,
      evento: EVENTS.HEARTBEAT_OK,
      host: '10.0.0.170',
      porta: 9000,
      session_id: 'abc'
    });
    assert.ok(id);
    const hist = await repo.historico({ limite: 5, host: '10.0.0.170' });
    assert.ok(hist.some((h) => h.id === id));
  });
});

describe('Monitor V1 — EquipmentMonitor / Heartbeat / Timeout / API', () => {
  /** @type {EquipmentMonitor} */
  let monitor;

  beforeEach(() => {
    monitor = new EquipmentMonitor({
      operationEngine: mockOpEngine(true, 2),
      repository: {
        async registrar() { return 1; },
        async obterConfig() {
          return { monitorEnabled: true, monitorIntervalMs: 5000, heartbeatTimeoutMs: 2000 };
        },
        async salvarConfig() { return {}; },
        async historico() {
          return [{ id: 1, evento: EVENTS.HEARTBEAT_OK, heartbeat: 'OK' }];
        }
      }
    });
  });

  afterEach(async () => {
    await monitor.stop();
  });

  it('start / heartbeat / status / stop', async () => {
    const events = [];
    monitor.on(EVENTS.MONITOR_STARTED, () => events.push('STARTED'));
    monitor.on(EVENTS.HEARTBEAT_OK, () => events.push('HB_OK'));
    monitor.on(EVENTS.DEVICE_ONLINE, () => events.push('ONLINE'));
    monitor.on(EVENTS.MONITOR_STOPPED, () => events.push('STOPPED'));

    const started = await monitor.start({
      host: '10.0.0.170',
      porta: 9000,
      intervalMs: 60000,
      immediate: false,
      persistir: false
    });
    assert.equal(started.success, true);
    assert.equal(monitor.status().active, true);

    const hb = await monitor.checkHeartbeat({ persistir: false });
    assert.equal(hb.success, true);
    assert.equal(hb.heartbeat, 'OK');
    assert.equal(hb.latencia, 2);

    const hist = await monitor.history({ limite: 10 });
    assert.equal(hist[0].heartbeat, 'OK');

    await monitor.stop();
    assert.equal(monitor.status().active, false);
    assert.ok(events.includes('STARTED'));
    assert.ok(events.includes('HB_OK'));
    assert.ok(events.includes('ONLINE'));
    assert.ok(events.includes('STOPPED'));
  });

  it('timeout / offline no heartbeat', async () => {
    monitor = new EquipmentMonitor({
      operationEngine: mockOpEngine(false, 5),
      repository: {
        async registrar() { return 1; },
        async obterConfig() {
          return { monitorEnabled: true, monitorIntervalMs: 5000, heartbeatTimeoutMs: 100 };
        },
        async historico() { return []; }
      }
    });
    await monitor.start({
      host: '10.0.0.170',
      porta: 9000,
      immediate: false,
      persistir: false
    });
    // força estado online prévio
    monitor.session.online = true;
    const r = await monitor.checkHeartbeat({ persistir: false });
    assert.equal(r.success, false);
    assert.equal(r.online, false);
    await monitor.stop();
  });

  it('pause e resume', async () => {
    await monitor.start({
      host: '10.0.0.170',
      porta: 9000,
      intervalMs: 60000,
      immediate: false,
      persistir: false
    });
    const p = await monitor.pause();
    assert.equal(p.paused, true);
    const skipped = await monitor.checkHeartbeat({ persistir: false });
    assert.equal(skipped.skipped, true);
    const r = await monitor.resume();
    assert.equal(r.resumed, true);
  });

  it('controller e routes exportados', () => {
    assert.equal(typeof MonitorController.start, 'function');
    assert.equal(typeof MonitorController.stop, 'function');
    assert.equal(typeof MonitorController.status, 'function');
    assert.equal(typeof MonitorController.history, 'function');
    const router = MonitorRoutes();
    assert.ok(router);
  });
});
