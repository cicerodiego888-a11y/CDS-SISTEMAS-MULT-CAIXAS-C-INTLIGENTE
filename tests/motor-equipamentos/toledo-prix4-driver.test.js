/**
 * Testes unitários — Driver Toledo Prix 4 Uno (Sprint 6)
 * Executar: npm run test:equipamentos-toledo-prix4
 */

const assert = require('assert');
const BaseDriver = require('../../backend/motores/equipamentos/drivers/BaseDriver');
const ToledoPrix4UnoDriver = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4UnoDriver');
const ToledoPrix4Protocol = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol');
const ToledoPrix4Parser = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Parser');
const ToledoPrix4Validator = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Validator');
const ToledoPrix4Mapper = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Mapper');
const ToledoPrix4Discovery = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Discovery');
const ToledoPrix4Diagnostics = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Diagnostics');
const ToledoPrix4Constants = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Constants');
const {
  ToledoPrix4Error,
  ToledoPrix4ValidationError,
  ToledoPrix4MapperError
} = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Errors');
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
      console.error(`         ${error.message}`);
      if (error.stack) console.error(error.stack.split('\n').slice(1, 3).join('\n'));
    });
}

async function main() {
  console.log('\n=== Testes Toledo Prix 4 Uno — Sprint 6 ===\n');

  // --- Driver ---
  await test('ToledoPrix4UnoDriver passa validação de herança', () => {
    const val = BaseDriver.validarHeranca(ToledoPrix4UnoDriver);
    assert.strictEqual(val.valido, true, val.erros?.join('; '));
  });

  await test('ToledoPrix4UnoDriver metadados corretos', () => {
    const d = new ToledoPrix4UnoDriver();
    assert.strictEqual(d.fabricante(), 'Toledo');
    assert.strictEqual(d.modelo(), 'Prix 4 Uno');
    assert.ok(d.transportesSuportados().includes('ethernet'));
    const info = d.informacoes();
    assert.strictEqual(info.codigo, 'TOLEDO_PRIX4_UNO');
    assert.ok(info.firmware_conhecido.includes('90AX'));
    assert.strictEqual(info.suporta_comunicacao_real, true);
    assert.strictEqual(info.comunicacao_real, false);
  });

  await test('ToledoPrix4UnoDriver componentes instanciados', () => {
    const d = new ToledoPrix4UnoDriver();
    assert.ok(d.protocol instanceof ToledoPrix4Protocol);
    assert.ok(d.parser instanceof ToledoPrix4Parser);
    assert.ok(d.validator instanceof ToledoPrix4Validator);
    assert.ok(d.mapper instanceof ToledoPrix4Mapper);
    assert.ok(d.discovery instanceof ToledoPrix4Discovery);
    assert.ok(d.diagnostics instanceof ToledoPrix4Diagnostics);
  });

  await test('ToledoPrix4UnoDriver obterPeso via protocolo simulado', async () => {
    const mock = new MockTcpServer();
    await mock.iniciar({ modoToledo: true });
    const d = new ToledoPrix4UnoDriver({
      host: '127.0.0.1',
      porta: mock.port,
      timeout: 2000,
      heartbeatInterval: 0
    });
    await d.conectar();
    const peso = await d.obterPeso();
    assert.strictEqual(peso.comunicacao_real, true);
    assert.ok(peso.protocolo);
    await d.desconectar();
    await mock.parar();
  });

  await test('ToledoPrix4UnoDriver sincronizarProduto com DTO válido', async () => {
    const mock = new MockTcpServer();
    await mock.iniciar({ modoToledo: true });
    const d = new ToledoPrix4UnoDriver({
      host: '127.0.0.1',
      porta: mock.port,
      timeout: 2000,
      heartbeatInterval: 0
    });
    await d.conectar();
    const res = await d.sincronizarProduto({
      plu: 100,
      descricao: 'Produto Teste',
      preco: 9.99,
      pesavel: true
    });
    assert.strictEqual(res.sucesso, true);
    assert.strictEqual(res.comunicacao_real, true);
    assert.ok(res.produto);
    assert.strictEqual(res.produto.plu, '100');
    assert.strictEqual(res.produto.preco, 999);
    await d.desconectar();
    await mock.parar();
  });

  await test('ToledoPrix4UnoDriver rejeita produto inválido', async () => {
    const d = new ToledoPrix4UnoDriver();
    await assert.rejects(
      () => d.sincronizarProduto({ descricao: 'Sem PLU', preco: 1 }),
      ToledoPrix4ValidationError
    );
  });

  // --- Constants ---
  await test('ToledoPrix4Constants valores esperados', () => {
    assert.strictEqual(ToledoPrix4Constants.FABRICANTE, 'Toledo');
    assert.strictEqual(ToledoPrix4Constants.MODELO, 'Prix 4 Uno');
    assert.ok(ToledoPrix4Constants.FIRMWARE_CONHECIDO.includes('90AX'));
    assert.strictEqual(ToledoPrix4Constants.PORTAS_PADRAO.ethernet, 9000);
    assert.ok(ToledoPrix4Constants.TIMEOUTS.conexao > 0);
    assert.ok(ToledoPrix4Constants.COMANDOS.HANDSHAKE);
  });

  // --- Errors ---
  await test('ToledoPrix4Errors hierarquia', () => {
    const err = new ToledoPrix4ValidationError('teste', ['campo inválido']);
    assert.ok(err instanceof ToledoPrix4Error);
    assert.strictEqual(err.name, 'ToledoPrix4ValidationError');
    assert.strictEqual(err.fabricante, 'Toledo');
    assert.ok(err.erros.includes('campo inválido'));
  });

  // --- Validator ---
  await test('ToledoPrix4Validator valida produto', () => {
    const v = new ToledoPrix4Validator();
    const ok = v.validarProduto({ plu: 1, descricao: 'X', preco: 1, unidade: 'kg' });
    assert.strictEqual(ok.valido, true);
    const bad = v.validarProduto({ descricao: 'X', preco: 1 });
    assert.strictEqual(bad.valido, false);
  });

  await test('ToledoPrix4Validator valida promoção', () => {
    const v = new ToledoPrix4Validator();
    const ok = v.validarPromocao({ plu: 1, precoPromocional: 5 });
    assert.strictEqual(ok.valido, true);
  });

  await test('ToledoPrix4Validator valida departamento', () => {
    const v = new ToledoPrix4Validator();
    const ok = v.validarDepartamento({ codigo: 1, nome: 'Hortifruti' });
    assert.strictEqual(ok.valido, true);
  });

  await test('ToledoPrix4Validator valida etiqueta', () => {
    const v = new ToledoPrix4Validator();
    const ok = v.validarEtiqueta({ layout: 'padrao' });
    assert.strictEqual(ok.valido, true);
  });

  await test('ToledoPrix4Validator valida peso', () => {
    const v = new ToledoPrix4Validator();
    const ok = v.validarPeso({ valor: 1.5, unidade: 'kg' });
    assert.strictEqual(ok.valido, true);
  });

  // --- Mapper ---
  await test('ToledoPrix4Mapper converte ProdutoDTO', () => {
    const m = new ToledoPrix4Mapper();
    const toledo = m.mapProduto({ plu: 42, descricao: 'Maçã', preco: 7.5 });
    assert.strictEqual(toledo.plu, '42');
    assert.strictEqual(toledo.preco, 750);
    assert.strictEqual(toledo.precoOriginal, 7.5);
  });

  await test('ToledoPrix4Mapper converte PromocaoDTO', () => {
    const m = new ToledoPrix4Mapper();
    const toledo = m.mapPromocao({ plu: 10, precoPromocional: 4.99 });
    assert.strictEqual(toledo.precoPromocional, 499);
  });

  await test('ToledoPrix4Mapper converte DepartamentoDTO', () => {
    const m = new ToledoPrix4Mapper();
    const toledo = m.mapDepartamento({ codigo: 3, nome: 'Açougue' });
    assert.strictEqual(toledo.codigo, '3');
    assert.strictEqual(toledo.nome, 'Açougue');
  });

  await test('ToledoPrix4Mapper rejeita entrada inválida', () => {
    const m = new ToledoPrix4Mapper();
    assert.throws(() => m.mapProduto(null), ToledoPrix4MapperError);
  });

  // --- Protocol ---
  await test('ToledoPrix4Protocol comandos usam infraestrutura 11A', async () => {
    const mock = new MockTcpServer();
    await mock.iniciar({ modoToledo: true });
    const p = new ToledoPrix4Protocol({
      host: '127.0.0.1',
      porta: mock.port,
      timeout: 2000,
      heartbeatInterval: 0
    });
    await p.connect();
    const hs = await p.handshake();
    assert.strictEqual(hs.comunicacao_real, true);
    assert.strictEqual(hs.sucesso, true);
    const prod = await p.enviarProduto({ plu: '1' });
    assert.strictEqual(prod.sucesso, true);
    await p.disconnect();
    await mock.parar();
  });

  // --- Parser ---
  await test('ToledoPrix4Parser parseFrame e parseACK', () => {
    const parser = new ToledoPrix4Parser();
    const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder');
    const ack = frameBuilder.buildAck({ teste: true });
    const frame = parser.parseFrame(ack);
    assert.strictEqual(frame.tipo, 'ACK');
    const parsed = parser.parseACK(ack);
    assert.strictEqual(parsed.ack, true);
  });

  await test('ToledoPrix4Parser parsePeso retorna estrutura', () => {
    const parser = new ToledoPrix4Parser();
    const peso = parser.parsePeso('');
    assert.strictEqual(peso.simulado, true);
    assert.strictEqual(peso.unidade, 'kg');
  });

  // --- Discovery ---
  await test('ToledoPrix4Discovery descobrir retorna array vazio', async () => {
    const disc = new ToledoPrix4Discovery();
    const lista = await disc.descobrir();
    assert.ok(Array.isArray(lista));
    assert.strictEqual(lista.length, 0);
    const prep = disc.prepararVarreduraEthernet();
    assert.strictEqual(prep.implementado, false);
  });

  // --- Diagnostics ---
  await test('ToledoPrix4Diagnostics executar retorna relatório', async () => {
    const d = new ToledoPrix4UnoDriver();
    const diag = await d.diagnostics.executar();
    assert.strictEqual(diag.simulado, true);
    assert.ok(diag.relatorio);
    assert.ok(diag.relatorio.componentes.protocol);
  });

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
