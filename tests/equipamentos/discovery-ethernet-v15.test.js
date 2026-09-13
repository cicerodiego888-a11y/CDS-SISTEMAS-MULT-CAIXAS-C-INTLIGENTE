/**
 * Sprint 15.0 — Testes Discovery Ethernet
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const NetworkScanner = require('../../backend/motores/equipamentos/discovery/NetworkScanner');
const TcpScanner = require('../../backend/motores/equipamentos/discovery/TcpScanner');
const CandidateBuilder = require('../../backend/motores/equipamentos/discovery/CandidateBuilder');
const ProbeExecutor = require('../../backend/motores/equipamentos/discovery/ProbeExecutor');
const ToledoPrix4UnoDriver = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4UnoDriver');

describe('Sprint 15.0 — NetworkScanner sub-redes', () => {
  it('listarSubRedes retorna ip, subnet e broadcast', () => {
    const scanner = new NetworkScanner();
    const sub = scanner.listarSubRedes({ maxHosts: 5 });
    assert.ok(Array.isArray(sub));
    if (sub.length) {
      assert.ok(sub[0].ip);
      assert.ok(String(sub[0].subnet).includes('/'));
      assert.ok(sub[0].broadcast);
    }
  });

  it('descobrirRede inclui broadcast e subRedes', () => {
    const scanner = new NetworkScanner();
    const ifaces = scanner.listarInterfaces();
    if (!ifaces.length) return;
    const rede = scanner.descobrirRede({ maxHosts: 8 });
    assert.ok(rede.broadcast);
    assert.ok(Array.isArray(rede.subRedes));
    assert.ok(rede.cidr);
  });
});

describe('Sprint 15.0 — TcpScanner', () => {
  it('defaults: timeout 200ms e concorrência 50', () => {
    const tcp = new TcpScanner();
    assert.equal(tcp.timeoutMs, 200);
    assert.equal(tcp.concorrencia, 50);
    assert.deepEqual(tcp.portas, [9000]);
  });

  it('probe em porta fechada retorna aberta=false', async () => {
    const tcp = new TcpScanner({ timeoutMs: 80 });
    const r = await tcp.probe('127.0.0.1', 1);
    assert.equal(r.aberta, false);
  });

  it('detecta porta TCP aberta local', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const porta = server.address().port;
    try {
      const tcp = new TcpScanner({ timeoutMs: 300, concorrencia: 4 });
      const abertos = await tcp.escanear(['127.0.0.1'], { portas: [porta] });
      assert.equal(abertos.length, 1);
      assert.equal(abertos[0].porta, porta);
      const stats = tcp.obterEstatisticas();
      assert.equal(stats.portasAbertas, 1);
      assert.equal(stats.hostsConectados, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('Sprint 15.0 — Toledo discovery profile + probe', () => {
  it('Driver expõe discovery ethernet com portas', () => {
    const d = ToledoPrix4UnoDriver.discovery;
    assert.equal(d.transport, 'ethernet');
    assert.ok(d.ports.includes(9000));
    assert.equal(d.priority, 1);
    assert.ok(d.timeout >= 100);
  });

  it('buildProbe / matches / parseIdentity', () => {
    const driver = new ToledoPrix4UnoDriver({});
    const tx = driver.buildProbe();
    assert.ok(Buffer.isBuffer(tx));
    assert.ok(tx.length > 0);
    assert.equal(tx[0], 0x02);

    // Simula ACK Toledo
    const rx = Buffer.from([0x02, 0x41, 0x4b, 0x1c, 0x03]); // STX AK SEP ETX
    assert.equal(driver.matches(rx), true);
    const id = driver.parseIdentity(rx);
    assert.equal(id.fabricante, 'Toledo');
    assert.ok(id.modelo);
    assert.equal(id.driver, 'TOLEDO_PRIX4_UNO');
    assert.ok(id.confianca >= 0.8);
  });
});

describe('Sprint 15.0 — CandidateBuilder', () => {
  it('monta candidato Sprint 15 a partir de probe OK', () => {
    const builder = new CandidateBuilder();
    const cand = builder.construir({
      sucesso: true,
      driver: 'TOLEDO_PRIX4_UNO',
      endpoint: { host: '10.0.0.170', porta: 9000 },
      latencia: 12,
      identidade: {
        fabricante: 'Toledo',
        modelo: 'Prix IV Uno',
        versao: '90AX',
        confianca: 0.98,
        driver: 'TOLEDO_PRIX4_UNO'
      },
      confianca: 0.98
    });
    assert.ok(cand);
    assert.equal(cand.transporte, 'ethernet');
    assert.equal(cand.endpoint, '10.0.0.170:9000');
    assert.equal(cand.driver, 'TOLEDO_PRIX4_UNO');
    assert.equal(cand.confiança, 98);
    assert.equal(cand.ip, '10.0.0.170');
    assert.equal(cand.porta, 9000);
    assert.equal(cand.identidade.versao, '90AX');
  });
});

describe('Sprint 15.0 — ProbeExecutor com servidor mock', () => {
  it('identifica driver via buildProbe/matches', async () => {
    const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder');
    const hs = frameBuilder.buildHandshake();
    const server = net.createServer((socket) => {
      socket.on('data', () => {
        socket.write(Buffer.from([0x02, 0x41, 0x4b, 0x1c, 0x03]));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const porta = server.address().port;

    try {
      const driver = new ToledoPrix4UnoDriver({});
      const executor = new ProbeExecutor({ labLogger: null });
      const r = await executor.executar(
        { host: '127.0.0.1', porta },
        {
          codigo: 'TOLEDO_PRIX4_UNO',
          instancia: driver,
          discovery: ToledoPrix4UnoDriver.discovery
        },
        { timeoutMs: 800 }
      );
      assert.equal(r.sucesso, true);
      assert.equal(r.driver, 'TOLEDO_PRIX4_UNO');
      assert.ok(r.identidade.fabricante);
      assert.ok(Buffer.isBuffer(hs));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
