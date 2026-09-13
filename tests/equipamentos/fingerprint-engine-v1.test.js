/**
 * Sprint 14.2 — Testes Fingerprint Engine V1.0
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const ProtocolDetector = require('../../backend/motores/equipamentos/fingerprint/ProtocolDetector');
const DriverResolver = require('../../backend/motores/equipamentos/fingerprint/DriverResolver');
const FingerprintCandidate = require('../../backend/motores/equipamentos/fingerprint/FingerprintCandidate');
const FingerprintRepository = require('../../backend/motores/equipamentos/fingerprint/FingerprintRepository');
const { FingerprintService } = require('../../backend/motores/equipamentos/fingerprint/FingerprintService');
const FingerprintController = require('../../backend/motores/equipamentos/fingerprint/FingerprintController');

describe('Fingerprint V1.0 — ProtocolDetector', () => {
  it('retorna null/0 sem resposta (infraestrutura)', () => {
    const d = new ProtocolDetector();
    assert.deepEqual(d.detect(null), { protocol: null, confidence: 0 });
    const vazio = d.detect(Buffer.alloc(0));
    assert.equal(vazio.protocol, null);
    assert.equal(vazio.confidence, 0);
  });

  it('reconhece marcador TOLEDO_ETH (assinatura passiva)', () => {
    const d = new ProtocolDetector();
    const r = d.detect(Buffer.from('__FP_TOLEDO_ETH__', 'utf8'));
    assert.equal(r.protocol, 'TOLEDO_ETH');
    assert.equal(r.confidence, 98);
  });

  it('lista protocolos futuros previstos', () => {
    const d = new ProtocolDetector();
    const lista = d.listarProtocolosFuturos();
    assert.ok(lista.includes('TOLEDO_ETH'));
    assert.ok(lista.includes('FILIZOLA'));
    assert.ok(lista.includes('URANO'));
    assert.ok(lista.includes('ELGIN'));
  });
});

describe('Fingerprint V1.0 — DriverResolver', () => {
  it('sem protocolo retorna nulls', () => {
    const r = new DriverResolver().resolve(null);
    assert.deepEqual(
      { driver: r.driver, fabricante: r.fabricante, modelo: r.modelo },
      { driver: null, fabricante: null, modelo: null }
    );
  });

  it('resolve TOLEDO_ETH para TOLEDO_PRIX4_UNO / Prix IV Uno', () => {
    const r = new DriverResolver().resolve('TOLEDO_ETH');
    assert.equal(r.driver, 'TOLEDO_PRIX4_UNO');
    assert.equal(r.fabricante, 'Toledo');
    assert.equal(r.modelo, 'Prix IV Uno');
  });

  it('não instancia Driver — apenas metadados', () => {
    const mapa = new DriverResolver().listarMapeamentos();
    assert.ok(mapa.TOLEDO_ETH);
    assert.equal(typeof mapa.TOLEDO_ETH.driver, 'string');
  });
});

describe('Fingerprint V1.0 — FingerprintCandidate', () => {
  it('estrutura e resposta HTTP do aceite', () => {
    const c = new FingerprintCandidate({
      host: '10.0.0.170',
      porta: 9000,
      protocolo: 'TOLEDO_ETH',
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      driver: 'TOLEDO_PRIX4_UNO',
      confidence: 98,
      fingerprint: 'abc'
    });
    assert.equal(c.identificado, true);
    assert.deepEqual(c.paraRespostaHttp(), {
      host: '10.0.0.170',
      porta: 9000,
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      driver: 'TOLEDO_PRIX4_UNO',
      confidence: 98
    });
  });
});

describe('Fingerprint V1.0 — FingerprintRepository', () => {
  it('persiste e recupera equipamentos_identificados', async () => {
    const repo = new FingerprintRepository();
    const host = `127.0.0.${Math.floor(Math.random() * 200) + 20}`;
    const porta = 9000 + Math.floor(Math.random() * 50);
    await repo.salvar({
      host,
      porta,
      protocolo: 'TOLEDO_ETH',
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      driver: 'TOLEDO_PRIX4_UNO',
      confidence: 98,
      fingerprint: 'fp-test'
    });
    const row = await repo.buscarPorHostPorta(host, porta);
    assert.ok(row);
    assert.equal(row.fabricante, 'Toledo');
    assert.equal(row.driver, 'TOLEDO_PRIX4_UNO');
    assert.equal(Number(row.confidence), 98);
  });
});

describe('Fingerprint V1.0 — FingerprintService', () => {
  it('identifica com resposta simulada Toledo (sem comando de balança)', async () => {
    const repo = {
      async salvar() { return { host: '10.0.0.170', porta: 9000 }; }
    };
    const svc = new FingerprintService({ repository: repo });
    const c = await svc.identificar(
      { host: '10.0.0.170', porta: 9000 },
      { respostaSimulada: '__FP_TOLEDO_ETH__', persistir: true }
    );
    assert.equal(c.fabricante, 'Toledo');
    assert.equal(c.modelo, 'Prix IV Uno');
    assert.equal(c.driver, 'TOLEDO_PRIX4_UNO');
    assert.equal(c.confidence, 98);
    assert.equal(c.protocolo, 'TOLEDO_ETH');
  });

  it('não identificado → confidence 0 e nulls', async () => {
    const svc = new FingerprintService({
      repository: { async salvar() { return null; } }
    });
    const c = await svc.identificar(
      { host: '10.0.0.1', porta: 9000 },
      { respostaSimulada: 'lixo-qualquer', persistir: false }
    );
    assert.equal(c.fabricante, null);
    assert.equal(c.modelo, null);
    assert.equal(c.driver, null);
    assert.equal(c.confidence, 0);
  });

  it('exige host e porta', async () => {
    const svc = new FingerprintService({
      repository: { async salvar() { return null; } }
    });
    await assert.rejects(
      () => svc.identificar({ host: '', porta: 0 }, { pularRede: true }),
      /host e porta/
    );
  });

  it('usa captura injetada sem escrever no socket', async () => {
    let capturas = 0;
    const svc = new FingerprintService({
      repository: { async salvar() { return null; } },
      capturar: async () => {
        capturas += 1;
        return { ok: true, buffer: Buffer.from('__FP_TOLEDO_ETH__'), latencia: 1 };
      }
    });
    const c = await svc.identificar({ host: '10.0.0.170', porta: 9000 }, { persistir: false });
    assert.equal(capturas, 1);
    assert.equal(c.driver, 'TOLEDO_PRIX4_UNO');
  });
});

describe('Fingerprint V1.0 — API POST /fingerprint', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/equipamentos/fingerprint', FingerprintController.fingerprint);
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('responde formato do aceite quando reconhece', async () => {
    const resp = await fetch(`${baseUrl}/api/equipamentos/fingerprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '10.0.0.170',
        porta: 9000,
        persistir: false,
        __respostaSimulada: '__FP_TOLEDO_ETH__'
      })
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.deepEqual(json, {
      host: '10.0.0.170',
      porta: 9000,
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      driver: 'TOLEDO_PRIX4_UNO',
      confidence: 98
    });
  });

  it('responde nulls quando não identifica', async () => {
    const resp = await fetch(`${baseUrl}/api/equipamentos/fingerprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '10.0.0.171',
        porta: 9000,
        persistir: false,
        __respostaSimulada: ''
      })
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.fabricante, null);
    assert.equal(json.modelo, null);
    assert.equal(json.driver, null);
    assert.equal(json.confidence, 0);
  });
});

describe('Fingerprint V1.0 — Fluxo completo Discovery → Fingerprint', () => {
  it('DeviceCandidate → Fingerprint → ProtocolDetector → DriverResolver', async () => {
    const DeviceCandidate = require('../../backend/motores/equipamentos/discovery/DeviceCandidate');
    const discovered = new DeviceCandidate({
      host: '10.0.0.170',
      porta: 9000,
      latencia: 2
    });

    const svc = new FingerprintService({
      repository: { async salvar(c) { return c; } }
    });

    const fp = await svc.identificar(discovered.paraLista(), {
      respostaSimulada: '__FP_TOLEDO_ETH__',
      persistir: true
    });

    assert.equal(discovered.fabricante, undefined);
    assert.equal(fp.host, '10.0.0.170');
    assert.equal(fp.porta, 9000);
    assert.equal(fp.protocolo, 'TOLEDO_ETH');
    assert.equal(fp.fabricante, 'Toledo');
    assert.equal(fp.modelo, 'Prix IV Uno');
    assert.equal(fp.driver, 'TOLEDO_PRIX4_UNO');
    assert.equal(fp.confidence, 98);
    assert.ok(fp.fingerprint);
  });
});
