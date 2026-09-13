/**
 * Testes — MiipPipeline (MIIP) — Sprint 2 Pipeline
 * Executar: node tests/miip/miip-pipeline.test.js
 */

const assert = require('assert');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const MiipPipeline = require('../../backend/motores/miip/core/MiipPipeline').MiipPipeline;
const MiipRequest = require('../../backend/motores/miip/core/MiipRequest');
const MiipExecutionState = require('../../backend/motores/miip/core/MiipExecutionState');
const MiipCandidateCollection = require('../../backend/motores/miip/core/MiipCandidateCollection');
const { MiipPipelineMetricsCollector } = require('../../backend/motores/miip/core/MiipPipelineMetricsCollector');

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
  console.log('\n=== Testes MiipPipeline — MIIP (Sprint 2 Pipeline) ===\n');

  await test('pipeline executa fluxo completo sem engines', async () => {
    const metrics = new MiipPipelineMetricsCollector();
    const pipeline = new MiipPipeline({ metricsCollector: metrics });

    const response = await pipeline.executar(MiipRequest.create({
      item: { produtoNome: 'Item teste', codigoBarras: '7891234567890' },
      contexto: { origem: 'compra' }
    }));

    assert.strictEqual(response.sucesso, true);
    assert.ok(response.requestId);
    assert.ok(response.resultado);
    assert.strictEqual(response.execution.estado, MiipExecutionState.FINALIZADO);
    assert.ok(response.execution.timeline.listar().length >= 10);
    assert.strictEqual(metrics.obterResumo().totalExecucoes, 1);
  });

  await test('MiipCandidateCollection ordena e ranqueia', () => {
    const colecao = new MiipCandidateCollection();
    colecao.adicionar({ produtoId: 1, scoreTotal: 50 });
    colecao.adicionar({ produtoId: 2, scoreTotal: 90 });
    colecao.adicionar({ produtoId: 3, scoreTotal: 70 });

    const ranking = colecao.ranking();
    assert.strictEqual(ranking[0].produtoId, 2);
    assert.strictEqual(ranking[0].ranking, 1);
    assert.strictEqual(ranking[1].produtoId, 3);
  });

  await test('MiipCandidateCollection elimina duplicados por produtoId', () => {
    const colecao = new MiipCandidateCollection();
    colecao.adicionar({ produtoId: 10, scoreTotal: 60, motoresQueVotaram: ['motor_a'] });
    colecao.adicionar({ produtoId: 10, scoreTotal: 80, motoresQueVotaram: ['motor_b'] });

    const consolidada = colecao.eliminarDuplicados();
    assert.strictEqual(consolidada.total(), 1);
    assert.strictEqual(consolidada.melhor().scoreTotal, 80);
  });

  await test('engineExecutor injetado é único caminho para candidatos', async () => {
    let executorChamado = false;

    const pipeline = new MiipPipeline({
      resolverEngines: () => [{ codigo: 'motor_teste', prioridade: 1 }],
      engineExecutor: async () => {
        executorChamado = true;
        return [{ produtoId: 99, scoreTotal: 100, motoresQueVotaram: ['motor_teste'] }];
      }
    });

    const response = await pipeline.executar(MiipRequest.create({
      item: { produtoNome: 'Com engine mock' },
      contexto: { origem: 'api' }
    }));

    assert.strictEqual(executorChamado, true);
    assert.strictEqual(response.resultado.candidatos.length, 1);
    assert.strictEqual(response.resultado.candidatos[0].produtoId, 99);
  });

  await test('decisionBuilder aplica regras Sprint 3 (auto_vincular)', async () => {
    const pipeline = new MiipPipeline({
      engineExecutor: async () => {
        const lista = [{
          produtoId: 5,
          scoreTotal: 100,
          confianca: 'ALTA',
          motoresQueVotaram: ['motor_gtin'],
          evidencias: [{ tipo: 'gtin_exato', score: 100, motor: 'motor_gtin' }]
        }];
        lista._meta = { produtosPorMotor: [5] };
        return lista;
      }
    });

    const response = await pipeline.executar(MiipRequest.create({
      item: { produtoNome: 'Teste decisão', codigoBarras: '7891234567890' }
    }));

    assert.strictEqual(response.resultado.decisao.regrasAplicadas, true);
    assert.strictEqual(response.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.ok(response.resultado.decisao.melhorCandidato);
  });

  await test('candidato incompatível descartado não influencia DecisionEngine', async () => {
    const pipeline = new MiipPipeline({
      engineExecutor: async () => {
        // Simula saída pós-CompatibilityGuard: MUBC achou, Guard descartou tudo
        const lista = [];
        lista._meta = {
          produtosPorMotor: [null],
          compatibilityDiagnostico: {
            quantidadeCandidatosEncontrados: 1,
            quantidadeCandidatosCompativeis: 0,
            quantidadeCandidatosBloqueados: 1,
            candidatosBloqueados: [{
              produtoId: 999001,
              nome: 'Passa Fio com Alma de Aço 20m Cortag',
              motivos: ['Tipo de produto incompatível']
            }]
          }
        };
        return lista;
      }
    });

    const response = await pipeline.executar(MiipRequest.create({
      item: {
        produtoNome: 'FACA DE ACO INOXIDAVEL COM CABO DE PLASTICO 16',
        ncm: '82014000'
      }
    }));

    assert.strictEqual(response.resultado.candidatos.length, 0);
    assert.ok(!response.resultado.decisao?.melhorCandidato);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
