/**
 * Testes — EquipamentosService (Sprint 9)
 * Executar: npm run test:equipamentos-service
 */

const assert = require('assert');
const equipamentosService = require('../../backend/motores/equipamentos/services/EquipamentosService');
const equipamentosRepository = require('../../backend/motores/equipamentos/repositories/EquipamentosRepository');
const MockTcpServer = require('./helpers/MockTcpServer');

let passou = 0;
let falhou = 0;
let mockServer;
let equipamentoTesteId = null;

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
  console.log('\n=== Testes EquipamentosService — Sprint 9 ===\n');

  mockServer = new MockTcpServer();
  await mockServer.iniciar();

  await test('formatarParaApi normaliza status', () => {
    const fmt = equipamentosService.formatarParaApi({ id: 1, nome: 'X', status: 'online' });
    assert.strictEqual(fmt.status_label, 'Online');
    const desc = equipamentosService.formatarParaApi({ status: 'desconhecido' });
    assert.strictEqual(desc.status_label, 'Desconhecido');
  });

  await test('criar equipamento balança', async () => {
    const eq = await equipamentosService.criar({
      nome: `Teste Sprint9 ${Date.now()}`,
      tipo: 'balanca',
      transporte: 'ethernet',
      ip: '127.0.0.1',
      porta_tcp: mockServer.port,
      timeout_ms: 3000,
      reconnect_auto: true,
      fabricante: 'Toledo',
      modelo: 'Prix 4 Uno',
      driver_codigo: 'TOLEDO_PRIX4_UNO'
    });
    assert.ok(eq.id);
    equipamentoTesteId = eq.id;
    assert.strictEqual(eq.tipo, 'balanca');
  });

  await test('listar com filtro busca', async () => {
    const lista = await equipamentosService.listar({ todos: '1', tipo: 'balanca', busca: 'Teste Sprint9' });
    assert.ok(lista.length >= 1);
  });

  await test('editar equipamento', async () => {
    const eq = await equipamentosService.editar(equipamentoTesteId, { observacao: 'editado sprint9' });
    assert.strictEqual(eq.observacao, 'editado sprint9');
  });

  await test('testarConexao mantém sessão TCP persistente', async () => {
    const res = await equipamentosService.testarConexao(equipamentoTesteId);
    assert.strictEqual(res.comunicacao_real, true);
    assert.strictEqual(res.sucesso, true);
    assert.ok(/persistente|reutilizada|estabelecida/i.test(res.mensagem));
    assert.strictEqual(res.conexao.conectado, true);
    assert.strictEqual(res.conexao.persistente, true);
  });

  await test('diagnosticarEquipamento retorna campos obrigatórios', async () => {
    const diag = await equipamentosService.diagnosticarEquipamento(equipamentoTesteId);
    assert.ok(diag.diagnostico);
    assert.ok('ping' in diag.diagnostico);
    assert.ok('porta' in diag.diagnostico);
    assert.ok('transporte' in diag.diagnostico);
    assert.ok('versao_driver' in diag.diagnostico);
  });

  await test('duplicar equipamento', async () => {
    const copia = await equipamentosService.duplicar(equipamentoTesteId);
    assert.ok(copia.id);
    assert.ok(copia.nome.includes('cópia'));
    await equipamentosService.remover(copia.id);
  });

  await test('desativar e ativar equipamento', async () => {
    await equipamentosService.desativar(equipamentoTesteId);
    let eq = await equipamentosService.buscarPorId(equipamentoTesteId);
    assert.strictEqual(eq.ativo, false);
    await equipamentosService.ativar(equipamentoTesteId);
    eq = await equipamentosService.buscarPorId(equipamentoTesteId);
    assert.strictEqual(eq.ativo, true);
  });

  await test('obterResumo inclui pendentes', async () => {
    const resumo = await equipamentosService.obterResumo();
    assert.ok('pendentes' in resumo);
    assert.ok('online' in resumo);
  });

  if (equipamentoTesteId) {
    await equipamentosService.remover(equipamentoTesteId);
  }

  await mockServer.parar();

  console.log(`\n=== Resultado: ${passou} passou, ${falhou} falhou ===\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Erro fatal:', err);
  if (equipamentoTesteId) await equipamentosService.remover(equipamentoTesteId).catch(() => {});
  if (mockServer) await mockServer.parar().catch(() => {});
  process.exit(1);
});
