/**
 * Testes — Infraestrutura Protocolo Toledo Prix 4 (Sprint 11A)
 * Executar: npm run test:equipamentos-toledo-protocol
 */

const assert = require('assert');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder');
const ToledoPrix4Parser = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Parser');
const ToledoPrix4Protocol = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol');
const ToledoPrix4UnoDriver = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4UnoDriver');
const connectionManager = require('../../backend/motores/equipamentos/transport/ConnectionManager');
const packetLogger = require('../../backend/motores/equipamentos/communication/PacketLogger');
const queueManager = require('../../backend/motores/equipamentos/queue/QueueManager');
const equipamentosManager = require('../../backend/motores/equipamentos/core/EquipamentosManager');
const equipamentosRepository = require('../../backend/motores/equipamentos/repositories/EquipamentosRepository');
const driverLoader = require('../../backend/motores/equipamentos/drivers/DriverLoader');
const MockTcpServer = require('./helpers/MockTcpServer');

let passou = 0;
let falhou = 0;
let mockServer;
let equipamentoId = null;

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
  console.log('\n=== Testes Protocolo Toledo Prix 4 — Sprint 11A ===\n');

  driverLoader.carregarTodos();
  mockServer = new MockTcpServer();
  await mockServer.iniciar({ modoToledo: true });
  connectionManager.reiniciar();
  packetLogger.reiniciar();

  const getConfig = (extras = {}) => ({
    host: '127.0.0.1',
    porta: mockServer.port,
    timeout: 3000,
    heartbeatInterval: 0,
    ...extras
  });

  // ─── FrameBuilder ─────────────────────────────────────────────
  await test('FrameBuilder buildFrame com STX/ETX', () => {
    const frame = frameBuilder.buildFrame('HS', { ok: true });
    assert.strictEqual(frame[0], frameBuilder.STX);
    assert.strictEqual(frame[frame.length - 1], frameBuilder.ETX);
    assert.ok(frame.includes(Buffer.from('HS')));
  });

  await test('FrameBuilder buildHandshake, Ping, Status', () => {
    assert.ok(frameBuilder.buildHandshake().length > 4);
    assert.ok(frameBuilder.buildPing().length > 4);
    assert.ok(frameBuilder.buildStatus().length > 4);
  });

  await test('FrameBuilder buildProduto, Departamento, Promocao, Remocao', () => {
    assert.ok(frameBuilder.buildProduto({ plu: '1' }).length > 4);
    assert.ok(frameBuilder.buildDepartamento({ codigo: '2' }).length > 4);
    assert.ok(frameBuilder.buildPromocao({ plu: '1' }).length > 4);
    assert.ok(frameBuilder.buildRemocaoProduto('9').length > 4);
  });

  // ─── Parser ───────────────────────────────────────────────────
  await test('Parser parseACK e parseNAK', () => {
    const parser = new ToledoPrix4Parser();
    const ack = parser.parseACK(frameBuilder.buildAck());
    assert.strictEqual(ack.ack, true);
    const nak = parser.parseNAK(frameBuilder.buildNak('falha'));
    assert.strictEqual(nak.nak, true);
    assert.ok(nak.mensagem.includes('falha'));
  });

  await test('Parser parseStatus e parsePeso', () => {
    const parser = new ToledoPrix4Parser();
    const st = parser.parseStatus(frameBuilder.buildRespostaStatus());
    assert.strictEqual(st.online, true);
    const peso = parser.parsePeso(frameBuilder.buildRespostaPeso({ valor: 2.5, estavel: true }));
    assert.strictEqual(peso.valor, 2.5);
    assert.strictEqual(peso.estavel, true);
  });

  await test('Parser parseErro em frame inválido', () => {
    const parser = new ToledoPrix4Parser();
    const erro = parser.parseErro(Buffer.from('invalido'), 'teste');
    assert.strictEqual(erro.sucesso, false);
  });

  // ─── Protocol ─────────────────────────────────────────────────
  await test('Protocol handshake', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const hs = await protocol.handshake();
    assert.strictEqual(hs.sucesso, true);
    assert.strictEqual(hs.metodo, 'handshake');
    await protocol.disconnect();
  });

  await test('Protocol ping', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const ping = await protocol.ping();
    assert.strictEqual(ping.sucesso, true);
    await protocol.disconnect();
  });

  await test('Protocol status', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const st = await protocol.status();
    assert.strictEqual(st.sucesso, true);
    assert.strictEqual(st.online, true);
    await protocol.disconnect();
  });

  await test('Protocol enviarProduto', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const res = await protocol.enviarProduto({ plu: '77', preco: 100 });
    assert.strictEqual(res.sucesso, true);
    await protocol.disconnect();
  });

  await test('Protocol enviarDepartamento e enviarPromocao', async () => {
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const dep = await protocol.enviarDepartamento({ codigo: '3', nome: 'Horti' });
    const promo = await protocol.enviarPromocao({ plu: '77', precoPromocional: 50 });
    assert.strictEqual(dep.sucesso, true);
    assert.strictEqual(promo.sucesso, true);
    await protocol.disconnect();
  });

  await test('Protocol timeout de leitura', async () => {
    await mockServer.parar();
    await mockServer.iniciar({ modoToledo: false, echo: false });
    const protocol = new ToledoPrix4Protocol(getConfig({ timeout: 300 }));
    await protocol.connect();
    protocol.timeout(300);
    await assert.rejects(() => protocol.handshake(), /Timeout/);
    await protocol.disconnect();
    await mockServer.parar();
    await mockServer.iniciar({ modoToledo: true });
  });

  await test('Protocol registra TX/RX no PacketLogger', async () => {
    packetLogger.reiniciar();
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    await protocol.ping();
    const hist = packetLogger.listar(protocol._chave);
    assert.ok(hist.length >= 2);
    assert.strictEqual(hist[0].direcao, 'TX');
    assert.strictEqual(hist[1].direcao, 'RX');
    await protocol.disconnect();
  });

  // ─── EquipamentosManager ──────────────────────────────────────
  await test('EquipamentosManager obterDriver e conectar', async () => {
    const eq = await equipamentosRepository.salvar({
      nome: `Sprint11A ${Date.now()}`,
      tipo: 'balanca',
      transporte: 'ethernet',
      ip: '127.0.0.1',
      porta_tcp: mockServer.port,
      timeout_ms: 3000,
      fabricante: 'Toledo',
      modelo: 'Prix 4 Uno',
      driver_codigo: 'TOLEDO_PRIX4_UNO'
    });
    equipamentoId = eq.id;

    const driver = await equipamentosManager.obterDriver(equipamentoId);
    assert.ok(driver instanceof ToledoPrix4UnoDriver);

    const con = await equipamentosManager.conectar(equipamentoId);
    assert.strictEqual(con.comunicacao_real, true);

    const st = await equipamentosManager.status(equipamentoId);
    assert.ok(st.sucesso !== false);
  });

  await test('EquipamentosManager sincronizarProduto', async () => {
    const res = await equipamentosManager.sincronizarProduto(equipamentoId, {
      plu: 501,
      descricao: 'Teste Sprint 11A',
      preco: 3.5,
      pesavel: true
    });
    assert.strictEqual(res.sucesso, true);
    assert.strictEqual(res.comunicacao_real, true);
  });

  await test('EquipamentosManager sincronizarDepartamento e Promocao', async () => {
    const dep = await equipamentosManager.sincronizarDepartamento(equipamentoId, {
      codigo: 8,
      nome: 'Padaria'
    });
    const promo = await equipamentosManager.sincronizarPromocao(equipamentoId, {
      plu: 501,
      precoPromocional: 2.99
    });
    assert.strictEqual(dep.sucesso, true);
    assert.strictEqual(promo.sucesso, true);
  });

  // ─── QueueManager ─────────────────────────────────────────────
  await test('QueueManager processa item SYNC_PRODUTO', async () => {
    queueManager.parar();

    const item = await queueManager.enfileirar({
      equipamentoId,
      comando: queueManager.COMANDOS.SYNC_PRODUTO,
      payload: {
        dto: {
          plu: 888,
          descricao: 'Fila Teste',
          preco: 1.99,
          pesavel: true,
          unidade: 'kg'
        }
      },
      prioridade: 1
    });

    await equipamentosManager.inicializar({ queue: { intervaloMs: 200 } });

    let concluido = false;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      const fila = await equipamentosRepository.listarFila({ equipamento_id: equipamentoId });
      const atual = fila.find((f) => f.id === item.id);
      if (atual && atual.status === 'concluido') {
        concluido = true;
        break;
      }
      if (atual && atual.status === 'erro') {
        throw new Error(atual.erro_mensagem || 'fila erro');
      }
    }

    assert.strictEqual(concluido, true, 'item da fila não foi concluído a tempo');
  });

  await test('QueueManager retry em falha e conclui após sucesso', async () => {
    queueManager.parar();
    await mockServer.parar();
    await mockServer.iniciar({ modoToledo: true, responderNak: true });

    const eqNak = await equipamentosRepository.salvar({
      nome: `Sprint11A NAK ${Date.now()}`,
      tipo: 'balanca',
      transporte: 'ethernet',
      ip: '127.0.0.1',
      porta_tcp: mockServer.port,
      timeout_ms: 2000,
      fabricante: 'Toledo',
      modelo: 'Prix 4 Uno',
      driver_codigo: 'TOLEDO_PRIX4_UNO'
    });

    const item = await queueManager.enfileirar({
      equipamentoId: eqNak.id,
      comando: queueManager.COMANDOS.SYNC_PRODUTO,
      payload: {
        dto: { plu: 777, descricao: 'Retry Test', preco: 2, pesavel: true, unidade: 'kg' }
      }
    });

    mockServer.responderNak = false;
    queueManager.iniciar({ intervaloMs: 100 });

    let finalStatus = null;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      const fila = await equipamentosRepository.listarFila({ equipamento_id: eqNak.id });
      const atual = fila.find((f) => f.id === item.id);
      if (atual && (atual.status === 'concluido' || atual.status === 'erro')) {
        finalStatus = atual.status;
        if (finalStatus === 'concluido') break;
      }
    }

    assert.strictEqual(finalStatus, 'concluido');
    await equipamentosRepository.remover(eqNak.id);
    await mockServer.parar();
    await mockServer.iniciar({ modoToledo: true });
  });

  // ─── Cleanup ──────────────────────────────────────────────────
  queueManager.parar();
  await equipamentosManager.encerrar();
  connectionManager.reiniciar();

  if (equipamentoId) {
    try {
      await equipamentosRepository.remover(equipamentoId);
    } catch (_) {
      // ignora
    }
  }

  await mockServer.parar();

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
