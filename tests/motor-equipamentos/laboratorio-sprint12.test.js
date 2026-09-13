/**
 * Testes — Laboratório de Equipamentos (Sprint 12)
 * Executar: npm run test:equipamentos-laboratorio
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const frameStudio = require('../../backend/motores/equipamentos/laboratorio/FrameStudio');
const packetInspector = require('../../backend/motores/equipamentos/laboratorio/PacketInspector');
const captureManager = require('../../backend/motores/equipamentos/laboratorio/CaptureManager');
const replayManager = require('../../backend/motores/equipamentos/laboratorio/ReplayManager');
const packetComparator = require('../../backend/motores/equipamentos/laboratorio/PacketComparator');
const diagnosticoEquipamentos = require('../../backend/motores/equipamentos/laboratorio/DiagnosticoEquipamentos');
const packetLogger = require('../../backend/motores/equipamentos/communication/PacketLogger');
const ToledoPrix4Protocol = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol');
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
      if (error.stack) console.error(error.stack.split('\n').slice(1, 3).join('\n'));
    });
}

async function main() {
  console.log('\n=== Testes Laboratório Equipamentos — Sprint 12 ===\n');

  packetInspector.reiniciar();
  packetLogger.reiniciar();

  await test('FrameStudio monta frame ping Toledo', () => {
    const frame = frameStudio.montarFrame('TOLEDO_PRIX4_UNO', 'ping');
    assert.ok(frame.buffer.length > 0);
    assert.ok(frame.hex.includes('02'));
    assert.strictEqual(frame.tamanho, frame.buffer.length);
    assert.ok(frame.offsets.length >= 1);
  });

  await test('FrameStudio ASCII ↔ HEX', () => {
    const { hex, buffer } = frameStudio.asciiParaHex('ABC');
    assert.strictEqual(hex.replace(/\s/g, ''), '414243');
    const back = frameStudio.hexParaAscii(hex);
    assert.strictEqual(back.buffer.toString('utf8'), 'ABC');
  });

  await test('FrameStudio calcularTamanho e prepararPayload', () => {
    const buf = Buffer.from([1, 2, 3]);
    assert.strictEqual(frameStudio.calcularTamanho(buf), 3);
    const json = frameStudio.prepararPayload('{"a":1}');
    assert.deepStrictEqual(json, { a: 1 });
  });

  await test('PacketInspector enriquece TX/RX e latência', () => {
    packetInspector.reiniciar();
    const tx = packetInspector.registrarPacote({
      direcao: 'TX',
      buffer: Buffer.from('ping'),
      equipamento_id: 1,
      host: '127.0.0.1',
      porta: 9100,
      driver: 'TOLEDO_PRIX4_UNO',
      comando: 'PI'
    });
    assert.strictEqual(tx.tx, true);
    assert.strictEqual(tx.bytes, 4);

    const rx = packetInspector.registrarPacote({
      direcao: 'RX',
      buffer: Buffer.from('pong'),
      equipamento_id: 1,
      comando: 'PI',
      ack: true
    });
    assert.strictEqual(rx.rx, true);
    assert.strictEqual(rx.ack, true);
    assert.ok(packetInspector.listar().length >= 2);
  });

  await test('PacketLogger listener integra com PacketInspector', () => {
    packetInspector.reiniciar();
    let recebido = null;
    const unsub = packetLogger.adicionarListener((entry) => {
      recebido = packetInspector.registrarPacote(entry);
    });
    packetLogger.log('TX', Buffer.from([0x02, 0x03]), { driver: 'TEST' });
    unsub();
    assert.ok(recebido);
    assert.strictEqual(recebido.driver, 'TEST');
  });

  await test('CaptureManager iniciar/parar/registrar', () => {
    captureManager.iniciarCaptura({ equipamento_id: 99 });
    assert.strictEqual(captureManager.estaCapturando(), true);
    captureManager.registrarPacote({ direcao: 'TX', hex: '0203', ascii: '..', tamanho: 2 });
    const parada = captureManager.pararCaptura();
    assert.strictEqual(parada.sessao.total_pacotes, 1);
    assert.strictEqual(captureManager.estaCapturando(), false);
  });

  let capturaExportId = null;

  await test('CaptureManager exportar/listar/abrir', async () => {
    const sessao = {
      id: `test-cap-${Date.now()}`,
      pacotes: [
        { direcao: 'TX', hex: '02 50 49 03', ascii: '.PI.', tamanho: 4, buffer_hex: '02504903' },
        { direcao: 'RX', hex: '02 41 43 03', ascii: '.AC.', tamanho: 4, buffer_hex: '02414303' }
      ]
    };
    const exp = await captureManager.exportar(sessao, sessao.id);
    capturaExportId = exp.id;
    assert.ok(fs.existsSync(exp.json));
    assert.ok(fs.existsSync(exp.hex));
    assert.ok(fs.existsSync(exp.txt));
    assert.ok(fs.existsSync(exp.bin));

    const lista = captureManager.listarCapturas();
    assert.ok(lista.some((c) => c.id === capturaExportId));

    const aberta = captureManager.abrirCaptura(capturaExportId);
    assert.strictEqual(aberta.pacotes.length, 2);
  });

  await test('PacketComparator buffers e capturas', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 9, 3, 4]);
    const diff = packetComparator.compararBuffers(a, b);
    assert.strictEqual(diff.identicos, false);
    assert.ok(diff.bytes_alterados.length >= 1);
    assert.ok(diff.bytes_inseridos.length >= 1);
    assert.ok(diff.checksum_a !== null);

    const capA = { pacotes: [{ hex: '010203', buffer_hex: '010203' }] };
    const capB = { pacotes: [{ hex: '010203', buffer_hex: '010203' }] };
    const cmp = packetComparator.compararCapturas(capA, capB);
    assert.strictEqual(cmp.resumo.identicos, true);
  });

  await test('ReplayManager reenvia via protocol mock', async () => {
    const writes = [];
    const protocol = {
      conectado: true,
      write: async (buf) => { writes.push(buf); return { sucesso: true }; },
      read: async () => ({ dados: Buffer.from([0x02, 0x41, 0x43, 0x03]) })
    };
    const resultado = await replayManager.reenviarPacote({
      protocol,
      pacote: { hex: '02 50 49 03', buffer_hex: '02504903' }
    });
    assert.strictEqual(resultado.sucesso, true);
    assert.ok(writes.length === 1);
    assert.ok(resultado.resposta);
  });

  await test('DiagnosticoEquipamentos helpers ip/porta/mac', () => {
    const eq = { ip: '192.168.1.10', porta_tcp: 4001, mac: 'AA:BB:CC:DD:EE:FF' };
    assert.strictEqual(diagnosticoEquipamentos.ip(eq), '192.168.1.10');
    assert.strictEqual(diagnosticoEquipamentos.porta(eq), 4001);
    assert.strictEqual(diagnosticoEquipamentos.mac(eq), 'AA:BB:CC:DD:EE:FF');
    assert.deepStrictEqual(diagnosticoEquipamentos.driver({ codigo: 'X' }), { codigo: 'X', fabricante: null, versao: null });
  });

  mockServer = new MockTcpServer();
  await mockServer.iniciar({ modoToledo: true });
  connectionManager.reiniciar();
  packetLogger.reiniciar();

  const getConfig = () => ({
    host: '127.0.0.1',
    porta: mockServer.port,
    timeout: 2000,
    tentativas: 1,
    intervaloReconexao: 100,
    heartbeatInterval: 0
  });

  await test('Integração TCP: envio via protocol + PacketLogger', async () => {
    packetInspector.reiniciar();
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const frame = frameStudio.montarFrame('TOLEDO_PRIX4_UNO', 'ping');
    await protocol.write(frame.buffer, { operacao: 'lab_test', driver: 'TOLEDO_PRIX4_UNO' });
    const rx = await protocol.read({ timeout: 2000 });
    assert.ok(rx.dados && rx.dados.length > 0);
    await protocol.disconnect();
    assert.ok(packetLogger.listar().length >= 2);
  });

  await test('ReplayManager replayDaCaptura com captura exportada', async () => {
    if (!capturaExportId) throw new Error('captura não exportada');
    const captura = captureManager.abrirCaptura(capturaExportId);
    const protocol = new ToledoPrix4Protocol(getConfig());
    await protocol.connect();
    const resultado = await replayManager.replayDaCaptura(captura, 0, protocol);
    assert.strictEqual(resultado.sucesso, true);
    await protocol.disconnect();
  });

  if (capturaExportId) {
    try {
      const dir = path.dirname(require('../../backend/motores/equipamentos/laboratorio/CaptureManager').diretorioCapturas());
      const base = path.join(dir, capturaExportId);
      ['.json', '.hex.txt', '.txt', '.bin'].forEach((ext) => {
        const f = ext === '.json' ? `${base}.json` : `${base}${ext}`;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    } catch (_) {
      // limpeza best-effort
    }
  }

  await mockServer.parar();

  console.log(`\n--- Resultado: ${passou} OK, ${falhou} FALHOU ---\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
