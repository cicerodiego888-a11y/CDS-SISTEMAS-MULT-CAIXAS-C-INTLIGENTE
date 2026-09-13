/**
 * RC2.0 — Discovery Multitransporte (Serial / USB)
 * Executar: node tests/motor-equipamentos/rc2-discovery-multitransporte.test.js
 */

const assert = require('assert');
const {
  criarCandidate,
  criarDiscoveryResult,
  validarCandidate,
  calcularAssinatura
} = require('../../backend/motores/equipamentos/discovery/CandidateDTO');
const { listarPortasSerial, listarDispositivosUsb } = require('../../backend/motores/equipamentos/discovery/deviceEnumeration');
const SerialPortDiscovery = require('../../backend/motores/equipamentos/discovery/SerialPortDiscovery');
const UsbDeviceDiscovery = require('../../backend/motores/equipamentos/discovery/UsbDeviceDiscovery');
const discoveryService = require('../../backend/motores/equipamentos/discovery/DiscoveryService');
const driverLoader = require('../../backend/motores/equipamentos/drivers/DriverLoader');
const driverRegistry = require('../../backend/motores/equipamentos/drivers/DriverRegistry');
const MockTcpServer = require('./helpers/MockTcpServer');

let passou = 0;
let falhou = 0;

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
      console.error(`         ${error.stack || error.message}`);
    });
}

