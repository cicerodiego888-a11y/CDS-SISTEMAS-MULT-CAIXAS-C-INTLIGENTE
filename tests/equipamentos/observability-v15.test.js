/**
 * Sprint 15.8 — Observabilidade / Telemetria / Certificação
 * npm run test:observability
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const obs = require(path.join(root, 'backend/motores/equipamentos/observability'));

describe('Sprint 15.8 — Telemetria', () => {
  before(() => {
    obs.telemetry.limpar();
    obs.eventStream.limpar();
  });

  it('registra métricas com timestamp', async () => {
    const p = await obs.telemetry.latencia(120, {
      equipamentoId: 1,
      driverId: 'toledo-prix4',
      fabricante: 'Toledo',
      protocolo: '90AX',
      emitEvent: false
    });
    assert.equal(p.metrica, 'latencia');
    assert.equal(p.valor, 120);
    assert.ok(p.registradoEm);
    await obs.telemetry.heartbeat(1, { equipamentoId: 1, emitEvent: false });
    await obs.telemetry.sync(true, { equipamentoId: 1, emitEvent: false });
    await obs.telemetry.erro({ equipamentoId: 1, emitEvent: false });
    const snap = obs.telemetry.snapshot();
    assert.ok(snap.contadores.heartbeats >= 1);
    assert.ok(snap.recentes.length >= 1);
  });
});

describe('Sprint 15.8 — Métricas', () => {
  it('agrega por driver e fabricante', async () => {
    await obs.telemetry.latencia(80, {
      driverId: 'toledo-prix4',
      fabricante: 'Toledo',
      protocolo: '90AX',
      loja: 'LJ01',
      emitEvent: false
    });
    const m = obs.metrics.agregar({ limite: 500 });
    assert.ok(m.porDriver.length >= 1);
    assert.ok(m.porFabricante.some((g) => g.chave === 'Toledo'));
    assert.ok(m.periodo.pontos >= 1);
  });
});

describe('Sprint 15.8 — Eventos', () => {
  it('empilha eventos no stream', async () => {
    const e = await obs.eventStream.push({
      tipo: 'test.event',
      mensagem: 'hello',
      equipamentoId: 9
    });
    assert.ok(e.id);
    assert.ok(e.registradoEm);
    const lista = obs.eventStream.listar({ limite: 10, tipo: 'test.event' });
    assert.ok(lista.some((x) => x.id === e.id));
  });
});

describe('Sprint 15.8 — Alertas', () => {
  it('gera alerta de latência e offline', async () => {
    const gerados = await obs.alertEngine.avaliar({
      equipamentoId: 42,
      driverId: 'toledo-prix4',
      online: false,
      latenciaMs: 5000
    });
    assert.ok(gerados.length >= 1);
    const lista = await obs.alertEngine.listar({ ativos: true, limite: 50 });
    assert.ok(lista.some((a) => a.codigo === 'EQUIPAMENTO_OFFLINE' || a.codigo === 'LATENCIA_ALTA'));
  });
});

describe('Sprint 15.8 — Performance', () => {
  it('calcula estatísticas e disponibilidade', async () => {
    for (let i = 0; i < 5; i += 1) {
      await obs.telemetry.latencia(100 + i * 10, { emitEvent: false });
      await obs.telemetry.heartbeat(1, { emitEvent: false });
    }
    const p = obs.performance.analisar({ limite: 200 });
    assert.ok(p.latencia.count >= 5);
    assert.ok(p.latencia.media != null);
    assert.ok(p.latencia.p95 != null);
    assert.ok(p.disponibilidade != null);
  });
});

describe('Sprint 15.8 — Certificação', () => {
  it('executa suíte e gera relatório JSON/MD/PDF', async () => {
    // garante SDK
    const sdk = require(path.join(root, 'backend/motores/equipamentos/sdk'));
    sdk.ensureLoaded();

    const out = await obs.audit.certificar({
      driverId: 'toledo-prix4',
      executadoPor: 'test',
      firmware: '90AX'
    });
    assert.ok(out.resultado);
    assert.ok(out.resultado.nota >= 0);
    assert.ok(Array.isArray(out.resultado.checklist));
    assert.ok(out.relatorio.json);
    assert.match(out.relatorio.markdown, /Certificação/);
    assert.ok(out.relatorio.pdf?.base64);
    assert.equal(out.resultado.checklist.length, 10);
  });
});

describe('Sprint 15.8 — Wiring', () => {
  it('rotas e scripts registrados', () => {
    const rotas = fs.readFileSync(path.join(root, 'backend/rotas/equipamentos.js'), 'utf8');
    assert.match(rotas, /ObservabilityRoutes/);
    assert.match(rotas, /\/telemetry|certification/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['test:observability']);
  });

  it('módulo exporta API pública', () => {
    assert.ok(obs.telemetry);
    assert.ok(obs.metrics);
    assert.ok(obs.alertEngine);
    assert.ok(obs.performance);
    assert.ok(obs.certificationSuite);
    assert.ok(obs.ObservabilityRoutes);
  });
});
