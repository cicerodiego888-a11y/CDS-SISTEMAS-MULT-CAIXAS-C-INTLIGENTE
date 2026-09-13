/**
 * Testes — Comunicação TCP real do Motor Equipamentos (Sprint 8)
 * Executar: npm run test:equipamentos-tcp
 *
 * Utiliza MockTcpServer — sem balança real.
 */

const assert = require('assert');
const EthernetTransport = require('../../backend/motores/equipamentos/transport/EthernetTransport');
const connectionManager = require('../../backend/motores/equipamentos/transport/ConnectionManager');
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
  console.log('\n=== Testes TCP — Motor Equipamentos (Sprint 8) ===\n');

  mockServer = new MockTcpServer();
  await mockServer.iniciar();
  connectionManager.reiniciar();

  const baseConfig = {
    host: '127.0.0.1',
    porta: mockServer.port,
    timeout: 2000,
    tentativas: 2,
    intervaloReconexao: 100,
    heartbeatInterval: 0
  };

  // ─── Conexão ────────────────────────────────────────────────
  await test('EthernetTransport conecta via TCP real', async () => {
    const t = new EthernetTransport(baseConfig);
    const conn = await t.connect();
    assert.strictEqual(conn.comunicacao_real, true);
    assert.strictEqual(t.isConnected(), true);
    await t.disconnect();
  });

  await test('EthernetTransport write/read com eco do servidor', async () => {
    const t = new EthernetTransport(baseConfig);
    await t.connect();
    await t.write('PING');
    const res = await t.read({ timeout: 2000 });
    assert.ok(res.dados);
    assert.strictEqual(res.dados.toString(), 'PING');
    await t.disconnect();
  });

  await test('EthernetTransport aliases connect/disconnect/isConnected', async () => {
    const t = new EthernetTransport(baseConfig);
    await t.connect();
    assert.strictEqual(t.isConnected(), true);
    assert.strictEqual(t.estaConectado(), true);
    await t.disconnect();
    assert.strictEqual(t.isConnected(), false);
  });

  await test('EthernetTransport timeout() configura timeout', () => {
    const t = new EthernetTransport(baseConfig);
    assert.strictEqual(t.timeout(1500), 1500);
    assert.strictEqual(t._timeout, 1500);
  });

  // ─── Desconexão ─────────────────────────────────────────────
  await test('EthernetTransport desconecta corretamente', async () => {
    const t = new EthernetTransport(baseConfig);
    await t.connect();
    const disc = await t.disconnect();
    assert.strictEqual(disc.conectado, false);
    assert.strictEqual(t.isConnected(), false);
  });

  await test('EthernetTransport falha write sem conexão', async () => {
    const t = new EthernetTransport(baseConfig);
    await assert.rejects(() => t.write('X'), /não conectado/);
  });

  // ─── Timeout ────────────────────────────────────────────────
  await test('EthernetTransport timeout de leitura sem dados', async () => {
    const t = new EthernetTransport({ ...baseConfig, timeout: 300 });
    await t.connect();
    await assert.rejects(() => t.read({ timeout: 300 }), /Timeout de leitura/);
    await t.disconnect();
  });

  await test('EthernetTransport timeout de conexão em porta fechada', async () => {
    const t = new EthernetTransport({
      host: '127.0.0.1',
      porta: 59999,
      timeout: 400,
      tentativas: 1
    });
    await assert.rejects(() => t.connect(), /Timeout|ECONNREFUSED|connect/);
  });

  // ─── Reconexão ──────────────────────────────────────────────
  await test('EthernetTransport reconecta após queda', async () => {
    const t = new EthernetTransport({ ...baseConfig, tentativas: 3, intervaloReconexao: 50 });
    await t.connect();
    assert.strictEqual(t.isConnected(), true);

    const client = mockServer.clients[0];
    client.destroy();

    await mockServer.atrasar(100);

    const recon = await t.reconnect();
    assert.strictEqual(recon.comunicacao_real, true);
    assert.strictEqual(t.isConnected(), true);
    await t.disconnect();
  });

  // ─── Ping ───────────────────────────────────────────────────
  await test('EthernetTransport ping retorna latência', async () => {
    const t = new EthernetTransport(baseConfig);
    await t.connect();
    const ping = await t.ping();
    assert.strictEqual(ping.sucesso, true);
    assert.ok(typeof ping.latencia_ms === 'number');
    await t.disconnect();
  });

  // ─── ConnectionManager ──────────────────────────────────────
  await test('ConnectionManager abre e reutiliza conexão', async () => {
    connectionManager.reiniciar();
    const cfg = { ...baseConfig, equipamento_id: 99 };

    const c1 = await connectionManager.abrir(cfg);
    const c2 = await connectionManager.abrir(cfg);

    assert.strictEqual(c1.transport, c2.transport);
    assert.strictEqual(connectionManager.obterStatus(99).conectado, true);

    await connectionManager.fechar(99);
    assert.strictEqual(connectionManager.obterStatus(99).conectado, false);
  });

  await test('ConnectionManager heartbeat mantém conexão', async () => {
    connectionManager.reiniciar();
    const cfg = {
      ...baseConfig,
      equipamento_id: 100,
      heartbeatInterval: 200
    };

    await connectionManager.abrir(cfg);
    await mockServer.atrasar(350);

    const status = connectionManager.obterStatus(100);
    assert.strictEqual(status.conectado, true);

    await connectionManager.fechar(100);
  });

  await test('ConnectionManager reconecta conexão existente', async () => {
    connectionManager.reiniciar();
    const cfg = { ...baseConfig, equipamento_id: 101, intervaloReconexao: 50 };

    await connectionManager.abrir(cfg);
    mockServer.clients[0]?.destroy();
    await mockServer.atrasar(100);

    const recon = await connectionManager.reconectar(101);
    assert.strictEqual(recon.comunicacao_real, true);
    assert.strictEqual(connectionManager.obterStatus(101).conectado, true);

    await connectionManager.fechar(101);
  });

  await test('ConnectionManager obterStatus retorna tempo e último erro', async () => {
    connectionManager.reiniciar();
    await connectionManager.abrir({ ...baseConfig, equipamento_id: 102 });
    const status = connectionManager.obterStatus(102);
    assert.strictEqual(status.conectado, true);
    assert.ok(status.tempo_conexao_ms >= 0);
    assert.strictEqual(status.comunicacao_real, true);
    await connectionManager.fechar(102);
  });

  // ─── Cleanup ────────────────────────────────────────────────
  connectionManager.reiniciar();
  await mockServer.parar();

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Erro fatal nos testes TCP:', err);
  connectionManager.reiniciar();
  if (mockServer) await mockServer.parar().catch(() => {});
  process.exit(1);
});
