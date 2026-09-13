/**
 * Testes — Comunicação TCP Toledo Prix 4 Uno (Sprint 10)
 * Executar: npm run test:equipamentos-toledo-tcp
 *
 * Utiliza MockTcpServer — sem balança real, sem comandos Toledo.
 */

const assert = require('assert');
const ToledoPrix4UnoDriver = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4UnoDriver');
const ToledoPrix4Protocol = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol');
const connectionManager = require('../../backend/motores/equipamentos/transport/ConnectionManager');
const connectionMonitor = require('../../backend/motores/equipamentos/monitor/ConnectionMonitor');
const packetLogger = require('../../backend/motores/equipamentos/communication/PacketLogger');
const packetHistory = require('../../backend/motores/equipamentos/communication/PacketHistory');
const HexViewer = require('../../backend/motores/equipamentos/communication/HexViewer');
const MockTcpServer = require('./helpers/MockTcpServer');

let passou = 0;
let falhou = 0;
let mockServer;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

async function main() {
  console.log('\n=== Testes Toledo Prix 4 TCP — Sprint 10 ===\n');

  mockServer = new MockTcpServer();
  await mockServer.iniciar();
  connectionManager.reiniciar();
  packetLogger.reiniciar();

  const getConfig = (extras = {}) => ({
    host: '127.0.0.1',
    porta: mockServer.port,
    timeout: 2000,
    tentativas: 2,
    intervaloReconexao: 100,
    heartbeatInterval: 0,
    ...extras
  });

  const reiniciarEcho = async () => {
    await mockServer.parar();
    await mockServer.iniciar();
    connectionManager.reiniciar();
  };

  const reiniciarToledo = async () => {
    await mockServer.parar();
    await mockServer.iniciar({ modoToledo: true });
    connectionManager.reiniciar();
  };

  await test('ToledoPrix4Protocol connect via ConnectionManager', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    const res = await protocol.connect();
    assert.strictEqual(res.comunicacao_real, true);
    assert.strictEqual(res.sucesso, true);
    assert.strictEqual(protocol.conectado, true);
    await protocol.disconnect();
  });

  await test('ToledoPrix4Protocol disconnect fecha socket', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const disc = await protocol.disconnect();
    assert.strictEqual(disc.conectado, false);
    assert.strictEqual(protocol.conectado, false);
  });

  await test('ToledoPrix4Protocol ping retorna latência', async () => {
    await reiniciarToledo();
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const ping = await protocol.ping();
    assert.strictEqual(ping.comunicacao_real, true);
    assert.ok(ping.ack === true || ping.sucesso === true);
    await protocol.disconnect();
    await reiniciarEcho();
  });

  await test('ToledoPrix4Protocol write/read registram pacotes TX/RX', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    packetLogger.reiniciar();

    await protocol.write('TESTE');
    const res = await protocol.read({ timeout: 2000 });

    assert.ok(res.dados);
    assert.strictEqual(res.dados.toString(), 'TESTE');

    const historico = packetLogger.listar(protocol._chave);
    assert.strictEqual(historico.length, 2);
    assert.strictEqual(historico[0].direcao, 'TX');
    assert.strictEqual(historico[1].direcao, 'RX');
    assert.ok(historico[0].hex.includes('54 45 53 54 45'));

    await protocol.disconnect();
  });

  await test('ToledoPrix4Protocol timeout de leitura', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig({ timeout: 300 }));
    await protocol.connect();
    protocol.timeout(300);
    await assert.rejects(() => protocol.read({ timeout: 300 }), /Timeout de leitura/);
    await protocol.disconnect();
  });

  await test('ToledoPrix4Protocol reconnect após queda', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const chave = protocol._chave;

    for (const client of mockServer.clients) {
      client.destroy();
    }
    await mockServer.atrasar(150);

    const recon = await protocol.reconnect();
    assert.strictEqual(recon.sucesso, true);
    assert.strictEqual(protocol.conectado, true);

    const monitor = connectionMonitor.obterStatus(chave);
    assert.ok(monitor.reconexoes >= 1);

    await protocol.disconnect();
  });

  await test('ToledoPrix4Protocol heartbeat executa ping', async () => {
    await reiniciarToledo();
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const hb = await protocol.heartbeat();
    assert.strictEqual(hb.sucesso, true);
    assert.ok(hb.ping);
    await protocol.disconnect();
    await reiniciarEcho();
  });

  await test('ToledoPrix4UnoDriver conectar comunicação real', async () => {
    const driver = new ToledoPrix4UnoDriver(getConfig());
    const res = await driver.conectar();
    assert.strictEqual(res.comunicacao_real, true);
    assert.strictEqual(res.simulado, false);
    assert.strictEqual(res.conexao.sucesso, true);
    assert.ok(res.monitor.conectado);
    await driver.desconectar();
  });

  await test('HexViewer formata HEX ASCII e tamanho', () => {
    const visual = HexViewer.format('AB');
    assert.strictEqual(visual.tamanho, 2);
    assert.strictEqual(visual.hex, '41 42');
    assert.strictEqual(visual.ascii, 'AB');
  });

  await test('PacketHistory persiste histórico por chave', () => {
    packetHistory.reiniciar();
    packetHistory.adicionar({ chave: '127.0.0.1:1', direcao: 'TX', tamanho: 1 });
    packetHistory.adicionar({ chave: '127.0.0.1:1', direcao: 'RX', tamanho: 2 });
    assert.strictEqual(packetHistory.contar('127.0.0.1:1'), 2);
    const exportado = packetHistory.exportar('127.0.0.1:1');
    assert.strictEqual(exportado.total, 2);
  });

  await test('ConnectionMonitor expõe tentativas e reconexões', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const monitor = connectionMonitor.obterStatus(protocol._chave);
    assert.ok(monitor.tentativas >= 1);
    assert.strictEqual(typeof monitor.tempo_conexao_ms, 'number');
    await protocol.disconnect();
  });

  await test('ToledoPrix4Protocol handshake usa infraestrutura 11A', async () => {
    await reiniciarToledo();
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const hs = await protocol.handshake();
    assert.strictEqual(hs.comunicacao_real, true);
    assert.strictEqual(hs.sucesso, true);
    assert.strictEqual(hs.infraestrutura, '11A');
    await protocol.disconnect();
    await reiniciarEcho();
  });

  connectionManager.reiniciar();
  await mockServer.parar();

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
