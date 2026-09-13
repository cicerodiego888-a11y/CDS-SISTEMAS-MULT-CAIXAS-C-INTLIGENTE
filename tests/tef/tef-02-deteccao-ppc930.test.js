/**
 * TEF-02 — Detecção Gertec PPC930
 * Executar: node tests/tef/tef-02-deteccao-ppc930.test.js
 */
const assert = require('assert');
const {
  textoIndicaPpc930,
  classificarDeteccaoPpc930,
  ESTADO_DETECCAO
} = require('../../backend/services/tef/pinpads/detectarPpc930');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

console.log('=== TEF-02 — DETECÇÃO GERTEC PPC930 ===\n');

const VARIANTES_POSITIVAS = [
  'PPC930',
  'PPC-930',
  'PPC 930',
  'PPC-920/930',
  'PPC-920/930 CDC USB-to-Serial Port',
  'PPC-920/930 CDC USB-to-Serial Port (COM4)',
  'PPC 920/930',
  'PPC920/930',
  'Gertec PPC930',
  'GERTEC PPC-930'
];

VARIANTES_POSITIVAS.forEach((nome) => {
  test(`reconhece variante: ${nome}`, () => {
    assert.strictEqual(textoIndicaPpc930(nome), true, `deveria reconhecer: ${nome}`);
  });
});

const FALSOS_POSITIVOS = [
  'USB Serial Device (COM4)',
  'USB-SERIAL CH340 (COM4)',
  'FTDI USB Serial Port (COM4)',
  'Bluetooth Serial Port (COM4)',
  'Arduino Uno (COM3)',
  'Prolific USB-to-Serial Comm Port (COM5)',
  'Communications Port (COM1)'
];

FALSOS_POSITIVOS.forEach((nome) => {
  test(`rejeita falso positivo: ${nome}`, () => {
    assert.strictEqual(textoIndicaPpc930(nome), false, `não deveria reconhecer: ${nome}`);
    const r = classificarDeteccaoPpc930([{ porta: 'COM4', nome, descricao: nome }]);
    assert.strictEqual(r.detectado, false);
    assert.strictEqual(r.dispositivoConfirmado, false);
  });
});

test('COM4 genérica sozinha NÃO confirma PPC930', () => {
  const r = classificarDeteccaoPpc930([
    { porta: 'COM4', nome: 'USB Serial Device (COM4)', descricao: 'USB Serial Device' }
  ], { portaConfigurada: 'COM4' });
  assert.strictEqual(r.detectado, false);
  assert.strictEqual(r.estado, ESTADO_DETECCAO.PARCIAL);
  assert.strictEqual(r.fonteDeteccao, 'configured_port');
});

test('PPC-920/930 em COM4 → detectado=true porta=COM4', () => {
  const r = classificarDeteccaoPpc930([
    {
      porta: 'COM4',
      nome: 'PPC-920/930 CDC USB-to-Serial Port (COM4)',
      descricao: 'PPC-920/930 CDC USB-to-Serial Port'
    }
  ]);
  assert.strictEqual(r.detectado, true);
  assert.strictEqual(r.porta, 'COM4');
  assert.strictEqual(r.dispositivoConfirmado, true);
  assert.strictEqual(r.fonteDeteccao, 'windows_serial');
  assert.strictEqual(r.estado, ESTADO_DETECCAO.DETECTADO);
  assert.ok(r.portasProvaveis.length >= 1);
  assert.strictEqual(r.portasProvaveis[0].porta, 'COM4');
});

test('PPC-920/930 em COM7 → detectado=true porta=COM7 (não preso ao COM4)', () => {
  const r = classificarDeteccaoPpc930([
    {
      porta: 'COM7',
      nome: 'PPC-920/930 CDC USB-to-Serial Port (COM7)',
      descricao: 'PPC-920/930 CDC USB-to-Serial Port'
    }
  ]);
  assert.strictEqual(r.detectado, true);
  assert.strictEqual(r.porta, 'COM7');
});

test('sem equipamento → detectado=false e driver/usb null (não false)', () => {
  const r = classificarDeteccaoPpc930([], {
    verificacaoDriverDisponivel: true,
    verificacaoUsbDisponivel: true
  });
  assert.strictEqual(r.detectado, false);
  assert.strictEqual(r.estado, ESTADO_DETECCAO.NAO_DETECTADO);
  assert.strictEqual(r.driver, null);
  assert.strictEqual(r.usb, null);
  assert.notStrictEqual(r.driver, false);
  assert.notStrictEqual(r.usb, false);
  assert.strictEqual(r.driverStatus, 'nao_confirmado');
  assert.strictEqual(r.usbStatus, 'nao_confirmado');
});

test('driver confirmado somente com evidência positiva', () => {
  const r = classificarDeteccaoPpc930([
    { porta: 'COM4', nome: 'PPC-920/930 CDC USB-to-Serial Port (COM4)', descricao: '' }
  ], { driverConfirmado: true });
  assert.strictEqual(r.detectado, true);
  assert.strictEqual(r.driver, true);
  assert.strictEqual(r.driverStatus, 'confirmado');
});

test('não altera configuração — apenas informa', () => {
  const portaConfigurada = 'COM4';
  const r = classificarDeteccaoPpc930([
    { porta: 'COM7', nome: 'PPC-920/930 CDC USB-to-Serial Port (COM7)', descricao: '' }
  ], { portaConfigurada });
  assert.strictEqual(r.porta, 'COM7');
  assert.strictEqual(portaConfigurada, 'COM4', 'opção de entrada não deve ser mutada');
});

test('case-insensitive', () => {
  assert.strictEqual(textoIndicaPpc930('ppc-920/930 cdc usb-to-serial port'), true);
  assert.strictEqual(textoIndicaPpc930('Ppc930'), true);
});

console.log(`\n=== RESULTADO TEF-02 UNITÁRIO: ${passou} passou, ${falhou} falhou ===`);
process.exit(falhou > 0 ? 1 : 0);
