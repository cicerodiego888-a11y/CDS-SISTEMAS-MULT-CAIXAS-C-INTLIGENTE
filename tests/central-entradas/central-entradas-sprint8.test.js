/**
 * Testes — Central de Entradas Sprint 8 (automação)
 * Executar: npm run test:central-entradas-sprint8
 */

const assert = require('assert');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralConfigService = require('../../backend/motores/central-entradas/services/CentralConfigService');
const centralSyncExecucao = require('../../backend/motores/central-entradas/services/CentralSyncExecucaoService');
const CentralEventosService = require('../../backend/motores/central-entradas/services/CentralEventosService');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

let passou = 0;
let falhou = 0;

const service = new CentralEntradasService();
const configService = new CentralConfigService();
const eventosService = new CentralEventosService();

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
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
  console.log('\n=== Testes Central de Entradas — Sprint 8 ===\n');

  await test('health retorna sprint RC2 com servicoAtivo', async () => {
    const health = await service.obterHealth();
    assert.ok(/^RC[2-9]$/.test(health.sprint), `health.sprint: ${health.sprint}`);
    assert.ok(/rc[2-9]/.test(health.versao), `versao inesperada: ${health.versao}`);
    assert.ok('servicoAtivo' in health);
    assert.ok('ultimaSincronizacao' in health);
    assert.ok('tempoMedioSyncMs' in health);
  });

  await test('obterConfiguracoes retorna campos esperados', async () => {
    const cfg = await service.obterConfiguracoes();
    assert.ok('syncAutomaticaHabilitada' in cfg);
    assert.ok('syncIntervaloMinutos' in cfg);
    assert.ok('syncAoAbrir' in cfg);
    assert.ok('syncMaxDocumentos' in cfg);
    assert.ok('horarioPermitidoInicio' in cfg);
  });

  await test('atualizarConfiguracoes persiste intervalo', async () => {
    const original = await configService.obterResumo();
    await service.atualizarConfiguracoes({ syncIntervaloMinutos: 20 });
    const atualizado = await service.obterConfiguracoes();
    assert.strictEqual(atualizado.syncIntervaloMinutos, 20);
    await service.atualizarConfiguracoes({ syncIntervaloMinutos: original.syncIntervaloMinutos });
  });

  await test('verificarHorarioPermitido retorna objeto', async () => {
    const horario = await configService.verificarHorarioPermitido();
    assert.ok(typeof horario.permitido === 'boolean');
  });

  await test('registrar evento e listar log', async () => {
    await eventosService.registrar({
      tipo: TIPOS_EVENTO.SYNC_INICIADA,
      origem: 'teste',
      descricao: 'Teste sprint 8',
      resultado: 'em_andamento'
    });

    const log = await service.listarEventos({ busca: 'Teste sprint 8', limite: 5 });
    assert.ok(log.total >= 1);
    assert.ok(log.eventos.some((e) => e.tipo === TIPOS_EVENTO.SYNC_INICIADA));
  });

  await test('mutex impede sync simultânea', async () => {
    centralSyncExecucao._executando = true;
    const resultado = await centralSyncExecucao.executar({ origem: 'manual', ignorarHorario: true });
    centralSyncExecucao._executando = false;
    assert.strictEqual(resultado.ignorado, true);
  });

  await test('obterStatusServico retorna estrutura', async () => {
    const status = service.obterStatusServico();
    assert.ok('servicoAtivo' in status);
    assert.ok('executando' in status);
    assert.ok('proximaExecucao' in status);
  });

  await test('listarNotificacoes retorna array', async () => {
    const resultado = await service.listarNotificacoes({ limite: 5 });
    assert.ok(Array.isArray(resultado.notificacoes));
    assert.ok(typeof resultado.naoLidas === 'number');
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