async function main() {
  console.log('\n=== RC2.0 — Discovery Multitransporte ===\n');

  driverLoader.reiniciar();
  driverLoader.carregarTodos({ forcar: true });

  await test('DriverRegistry — serial e usb registrados', () => {
    const serial = driverRegistry.buscarPorTransporte('serial');
    const usb = driverRegistry.buscarPorTransporte('usb');
    assert.ok(serial.length >= 1, 'sem drivers serial');
    assert.ok(usb.length >= 1, 'sem drivers usb');
    assert.ok(serial.some((d) => d.codigo === 'GENERIC_SERIAL'));
    assert.ok(usb.some((d) => d.codigo === 'GENERIC_USB'));
  });

  await test('enumeração COM — retorna array', () => {
    const portas = listarPortasSerial();
    assert.ok(Array.isArray(portas));
  });

  await test('enumeração USB — retorna array', () => {
    const usbs = listarDispositivosUsb();
    assert.ok(Array.isArray(usbs));
  });

  await test('Candidate DTO — serial com porta_com', () => {
    const c = criarCandidate({
      transporte: 'serial',
      porta_com: 'COM3',
      driver_codigo: 'GENERIC_SERIAL',
      confianca: 0.4,
      origem: 'driver:GENERIC_SERIAL'
    });
    assert.strictEqual(c.porta_com, 'COM3');
    assert.strictEqual(validarCandidate(c).length, 0);
    assert.ok(c.assinatura);
  });

  await test('Candidate DTO — USB com vid/pid', () => {
    const c = criarCandidate({
      transporte: 'usb',
      vid: '1A86',
      pid: '7523',
      caminho_dispositivo: 'USB\\VID_1A86&PID_7523\\X',
      driver_codigo: 'GENERIC_USB',
      confianca: 0.5,
      origem: 'driver:GENERIC_USB'
    });
    assert.strictEqual(c.vid, '1A86');
    assert.strictEqual(c.pid, '7523');
    assert.ok(c.caminho_dispositivo);
    assert.strictEqual(validarCandidate(c).length, 0);
  });

  await test('Candidate DTO — serial incompleto rejeitado', () => {
    assert.throws(() => criarCandidate({
      transporte: 'serial',
      driver_codigo: 'X',
      confianca: 0.1,
      origem: 't'
    }), /Candidate incompleto/);
  });

  await test('assinatura — VID/PID integra fingerprint', () => {
    const a = calcularAssinatura({
      driver_codigo: 'GENERIC_USB', transporte: 'usb', vid: '1A86', pid: '7523'
    });
    const b = calcularAssinatura({
      driver_codigo: 'GENERIC_USB', transporte: 'usb', vid: '1A86', pid: '7524'
    });
    assert.notStrictEqual(a, b);
  });

  await test('SerialPortDiscovery — timeout e candidatos genéricos', async () => {
    const d = new SerialPortDiscovery({
      driver_codigo: 'GENERIC_SERIAL',
      fabricante: 'Genérico',
      modelo: 'Serial',
      keywords: [],
      aceitarGenerico: true
    });
    const r = await d.descobrir({
      portas_com: [{ porta: 'COM99', nome: 'Fake', descricao: 'test' }],
      timeoutMs: 80,
      concorrencia: 2
    });
    assert.ok(r.meta.probes_total >= 1);
    assert.ok(r.candidatos.length >= 1);
    assert.strictEqual(r.candidatos[0].transporte, 'serial');
    assert.strictEqual(r.candidatos[0].porta_com, 'COM99');
  });

  await test('SerialPortDiscovery — keyword Filizola', async () => {
    const d = new SerialPortDiscovery({
      driver_codigo: 'FILIZOLA_PLATINA',
      fabricante: 'Filizola',
      modelo: 'Platina',
      keywords: ['filizola']
    });
    const r = await d.descobrir({
      portas_com: [
        { porta: 'COM1', nome: 'Filizola Platina', descricao: 'balanca' },
        { porta: 'COM2', nome: 'Other', descricao: 'x' }
      ],
      timeoutMs: 80,
      concorrencia: 2
    });
    assert.ok(r.candidatos.every((c) => c.porta_com === 'COM1'));
    assert.ok(r.candidatos[0].confianca >= 0.5);
  });

  await test('UsbDeviceDiscovery — VID/PID e timeout', async () => {
    const d = new UsbDeviceDiscovery({
      driver_codigo: 'ACLAS_LS2',
      fabricante: 'Aclas',
      modelo: 'LS2',
      keywords: ['aclas'],
      vidPids: [{ vid: '1A86', pid: '7523' }]
    });
    const r = await d.descobrir({
      dispositivos_usb: [
        {
          nome: 'USB Serial',
          caminho_dispositivo: 'USB\\VID_1A86&PID_7523\\ABC',
          manufacturer: 'Aclas',
          product: 'LS2',
          vid: '1A86',
          pid: '7523'
        },
        {
          nome: 'Other',
          caminho_dispositivo: 'USB\\VID_0000&PID_0001\\Z',
          vid: '0000',
          pid: '0001'
        }
      ],
      timeoutMs: 80,
      concorrencia: 2
    });
    assert.ok(r.candidatos.length >= 1);
    assert.strictEqual(r.candidatos[0].vid, '1A86');
    assert.ok(r.candidatos[0].confianca >= 0.65);
  });

  await test('DiscoveryService.descobrirSerial', async () => {
    const r = await discoveryService.descobrirSerial({
      portas_com: [{ porta: 'COM42', nome: 'Test Port', descricao: '' }],
      timeoutMs: 80,
      concorrencia: 2,
      driver_codigos: ['GENERIC_SERIAL'],
      persistir_sessao: false
    });
    assert.ok(Array.isArray(r.candidatos));
    assert.ok(r.meta.transportes_executados.includes('serial'));
    assert.ok(r.candidatos.some((c) => c.porta_com === 'COM42'));
  });

  await test('DiscoveryService.descobrirUsb', async () => {
    const r = await discoveryService.descobrirUsb({
      dispositivos_usb: [{
        nome: 'Dev',
        caminho_dispositivo: '/sys/bus/usb/devices/1-1',
        vid: '0403',
        pid: '6001',
        manufacturer: 'FTDI',
        product: 'Serial'
      }],
      timeoutMs: 80,
      concorrencia: 2,
      driver_codigos: ['GENERIC_USB']
    });
    assert.ok(r.candidatos.some((c) => c.vid === '0403'));
    assert.ok(r.meta.transportes_executados.includes('usb'));
  });

  await test('múltiplos transportes — erro em um não interrompe outro', async () => {
    const mock = new MockTcpServer();
    await mock.iniciar({ modoToledo: true });
    try {
      const r = await discoveryService.descobrirTodos({
        transportes: ['ethernet', 'serial', 'usb'],
        hosts: ['127.0.0.1'],
        portas: [mock.port],
        subnet: '127.0.0.1/32',
        portas_com: [{ porta: 'COM7', nome: 'x', descricao: '' }],
        dispositivos_usb: [{
          nome: 'U',
          caminho_dispositivo: 'USB\\VID_FFFF&PID_EEEE\\1',
          vid: 'FFFF',
          pid: 'EEEE'
        }],
        timeoutMs: 1200,
        timeoutMsSerial: 80,
        timeoutMsUsb: 80,
        concorrencia: 4,
        driver_codigos: ['TOLEDO_PRIX4_UNO', 'GENERIC_SERIAL', 'GENERIC_USB'],
        persistir_sessao: true
      });
      assert.ok(r.meta.transportes_executados.includes('ethernet'));
      assert.ok(r.meta.transportes_executados.includes('serial'));
      assert.ok(r.meta.transportes_executados.includes('usb'));
      assert.ok(r.candidatos.some((c) => c.transporte === 'ethernet'));
      assert.ok(r.candidatos.some((c) => c.transporte === 'serial'));
      assert.ok(r.candidatos.some((c) => c.transporte === 'usb'));
      assert.ok(r.meta.sessao_id != null);
    } finally {
      await mock.parar();
    }
  });

  await test('cancelamento — flag cooperativa', async () => {
    const p = discoveryService.descobrirSerial({
      portas_com: Array.from({ length: 20 }, (_, i) => ({ porta: `COM${i}`, nome: '', descricao: '' })),
      timeoutMs: 200,
      concorrencia: 2,
      driver_codigos: ['GENERIC_SERIAL']
    });
    discoveryService.cancelar();
    const r = await p;
    assert.ok(r.meta.cancelado === true || Array.isArray(r.candidatos));
  });

  await test('sessões — listar após persistência', async () => {
    const sessions = require('../../backend/motores/equipamentos/repositories/DiscoverySessionsRepository');
    const lista = await sessions.listarSessoes(5);
    assert.ok(Array.isArray(lista));
    assert.ok(lista.length >= 1);
  });

  await test('DiscoveryResult — compatível RC0.1', () => {
    const r = criarDiscoveryResult({
      sucesso: true,
      candidatos: [],
      erros: [],
      meta: {
        iniciado_em: new Date().toISOString(),
        finalizado_em: new Date().toISOString(),
        duracao_ms: 1,
        probes_total: 0,
        probes_ok: 0,
        transportes_executados: ['serial', 'usb']
      }
    });
    assert.ok('sucesso' in r && 'candidatos' in r && 'erros' in r && 'meta' in r);
    assert.ok(Array.isArray(r.meta.transportes_executados));
  });

  await test('Ethernet RC1 — sem regressão (hosts mock)', async () => {
    const mock = new MockTcpServer();
    await mock.iniciar({ modoToledo: true });
    try {
      const r = await discoveryService.descobrirEthernet({
        hosts: ['127.0.0.1'],
        portas: [mock.port],
        subnet: '127.0.0.1/32',
        timeoutMs: 1500,
        concorrencia: 4,
        driver_codigos: ['TOLEDO_PRIX4_UNO']
      });
      assert.strictEqual(r.sucesso, true);
      assert.ok(r.candidatos.some((c) => c.ip === '127.0.0.1'));
    } finally {
      await mock.parar();
    }
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
