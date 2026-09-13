/**
 * Testes — Ciclo completo MiipService → Pipeline → MotorGTIN (Sprint 3)
 * Executar: npm run test:miip-gtin-pipeline
 */

const assert = require('assert');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const { MiipOrchestrator } = require('../../backend/motores/miip/MiipOrchestrator');
const { criarPipelinePadrao } = require('../../backend/motores/miip/core/MiipPipelineFactory');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');
const MotorGTIN = require('../../backend/motores/miip/engines/gtin/MotorGTIN');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const MiipConfidence = require('../../backend/motores/miip/core/MiipConfidence');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');

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

function criarRepositoryMock(produto) {
  return {
    async buscarPorGtin(gtin) {
      if (!produto) return null;
      if (produto.codigo_barras !== gtin) return null;
      return ProdutoSnapshot.fromRow(produto);
    }
  };
}

function criarServiceComPipelineGtin(produto) {
  const registry = new MotorRegistry();
  const produtoRepository = criarRepositoryMock(produto ?? null);

  registry.registrar({
    codigo: 'motor_gtin',
    Classe: MotorGTIN,
    ativo: true,
    prioridade: 10,
    meta: {
      config: { produtoRepository }
    }
  });

  const pipeline = criarPipelinePadrao({
    motorRegistry: registry,
    configuracoesRepository: {
      async buscarPorChave() {
        return null;
      }
    }
  });

  const orchestrator = new MiipOrchestrator({ pipeline });
  const featureFlags = new MiipFeatureFlags();

  return new MiipService({
    orchestrator,
    inicializar: () => {},
    featureFlags,
    integracaoLog: new MiipIntegracaoLogService(),
    configuracoesRepository: {
      async buscarPorChave() {
        return null;
      },
      parseValor() {
        return true;
      }
    }
  });
}

async function main() {
  console.log('\n=== Testes E2E — MiipService → Pipeline → MotorGTIN (Sprint 3) ===\n');

  await test('identificar() retorna auto_vincular para GTIN existente', async () => {
    const service = criarServiceComPipelineGtin({
      id: 50,
      codigo: 'CAFE-500G',
      nome: 'Café 500g',
      codigo_barras: '7891234567800',
      ativo: 1
    });

    const resposta = await service.identificar({
      codigoBarras: '7891234567800',
      produtoNome: 'Café 500g'
    });
    const resultado = resposta.resultado;

    assert.strictEqual(resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.strictEqual(resultado.decisao.confianca, MiipConfidence.ALTA);
    assert.strictEqual(resultado.candidatos.length, 1);
    assert.ok(resultado.candidatos[0] instanceof MiipCandidate);
    assert.strictEqual(resultado.candidatos[0].produtoId, 50);
    assert.strictEqual(resultado.score.valor, 100);
    assert.ok(resultado.enginesExecutados.includes('motor_gtin'));
    assert.ok(resultado.durationMs >= 0);
  });

  await test('identificar() retorna criar_novo sem GTIN', async () => {
    const service = criarServiceComPipelineGtin(null);

    const resposta = await service.identificar({
      produtoNome: 'Produto sem código de barras'
    });
    const resultado = resposta.resultado;

    assert.strictEqual(resultado.decisao.acao, MiipAction.CRIAR_NOVO);
    assert.strictEqual(resultado.decisao.confianca, MiipConfidence.NENHUMA);
    assert.strictEqual(resultado.candidatos.length, 0);
  });

  await test('identificar() retorna criar_novo para GTIN inexistente', async () => {
    const service = criarServiceComPipelineGtin({
      id: 51,
      codigo: 'LEITE',
      nome: 'Leite 1L',
      codigo_barras: '7891234567801',
      ativo: 1
    });

    const resposta = await service.identificar({
      codigoBarras: '7899999999999',
      produtoNome: 'Leite desconhecido'
    });
    const resultado = resposta.resultado;

    assert.strictEqual(resultado.decisao.acao, MiipAction.CRIAR_NOVO);
    assert.strictEqual(resultado.candidatos.length, 0);
  });

  await test('identificar() retorna criar_novo para GTIN inativo (score 60)', async () => {
    const service = criarServiceComPipelineGtin({
      id: 52,
      codigo: 'OLEO',
      nome: 'Óleo 900ml',
      codigo_barras: '7891234567802',
      ativo: 0
    });

    const resposta = await service.identificar({
      codigoBarras: '7891234567802'
    });
    const resultado = resposta.resultado;

    assert.strictEqual(resultado.decisao.acao, MiipAction.CRIAR_NOVO);
    assert.ok([MiipConfidence.BAIXA, MiipConfidence.NENHUMA].includes(resultado.decisao.confianca));
    assert.strictEqual(resultado.candidatos[0].scoreTotal, 60);
  });

  await test('pipeline executa somente MotorGTIN no registry isolado', async () => {
    const service = criarServiceComPipelineGtin({
      id: 53,
      codigo: 'MACA',
      nome: 'Maçã',
      codigo_barras: '7891234567803',
      ativo: 1
    });

    const resposta = await service.identificar({ codigoBarras: '7891234567803' });
    const resultado = resposta.resultado;
    assert.deepStrictEqual(resultado.enginesExecutados, ['motor_gtin']);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
