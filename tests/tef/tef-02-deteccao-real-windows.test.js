/**
 * TEF-02 — Teste real no Windows: detecção PPC-920/930 / COM.
 * Executar: node tests/tef/tef-02-deteccao-real-windows.test.js
 */
const assert = require('assert');
const sdkDetector = require('../../backend/services/tef/sdkDetector');
const { textoIndicaPpc930 } = require('../../backend/services/tef/pinpads/detectarPpc930');

if (process.platform !== 'win32') {
  console.log('=== TEF-02 REAL WINDOWS: ignorado (não é win32) ===');
  process.exit(0);
}

console.log('=== TEF-02 — DETECÇÃO REAL WINDOWS ===\n');

const portas = sdkDetector.listarPortasCOM();
console.log('Portas enumeradas:');
portas.forEach((p) => {
  console.log(`  - ${p.porta}: ${p.nome || p.descricao}`);
});

const deteccao = sdkDetector.detectarGertecPPC930({ portaConfigurada: 'COM4' });
console.log('\nResultado detectarGertecPPC930:');
console.log(JSON.stringify({
  detectado: deteccao.detectado,
  estado: deteccao.estado,
  porta: deteccao.porta,
  driver: deteccao.driver,
  usb: deteccao.usb,
  driverStatus: deteccao.driverStatus,
  usbStatus: deteccao.usbStatus,
  fonteDeteccao: deteccao.fonteDeteccao,
  dispositivo: deteccao.dispositivo,
  portasProvaveis: deteccao.portasProvaveis
}, null, 2));

const temPpcNoWindows = portas.some((p) => textoIndicaPpc930(`${p.nome} ${p.descricao}`));

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

test('driver não é false sem evidência', () => {
  assert.notStrictEqual(deteccao.driver, false);
});

test('usb não é false sem evidência', () => {
  assert.notStrictEqual(deteccao.usb, false);
});

if (temPpcNoWindows) {
  test('Windows apresenta PPC-920/930 → detectado=true', () => {
    assert.strictEqual(deteccao.detectado, true, 'deveria detectar PPC930 quando Windows lista o dispositivo');
  });

  test('porta do dispositivo confirmado está preenchida', () => {
    assert.ok(deteccao.porta, 'porta deveria estar preenchida');
    assert.ok(/^COM\d+$/i.test(deteccao.porta));
  });

  const com4Ppc = portas.find((p) =>
    String(p.porta).toUpperCase() === 'COM4' && textoIndicaPpc930(`${p.nome} ${p.descricao}`)
  );
  if (com4Ppc) {
    test('cenário atual COM4 → porta=COM4', () => {
      assert.strictEqual(String(deteccao.porta).toUpperCase(), 'COM4');
    });
  }
} else {
  console.log('\n  AVISO: nenhum PPC-920/930 listado neste Windows — testes de presença omitidos.');
  test('sem equipamento: detectado=false com estados semânticos', () => {
    assert.strictEqual(deteccao.detectado, false);
    assert.strictEqual(deteccao.driver, null);
    assert.strictEqual(deteccao.usb, null);
  });
}

console.log(`\n=== RESULTADO TEF-02 REAL: ${passou} passou, ${falhou} falhou ===`);
process.exit(falhou > 0 ? 1 : 0);
