/**
 * Testes — Framework de Drivers do Motor Equipamentos (Sprint 3)
 * Executar: npm run test:equipamentos-drivers
 */

const assert = require('assert');
const BaseDriver = require('../../backend/motores/equipamentos/drivers/BaseDriver');
const driverCatalog = require('../../backend/motores/equipamentos/drivers/driverCatalog');
const driverRegistry = require('../../backend/motores/equipamentos/drivers/DriverRegistry');
const driverLoader = require('../../backend/motores/equipamentos/drivers/DriverLoader');
const ToledoPrix4UnoDriver = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4UnoDriver');

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
      console.error(`         ${error.message}`);
      if (error.stack) console.error(error.stack.split('\n').slice(1, 3).join('\n'));
    });
}

async function main() {
  console.log('\n=== Testes Framework Drivers — Motor Equipamentos ===\n');

  await test('BaseDriver não pode ser instanciada diretamente', () => {
    assert.throws(() => new BaseDriver(), /abstrata/);
  });

  await test('ToledoPrix4UnoDriver passa validação de herança', () => {
    const val = BaseDriver.validarHeranca(ToledoPrix4UnoDriver);
    assert.strictEqual(val.valido, true, val.erros?.join('; '));
  });

  await test('ToledoPrix4UnoDriver implementa métodos obrigatórios', () => {
    const d = new ToledoPrix4UnoDriver();
    assert.strictEqual(d.fabricante(), 'Toledo');
    assert.strictEqual(d.modelo(), 'Prix 4 Uno');
    assert.ok(Array.isArray(d.transportesSuportados()));
    assert.ok(d.informacoes().codigo);
  });

  await test('Catálogo contém Toledo Prix 4 Uno', () => {
    const item = driverCatalog.buscarNoCatalogo('TOLEDO_PRIX4_UNO');
    assert.ok(item);
    assert.strictEqual(item.fabricante, 'Toledo');
    assert.ok(item.protocolos.includes('toledo-prix4'));
    assert.ok(item.transportes.includes('ethernet'));
  });

  await test('Catálogo busca por fabricante Toledo', () => {
    const lista = driverCatalog.buscarPorFabricante('Toledo');
    assert.ok(lista.length >= 1);
  });

  await test('Catálogo busca por transporte serial', () => {
    const lista = driverCatalog.buscarPorTransporte('serial');
    assert.ok(lista.length >= 3);
  });

  driverRegistry.limpar();
  driverLoader.reiniciar();

  await test('DriverRegistry registra ToledoPrix4UnoDriver', () => {
    const reg = driverRegistry.registrar({
      codigo: 'TOLEDO_PRIX4_UNO',
      Classe: ToledoPrix4UnoDriver
    });
    assert.strictEqual(reg.codigo, 'TOLEDO_PRIX4_UNO');
    assert.strictEqual(reg.fabricante, 'Toledo');
  });

  await test('DriverRegistry busca por fabricante e modelo', () => {
    const item = driverRegistry.buscar('toledo:prix 4 uno');
    assert.ok(item);
    assert.strictEqual(item.codigo, 'TOLEDO_PRIX4_UNO');
  });

  await test('DriverRegistry instancia driver', () => {
    const inst = driverRegistry.instanciar('TOLEDO_PRIX4_UNO');
    assert.ok(inst instanceof ToledoPrix4UnoDriver);
  });

  await test('DriverRegistry buscarPorTransporte ethernet', () => {
    const lista = driverRegistry.buscarPorTransporte('ethernet');
    assert.ok(lista.some((d) => d.codigo === 'TOLEDO_PRIX4_UNO'));
  });

  driverRegistry.limpar();
  driverLoader.reiniciar();

  await test('DriverLoader carrega drivers do catálogo com módulo', () => {
    const rel = driverLoader.carregarTodos({ forcar: true });
    assert.ok(rel.carregados.length >= 1);
    assert.ok(rel.carregados.some((d) => d.codigo === 'TOLEDO_PRIX4_UNO'));
    assert.strictEqual(rel.erros.length, 0);
  });

  await test('DriverLoader relatório contém metadados', () => {
    const rel = driverLoader.obterRelatorio();
    assert.ok(rel.timestamp);
    assert.ok(rel.total_catalogo >= 6);
  });

  await test('DriverRegistry listarComCatalogo marca implementado', () => {
    const lista = driverRegistry.listarComCatalogo();
    const toledo = lista.find((d) => d.codigo === 'TOLEDO_PRIX4_UNO');
    assert.ok(toledo);
    assert.strictEqual(toledo.implementado, true);
    assert.strictEqual(toledo.registrado, true);
  });

  await test('ToledoPrix4UnoDriver zerar/reiniciar e discovery oficiais', async () => {
    const d = new ToledoPrix4UnoDriver();
    const zerar = await d.zerar();
    assert.strictEqual(zerar.simulado, true);
    assert.strictEqual(zerar.comunicacao_real, false);

    const reiniciar = await d.reiniciar();
    assert.strictEqual(reiniciar.simulado, true);
    assert.strictEqual(reiniciar.comunicacao_real, false);

    assert.strictEqual(typeof d.descobrir, 'function');
    assert.strictEqual(d.informacoes().oficial, true);
  });

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
