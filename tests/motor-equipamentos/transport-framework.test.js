/**
 * Testes — Camada de Transporte do Motor Equipamentos (Sprint 5)
 * Executar: npm run test:equipamentos-transport
 */

const assert = require('assert');

const BaseTransport = require('../../backend/motores/equipamentos/transport/BaseTransport');
const MockTransport = require('../../backend/motores/equipamentos/transport/MockTransport');
const EthernetTransport = require('../../backend/motores/equipamentos/transport/EthernetTransport');
const SerialTransport = require('../../backend/motores/equipamentos/transport/SerialTransport');
const transportManager = require('../../backend/motores/equipamentos/transport/TransportManager');

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
    });
}

async function main() {
  console.log('\n=== Testes Camada de Transporte — Sprint 5 ===\n');

  await test('BaseTransport não pode ser instanciada diretamente', () => {
    assert.throws(() => new BaseTransport(), /abstrata/);
  });

  await test('MockTransport passa validação de herança', () => {
    const v = BaseTransport.validarHeranca(MockTransport);
    assert.strictEqual(v.valido, true, v.erros?.join('; '));
  });

  await test('EthernetTransport passa validação de herança', () => {
    const v = BaseTransport.validarHeranca(EthernetTransport);
    assert.strictEqual(v.valido, true, v.erros?.join('; '));
  });

  await test('SerialTransport passa validação de herança', () => {
    const v = BaseTransport.validarHeranca(SerialTransport);
    assert.strictEqual(v.valido, true, v.erros?.join('; '));
  });

  transportManager.reiniciar();

  await test('TransportManager carrega transportes built-in', () => {
    const rel = transportManager.carregarTodos();
    assert.ok(rel.carregados >= 5, `esperado >= 5, obtido ${rel.carregados}`);
    assert.strictEqual(rel.erros.length, 0);
  });

  await test('TransportManager lista transportes registrados', () => {
    const lista = transportManager.listar();
    const codigos = lista.map((t) => t.codigo);
    ['ethernet', 'serial', 'usb', 'bluetooth', 'mock'].forEach((c) => {
      assert.ok(codigos.includes(c), `ausente: ${c}`);
    });
  });

  await test('TransportManager.selecionar instancia MockTransport', () => {
    const t = transportManager.selecionar('mock', { latenciaMs: 0 });
    assert.ok(t instanceof MockTransport);
    assert.strictEqual(t.tipo(), 'mock');
  });

  await test('TransportManager rejeita transporte inválido no registro', () => {
    class TransporteInvalido {}
    assert.throws(() => transportManager.registrar({ codigo: 'x', Classe: TransporteInvalido }));
  });

  await test('MockTransport conecta e desconecta (simulado)', async () => {
    const t = new MockTransport();
    const conn = await t.conectar();
    assert.strictEqual(conn.simulado, true);
    assert.strictEqual(conn.comunicacao_real, false);
    assert.strictEqual(t.estaConectado(), true);
    const disc = await t.desconectar();
    assert.strictEqual(disc.conectado, false);
    assert.strictEqual(t.estaConectado(), false);
  });

  await test('MockTransport envia e recebe dados simulados', async () => {
    const t = new MockTransport({ respostasSimuladas: ['OK'] });
    await t.conectar();
    const env = await t.enviar('PING');
    assert.strictEqual(env.bytes, 4);
    assert.strictEqual(t.obterFilaEnvio().length, 1);
    const rec = await t.receber();
    assert.strictEqual(rec.dados, 'OK');
    await t.desconectar();
  });

  await test('MockTransport falha envio sem conexão', async () => {
    const t = new MockTransport();
    await assert.rejects(() => t.enviar('X'), /não conectado/);
  });

  await test('EthernetTransport conecta com comunicação real (requer servidor TCP)', async () => {
    const MockTcpServer = require('./helpers/MockTcpServer');
    const server = new MockTcpServer();
    await server.iniciar();
    try {
      const t = new EthernetTransport({ host: '127.0.0.1', porta: server.port, timeout: 2000 });
      const conn = await t.conectar();
      assert.strictEqual(conn.comunicacao_real, true);
      assert.strictEqual(t.estaConectado(), true);
      await t.desconectar();
    } finally {
      await server.parar();
    }
  });

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
