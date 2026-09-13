/**
 * Testes — Integração MiipService (Sprint 5)
 * Executar: npm run test:miip-integracao
 */

const assert = require('assert');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const MiipOrchestrator = require('../../backend/motores/miip/MiipOrchestrator');
const MiipResult = require('../../backend/motores/miip/core/MiipResult');
const MiipScore = require('../../backend/motores/miip/core/MiipScore');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const ProdutoCandidatoDTO = require('../../backend/motores/miip/contracts/ProdutoCandidatoDTO');
const { mapearItemCompraParaIdentificavel } = require('../../backend/motores/miip/utils/mapearItemCompra');
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

function criarOrchestratorMock(produtoId) {
  return {
    async executar() {
      if (!produtoId) {
        return MiipResult.vazio();
      }

      const candidato = ProdutoCandidatoDTO.create({
        produtoId,
        nome: 'Produto Teste',
        codigo: 'TESTE',
        codigoBarras: '7891234567890',
        scoreParcial: 100,
        scorePonderado: 100,
        motorOrigem: 'motor_gtin',
        evidencias: [{ tipo: 'gtin_exato', valor: '7891234567890' }]
      });

      return MiipResult.create({
        decisao: {
          acao: MiipAction.AUTO_VINCULAR,
          confianca: 'ALTA',
          melhorCandidato: candidato,
          conflito: false
        },
        score: MiipScore.create({ valor: 100, gap: null, enginesConcordantes: 1 }),
        candidatos: [candidato],
        enginesExecutados: ['motor_gtin'],
        duracaoTotalMs: 1
      });
    }
  };
}

function criarService(opcoes = {}) {
  const featureFlags = new MiipFeatureFlags();
  if (opcoes.usarMiip === false) {
    featureFlags.definirUsarMiip(false);
  }

  return new MiipService({
    orchestrator: opcoes.orchestrator ?? criarOrchestratorMock(opcoes.produtoId ?? null),
    inicializar: () => {},
    featureFlags,
    integracaoLog: opcoes.integracaoLog ?? new MiipIntegracaoLogService(),
    configuracoesRepository: {
      async buscarPorChave() {
        return null;
      },
      parseValor(registro) {
        return registro?.valor === 'true';
      }
    }
  });
}

async function main() {
  console.log('\n=== Testes Integração — MiipService (Sprint 5) ===\n');

  await test('mapearItemCompraParaIdentificavel normaliza campos snake_case', () => {
    const dto = mapearItemCompraParaIdentificavel({
      produto_nome: 'Arroz',
      codigo_barras: '7891234567890',
      fornecedor_cnpj: '12345678000199',
      codigo_fornecedor: 'P001'
    });

    assert.strictEqual(dto.produtoNome, 'Arroz');
    assert.strictEqual(dto.codigoBarras, '7891234567890');
    assert.strictEqual(dto.fornecedorCnpj, '12345678000199');
    assert.strictEqual(dto.codigoFornecedor, 'P001');
  });

  await test('estaHabilitado retorna true por default', () => {
    const service = criarService();
    assert.strictEqual(service.estaHabilitado(), true);
  });

  await test('identificar retorna produtoId quando MIIP encontra', async () => {
    const logs = new MiipIntegracaoLogService();
    const service = criarService({ produtoId: 42, integracaoLog: logs });

    const resposta = await service.identificar({
      produto_nome: 'Arroz',
      codigo_barras: '7891234567890'
    });

    assert.strictEqual(resposta.encontrado, true);
    assert.strictEqual(resposta.produtoId, 42);
    assert.strictEqual(resposta.resultado.candidatos.length, 1);
    assert.ok(logs.listar({ evento: 'miip_sucesso' }).length >= 1);
  });

  await test('identificar retorna null quando MIIP não encontra', async () => {
    const logs = new MiipIntegracaoLogService();
    const service = criarService({ produtoId: null, integracaoLog: logs });

    const resposta = await service.identificar({ produto_nome: 'Sem match' });
    assert.strictEqual(resposta.encontrado, false);
    assert.strictEqual(resposta.produtoId, null);
    assert.ok(logs.listar({ evento: 'miip_sem_match' }).length >= 1);
  });

  await test('identificar com usarMiip=false não executa orchestrator', async () => {
    let orchestratorChamado = false;
    const service = criarService({
      usarMiip: false,
      orchestrator: {
        async executar() {
          orchestratorChamado = true;
          return MiipResult.vazio();
        }
      }
    });

    const resposta = await service.identificar({ codigo_barras: '7891234567890' });
    assert.strictEqual(resposta.desabilitado, true);
    assert.strictEqual(resposta.encontrado, false);
    assert.strictEqual(orchestratorChamado, false);
  });

  await test('registrarIntegracao grava evento detalhado', () => {
    const logs = new MiipIntegracaoLogService();
    const service = criarService({ integracaoLog: logs });

    service.registrarIntegracao({
      evento: 'miip_fallback_legado',
      item: { produto_nome: 'Teste', codigo_barras: '7891234567890' },
      motivo: 'sem match'
    });

    const registros = logs.listar({ evento: 'miip_fallback_legado' });
    assert.strictEqual(registros.length, 1);
    assert.strictEqual(registros[0].item.produtoNome, 'Teste');
    assert.strictEqual(registros[0].motivo, 'sem match');
  });

  await test('extrairProdutoId retorna null para resultado vazio', () => {
    const service = criarService();
    assert.strictEqual(service.extrairProdutoId(MiipResult.vazio()), null);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
