/**
 * Sprint 14.5 — Testes Engineering Lab V2.0
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const CaptureSession = require('../../backend/motores/equipamentos/laboratorio/CaptureSession');
const FrameCapture = require('../../backend/motores/equipamentos/laboratorio/FrameCapture');
const FrameAnalyzer = require('../../backend/motores/equipamentos/laboratorio/FrameAnalyzer');
const FrameExporter = require('../../backend/motores/equipamentos/laboratorio/FrameExporter');
const FrameRepository = require('../../backend/motores/equipamentos/laboratorio/FrameRepository');
const { EngineeringLab } = require('../../backend/motores/equipamentos/laboratorio/EngineeringLab');
const CaptureRoutes = require('../../backend/motores/equipamentos/laboratorio/CaptureRoutes');

describe('Lab V2 — CaptureSession', () => {
  it('conta TX/RX e uptime', () => {
    CaptureSession._resetSeq(0);
    const s = new CaptureSession({ driver: 'TOLEDO_PRIX4' });
    s.registrar('TX');
    s.registrar('RX');
    s.registrar('TX');
    assert.equal(s.totalFrames, 3);
    assert.equal(s.totalTX, 2);
    assert.equal(s.totalRX, 1);
    assert.match(s.uptime, /^\d{2}:\d{2}:\d{2}$/);
    s.pause();
    assert.equal(s.status, 'PAUSED');
    s.resume();
    assert.equal(s.status, 'RECORDING');
    s.stop();
    assert.equal(s.status, 'STOPPED');
    assert.ok(s.finalizadoEm);
  });
});

describe('Lab V2 — FrameCapture', () => {
  it('captura fiel TX/RX sem alterar bytes', () => {
    const original = Buffer.from([0x02, 0x48, 0x53, 0x03]);
    const copia = Buffer.from(original);
    const reg = FrameCapture.capturar('TX', original, {
      host: '10.0.0.170',
      porta: 9000,
      sessionId: '00001'
    });
    assert.equal(reg.direction, 'TX');
    assert.equal(reg.tamanho, 4);
    assert.equal(reg.frame_hex, original.toString('hex'));
    assert.deepEqual([...original], [...copia]);
    assert.ok(reg.checksum);
    assert.ok(reg.frame_ascii);
  });
});

describe('Lab V2 — FrameAnalyzer', () => {
  it('análise estrutural sem protocolo', () => {
    const buf = Buffer.from('ABC');
    const a = FrameAnalyzer.analyze(buf);
    assert.equal(a.valido, true);
    assert.equal(a.tamanho, 3);
    assert.equal(a.hexadecimal, '414243');
    assert.equal(a.ascii, 'ABC');
    assert.ok(a.checksum);
  });
});

describe('Lab V2 — FrameExporter', () => {
  it('exporta JSON e TXT', () => {
    const session = { id: '00001', driver: 'TOLEDO_PRIX4', totalFrames: 1 };
    const frames = [{
      timestamp: '2026-01-01T00:00:00.000Z',
      direction: 'TX',
      size: 2,
      checksum: 'AB',
      frame_hex: '0203',
      frame_ascii: '..'
    }];
    const json = FrameExporter.exportJson(session, frames);
    assert.ok(json.includes('"format": "JSON"') || json.includes('"format":"JSON"'));
    assert.ok(json.includes('0203'));
    const txt = FrameExporter.exportTxt(session, frames);
    assert.ok(txt.includes('HEX 0203'));
    assert.ok(txt.includes('ASC ..'));
    const pcap = FrameExporter.exportPcapStub(session, frames);
    assert.equal(pcap.supported, false);
  });
});

describe('Lab V2 — FrameRepository', () => {
  it('persiste captura e frames', async () => {
    const repo = new FrameRepository();
    const id = `t${Date.now().toString(36)}`;
    await repo.salvarSessao({
      id,
      iniciadoEm: new Date().toISOString(),
      equipamento: '10.0.0.1:9000',
      driver: 'TOLEDO_PRIX4',
      totalFrames: 1,
      status: 'STOPPED',
      host: '10.0.0.1',
      porta: 9000,
      totalTX: 1,
      totalRX: 0
    });
    await repo.salvarFrame({
      sessionId: id,
      timestamp: new Date().toISOString(),
      direction: 'TX',
      host: '10.0.0.1',
      porta: 9000,
      frame_hex: '0203',
      frame_ascii: '..',
      checksum: '01',
      tamanho: 2
    });
    const s = await repo.buscarSessao(id);
    assert.ok(s);
    assert.equal(s.driver, 'TOLEDO_PRIX4');
    const frames = await repo.listarFrames(id);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].frame_hex, '0203');
  });
});

describe('Lab V2 — EngineeringLab', () => {
  let lab;

  beforeEach(() => {
    CaptureSession._resetSeq(10);
    lab = new EngineeringLab({
      repository: {
        async salvarSessao() { return null; },
        async salvarFrame() { return 1; },
        async buscarSessao() { return null; },
        async listarFrames() { return []; }
      }
    });
  });

  it('start/stop/pause/resume/status', async () => {
    const s = await lab.start({
      host: '10.0.0.170',
      porta: 9000,
      driver: 'TOLEDO_PRIX4',
      persistir: false
    });
    assert.ok(s.id);
    assert.equal(lab.status().gravando, true);
    lab.pause();
    assert.equal(lab.status().session.status, 'PAUSED');
    lab.resume();
    assert.equal(lab.status().gravando, true);
    const stopped = await lab.stop();
    assert.equal(stopped.status, 'STOPPED');
  });

  it('observa TX/RX com integridade dos frames', async () => {
    await lab.start({ driver: 'TOLEDO_PRIX4', persistir: false });
    const tx = Buffer.from([0x02, 0x48, 0x53, 0x1c, 0x03]);
    const rx = Buffer.from([0x02, 0x41, 0x4b, 0x1c, 0x03]);
    const txHex = tx.toString('hex');
    const rxHex = rx.toString('hex');

    await lab.observeTx(tx, { host: '10.0.0.170', porta: 9000 });
    await lab.observeRx(rx, { host: '10.0.0.170', porta: 9000 });

    assert.equal(tx.toString('hex'), txHex);
    assert.equal(rx.toString('hex'), rxHex);

    const data = await lab.getSession(lab.session.id);
    assert.equal(data.frames.length, 2);
    assert.equal(data.frames[0].direction, 'TX');
    assert.equal(data.frames[1].direction, 'RX');
    assert.equal(data.frames[0].frame_hex, txHex);
    assert.equal(data.frames[1].frame_hex, rxHex);
    assert.equal(data.session.totalTX, 1);
    assert.equal(data.session.totalRX, 1);
  });

  it('exporta JSON e TXT da sessão', async () => {
    await lab.start({ driver: 'TOLEDO_PRIX4', persistir: false });
    await lab.observeTx(Buffer.from([0x01, 0x02]), {});
    await lab.stop();
    const json = await lab.export(lab.session.id, 'JSON');
    assert.equal(json.format, 'JSON');
    assert.ok(json.body.includes('0102'));
    const txt = await lab.export(lab.session.id, 'TXT');
    assert.equal(txt.format, 'TXT');
    assert.ok(txt.body.includes('HEX 0102'));
  });
});

describe('Lab V2 — API', () => {
  it('rotas start/stop/session/export', async () => {
    const { EngineeringLab: Lab } = require('../../backend/motores/equipamentos/laboratorio/EngineeringLab');
    const CaptureController = require('../../backend/motores/equipamentos/laboratorio/CaptureController');

    // Usa lab isolado injetando no controller via monkey-patch do módulo singleton é complexo;
    // valida router + fluxo HTTP com lab real em memória (persistir false via body).
    CaptureSession._resetSeq(100);
    const app = express();
    app.use(express.json());
    app.use('/api/equipamentos', CaptureRoutes());

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      const start = await fetch(`${base}/api/equipamentos/lab/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '10.0.0.170',
          porta: 9000,
          driver: 'TOLEDO_PRIX4',
          persistir: false
        })
      });
      assert.equal(start.status, 200);
      const startBody = await start.json();
      assert.ok(startBody.session.id);

      // Injeta frame via singleton engineeringLab
      const engineeringLab = require('../../backend/motores/equipamentos/laboratorio/EngineeringLab');
      await engineeringLab.observeTx(Buffer.from([0xaa, 0xbb]), { host: '10.0.0.170', porta: 9000 });

      const sess = await fetch(`${base}/api/equipamentos/lab/session/${startBody.session.id}`);
      assert.equal(sess.status, 200);
      const sessBody = await sess.json();
      assert.ok(sessBody.frames.length >= 1);
      assert.equal(sessBody.frames[0].frame_hex, 'aabb');

      const exp = await fetch(`${base}/api/equipamentos/lab/export/${startBody.session.id}?format=JSON`);
      assert.equal(exp.status, 200);
      const expText = await exp.text();
      assert.ok(expText.includes('aabb'));

      const stop = await fetch(`${base}/api/equipamentos/lab/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      assert.equal(stop.status, 200);
    } finally {
      await new Promise((r) => {
        server.close(() => r());
        setTimeout(r, 300);
      });
    }

    assert.equal(typeof CaptureController.start, 'function');
    assert.ok(Lab);
  });
});
