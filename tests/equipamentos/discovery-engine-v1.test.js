/**
 * Sprint 14.1 — Testes unitários Discovery Engine V1.0
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const NetworkScanner = require('../../backend/motores/equipamentos/discovery/NetworkScanner');
const PortScanner = require('../../backend/motores/equipamentos/discovery/PortScanner');
const DeviceCandidate = require('../../backend/motores/equipamentos/discovery/DeviceCandidate');
const { PORTAS_V1, PORTAS_CONHECIDAS } = require('../../backend/motores/equipamentos/discovery/PortScanner');

describe('Discovery Engine V1.0 — NetworkScanner', () => {
  it('lista interfaces ou lança erro claro', () => {
    const scanner = new NetworkScanner();
    const ifaces = scanner.listarInterfaces();
    assert.ok(Array.isArray(ifaces));
    if (ifaces.length) {
      const rede = scanner.descobrirRede({ maxHosts: 10 });
      assert.ok(rede.ipLocal);
      assert.ok(rede.mascara);
      assert.ok(rede.cidr);
      assert.ok(rede.hosts.length <= 10);
      assert.ok(!rede.hosts.includes(rede.ipLocal));
    }
  });
});

describe('Discovery Engine V1.0 — PortScanner', () => {
  it('V1 usa apenas porta 9000 e catálogo futuro existe', () => {
    assert.deepEqual([...PORTAS_V1], [9000]);
    assert.ok(PORTAS_CONHECIDAS.includes(9000));
    assert.ok(PORTAS_CONHECIDAS.includes(9050));
    assert.ok(PORTAS_CONHECIDAS.includes(9100));
    assert.ok(PORTAS_CONHECIDAS.includes(10001));
    const ps = new PortScanner();
    assert.deepEqual(ps.portas, [9000]);
  });

  it('probe em host inválido retorna fechado', async () => {
    const ps = new PortScanner({ timeoutMs: 100 });
    const r = await ps.probe('127.0.0.1', 1);
    assert.equal(r.aberta, false);
    assert.equal(r.latencia, null);
  });
});

describe('Discovery Engine V1.0 — DeviceCandidate', () => {
  it('monta candidato sem fabricante', () => {
    const c = new DeviceCandidate({
      host: '10.0.0.170',
      porta: 9000,
      latencia: 2
    });
    assert.equal(c.host, '10.0.0.170');
    assert.equal(c.porta, 9000);
    assert.equal(c.status, 'ONLINE');
    assert.equal(c.transporte, 'TCP');
    assert.ok(c.id);
    const lista = c.paraLista();
    assert.deepEqual(lista, {
      host: '10.0.0.170',
      porta: 9000,
      status: 'ONLINE',
      latencia: 2
    });
    assert.equal(lista.fabricante, undefined);
  });
});
