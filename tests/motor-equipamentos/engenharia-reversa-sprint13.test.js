/**
 * Testes — Engenharia Reversa Protocolo Toledo (Sprint 13)
 * Executar: npm run test:equipamentos-engenharia-reversa
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const frameAnalyzer = require('../../backend/motores/equipamentos/engenharia-reversa/FrameAnalyzer');
const CaptureSession = require('../../backend/motores/equipamentos/engenharia-reversa/CaptureSession');
const protocolDocumentation = require('../../backend/motores/equipamentos/engenharia-reversa/ProtocolDocumentation');
const captureExporter = require('../../backend/motores/equipamentos/engenharia-reversa/CaptureExporter');
const captureImporter = require('../../backend/motores/equipamentos/engenharia-reversa/CaptureImporter');
const wiresharkFormat = require('../../backend/motores/equipamentos/engenharia-reversa/WiresharkFormat');
const protocolCaptureService = require('../../backend/motores/equipamentos/engenharia-reversa/ProtocolCaptureService');
const packetComparator = require('../../backend/motores/equipamentos/laboratorio/PacketComparator');
const packetLogger = require('../../backend/motores/equipamentos/communication/PacketLogger');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder');
const ToledoPrix4Protocol = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol');
const connectionManager = require('../../backend/motores/equipamentos/transport/ConnectionManager');
const MockTcpServer = require('./helpers/MockTcpServer');
const { caminhoProtocoloMd } = require('../../backend/motores/equipamentos/engenharia-reversa/paths');

let passou = 0;
let falhou = 0;
let mockServer;
let exportId = null;

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
  console.log('\n=== Testes Engenharia Reversa — Sprint 13 ===\n');

  protocolDocumentation.reiniciarObservacoes();
  packetLogger.reiniciar();

  await test('FrameAnalyzer detecta STX/ETX sem assumir protocolo', () => {
    const frame = frameBuilder.buildPing();
    const analise = frameAnalyzer.analisarFrame(frame);
    assert.ok(analise.padroes.stx);
    assert.ok(analise.padroes.etx);
    assert.ok(analise.campos.length >= 1);
    assert.ok(analise.payload);
    assert.ok(analise.nota.includes('heurística'));
  });

  await test('FrameAnalyzer identifica ACK e NAK', () => {
    const ack = frameAnalyzer.analisarFrame(Buffer.from([0x06]));
    const nak = frameAnalyzer.analisarFrame(Buffer.from([0x15]));
    assert.strictEqual(ack.padroes.ack.detectado, true);
    assert.strictEqual(nak.padroes.nak.detectado, true);
  });

  await test('CaptureSession armazena metadados', () => {
    const sessao = new CaptureSession({
      driver: 'TOLEDO_PRIX4_UNO',
      modelo: 'Prix 4 Uno',
      ip: '192.168.1.50',
      porta: 9100
    });
    sessao.adicionarPacote({ direcao: 'TX', hex: '0203', tamanho: 2 });
    sessao.adicionarObservacao('Teste MGV7');
    const json = sessao.finalizar();
    assert.strictEqual(json.quantidade_pacotes, 1);
    assert.ok(json.observacoes.includes('MGV7'));
    assert.ok(json.tempo_ms >= 0);
  });

  await test('ProtocolDocumentation classifica e gera markdown', () => {
    const ping = frameBuilder.buildPing();
    const analise = frameAnalyzer.analisarFrame(ping);
    const cat = protocolDocumentation.classificarPacote({ direcao: 'TX' }, analise);
    assert.ok(['ping', 'desconhecido'].includes(cat));

    const sessao = {
      id: 'doc-test',
      pacotes: [{
        direcao: 'TX',
        buffer_hex: ping.toString('hex'),
        analise
      }]
    };
    const md = protocolDocumentation.gerarMarkdown(protocolDocumentation.agregarDescobertas(sessao));
    assert.ok(md.includes('Protocolo Toledo'));
    assert.ok(md.includes('Frames analisados'));
  });

  await test('ProtocolCaptureService integra PacketLogger TX/RX', () => {
    if (protocolCaptureService.estaCapturando()) protocolCaptureService.pararCaptura();
    protocolCaptureService.iniciarCaptura({ driver: 'TEST', ip: '127.0.0.1', porta: 9100 });

    const tx = frameBuilder.buildStatus();
    packetLogger.log('TX', tx, { driver: 'TOLEDO_PRIX4_UNO', host: '127.0.0.1', porta: 9100 });
    packetLogger.log('RX', frameBuilder.buildAck({}), { driver: 'TOLEDO_PRIX4_UNO', ack: true });

    const parada = protocolCaptureService.pararCaptura();
    assert.strictEqual(parada.sessao.quantidade_pacotes, 2);
    assert.ok(parada.sessao.pacotes[0].analise);
    assert.ok(parada.sessao.pacotes[0].timestamp);
  });

  await test('CaptureExporter exporta JSON/HEX/TXT/BIN/CSV/Wireshark', async () => {
    const sessao = {
      id: `er-test-${Date.now()}`,
      driver: 'TOLEDO_PRIX4_UNO',
      ip: '10.0.0.1',
      porta: 9100,
      pacotes: [
        {
          timestamp: new Date().toISOString(),
          direcao: 'TX',
          hex: frameAnalyzer.analisarFrame(frameBuilder.buildPing()).hex,
          ascii: '.',
          tamanho: 10,
          buffer_hex: frameBuilder.buildPing().toString('hex'),
          categoria: 'ping'
        }
      ]
    };
    const exp = captureExporter.exportar(sessao, sessao.id);
    exportId = exp.id;
    assert.ok(fs.existsSync(exp.json));
    assert.ok(fs.existsSync(exp.hex));
    assert.ok(fs.existsSync(exp.txt));
    assert.ok(fs.existsSync(exp.csv));
    assert.ok(fs.existsSync(exp.wireshark));
  });

  await test('CaptureImporter importa JSON e HEX', () => {
    const { diretorioCapturas } = require('../../backend/motores/equipamentos/engenharia-reversa/paths');
    const dir = diretorioCapturas();
    const json = captureImporter.abrirPorId(exportId).toJSON();
    assert.ok(json.pacotes.length >= 1);

    const hexPath = path.join(dir, `${exportId}.hex.txt`);
    assert.ok(fs.existsSync(hexPath), `HEX esperado em ${hexPath}`);
    const fromHex = captureImporter.importarHEX(hexPath);
    assert.ok(fromHex.quantidadePacotes() >= 1);
  });

  await test('WiresharkFormat gera colunas TX/RX e delta', () => {
    const texto = wiresharkFormat.gerar([
      { timestamp: '2026-07-01T10:00:00.000Z', direcao: 'TX', hex: '02', ascii: '.' },
      { timestamp: '2026-07-01T10:00:00.050Z', direcao: 'RX', hex: '06', ascii: '.' }
    ], { ip: '192.168.1.1', porta: 9100 });
    assert.ok(texto.includes('TX'));
    assert.ok(texto.includes('RX'));
    assert.ok(texto.includes('192.168.1.1'));
  });

  await test('PacketComparator compara por categoria handshake/produto', () => {
    const capA = {
      pacotes: [
        { buffer_hex: frameBuilder.buildHandshake().toString('hex'), categoria: 'handshake' },
        { buffer_hex: frameBuilder.buildProduto({ plu: 1 }).toString('hex'), categoria: 'produto' }
      ]
    };
    const capB = {
      pacotes: [
        { buffer_hex: frameBuilder.buildHandshake().toString('hex'), categoria: 'handshake' },
        { buffer_hex: frameBuilder.buildProduto({ plu: 2 }).toString('hex'), categoria: 'produto' }
      ]
    };
    const hs = packetComparator.compararHandshake(capA, capB);
    const prod = packetComparator.compararProduto(capA, capB);
    assert.strictEqual(hs.resumo.identicos, true);
    assert.strictEqual(prod.resumo.identicos, false);
  });

  mockServer = new MockTcpServer();
  await mockServer.iniciar({ modoToledo: true });
  connectionManager.reiniciar();

  await test('Integração Mock TCP + captura + documento MD', async () => {
    protocolCaptureService.iniciarCaptura({
      driver: 'TOLEDO_PRIX4_UNO',
      modelo: 'Prix 4 Uno',
      ip: '127.0.0.1',
      porta: mockServer.port
    });

    const protocol = new ToledoPrix4Protocol({
      host: '127.0.0.1',
      porta: mockServer.port,
      timeout: 2000,
      tentativas: 1,
      heartbeatInterval: 0
    });
    await protocol.connect();
    const ping = frameBuilder.buildPing();
    await protocol.write(ping, { driver: 'TOLEDO_PRIX4_UNO', operacao: 'mgv7_sim' });
    await protocol.read({ timeout: 2000 });
    await protocol.disconnect();

    const parada = protocolCaptureService.pararCaptura();
    assert.ok(parada.sessao.quantidade_pacotes >= 2);

    const doc = protocolCaptureService.atualizarDocumentacao([parada.sessao]);
    assert.ok(fs.existsSync(doc.caminho));
    assert.ok(doc.caminho === caminhoProtocoloMd() || doc.caminho.endsWith('PROTOCOLO_TOLEDO.md'));
  });

  if (exportId) {
    try {
      const { diretorioCapturas } = require('../../backend/motores/equipamentos/engenharia-reversa/paths');
      const dir = diretorioCapturas();
      ['.json', '.hex.txt', '.txt', '.csv', '.wireshark.txt', '.bin'].forEach((ext) => {
        const f = path.join(dir, `${exportId}${ext}`);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    } catch (_) { /* cleanup */ }
  }

  await mockServer.parar();

  console.log(`\n--- Resultado: ${passou} OK, ${falhou} FALHOU ---\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
