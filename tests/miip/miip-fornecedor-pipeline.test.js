/**
 * Testes E2E — Pipeline GTIN + Fornecedor (Sprint 4)
 * Executar: npm run test:miip-fornecedor-pipeline
 */

const assert = require('assert');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const { MiipOrchestrator } = require('../../backend/motores/miip/MiipOrchestrator');
const { criarPipelinePadrao } = require('../../backend/motores/miip/core/MiipPipelineFactory');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');
const MotorGTIN = require('../../backend/motores/miip/engines/gtin/MotorGTIN');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
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

function criarServiceComMotores(opcoes = {}) {
  const registry = new MotorRegistry();

  registry.registrar({
    codigo: 'motor_gtin',
    Classe: MotorGTIN,
    ativo: true,
    prioridade: 10,
    meta: {
      config: {
        produtoRepository: {
          async buscarPorGtin(gtin) {
            const produto = opcoes.produtoGtin ?? null;
            if (!produto || produto.codigo_barras !== gtin) return null;
            return ProdutoSnapshot.fromRow(produto);
          }
        }
      }
    }
  });

  registry.registrar({
    codigo: 'motor_associacao_fornecedor',
    Classe: MotorAssociacaoFornecedor,
    ativo: true,
    prioridade: 20,
    meta: {
      config: {
        associacoesRepository: {
          async buscarPorFornecedorCodigo(cnpj, codigo) {
            const assoc = opcoes.associacao ?? null;
            if (!assoc || assoc.fornecedorCnpj !== cnpj || assoc.codigoFornecedor !== codigo) {
              return null;
            }
            if (assoc.status && assoc.status !== 'ativa') return null;
            return {
              id: assoc.id,
              produtoId: assoc.produtoId,
              fornecedorCnpj: assoc.fornecedorCnpj,
              codigoFornecedor: assoc.codigoFornecedor,
              status: assoc.status ?? 'ativa'
            };
          }
        },
        produtoRepository: {
          async buscarPorId(id) {
            const produto = opcoes.produtoFornecedor ?? null;
            if (!produto || Number(produto.id) !== Number(id)) return null;
            return ProdutoSnapshot.fromRow(produto);
          }
        }
      }
    }
  });

  const pipeline = criarPipelinePadrao({
    motorRegistry: registry,
    configuracoesRepository: { async buscarPorChave() { return null; } }
  });

  const orchestrator = new MiipOrchestrator({ pipeline });
  const featureFlags = new MiipFeatureFlags();

  return new MiipService({
    orchestrator,
    inicializar: () => {},
    featureFlags,
    integracaoLog: new MiipIntegracaoLogService(),
    configuracoesRepository: {
      async buscarPorChave() { return null; },
      parseValor() { return true; }
    }
  });
}

async function main() {
  console.log('\n=== Testes E2E — Pipeline GTIN + Fornecedor (Sprint 4) ===\n');

  await test('pipeline executa MotorGTIN e MotorAssociacaoFornecedor', async () => {
    const service = criarServiceComMotores({
      produtoGtin: {
        id: 10,
        codigo: 'GTIN-10',
        nome: 'Produto GTIN',
        codigo_barras: '7891111111111',
        ativo: 1
      },
      associacao: {
        id: 1,
        produtoId: 20,
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'C001',
        status: 'ativa'
      },
      produtoFornecedor: {
        id: 20,
        codigo: 'FORN-20',
        nome: 'Produto Fornecedor',
        codigo_barras: '7892222222222',
        ativo: 1
      }
    });

    const resposta = await service.identificar({
      codigoBarras: '7891111111111',
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'C001'
    });

    const resultado = resposta.resultado;
    assert.deepStrictEqual(
      resultado.enginesExecutados,
      ['motor_gtin', 'motor_associacao_fornecedor']
    );
    assert.ok(resultado.candidatos.length >= 1);
  });

  await test('pipeline identifica via associação fornecedor quando GTIN ausente', async () => {
    const service = criarServiceComMotores({
      associacao: {
        id: 2,
        produtoId: 30,
        fornecedorCnpj: '98765432000111',
        codigoFornecedor: 'XML-99',
        status: 'ativa'
      },
      produtoFornecedor: {
        id: 30,
        codigo: 'FEIJAO',
        nome: 'Feijão 1kg',
        codigo_barras: null,
        ativo: 1
      }
    });

    const resposta = await service.identificar({
      fornecedorCnpj: '98765432000111',
      codigoFornecedor: 'XML-99'
    });

    const resultado = resposta.resultado;
    assert.strictEqual(resposta.produtoId, 30);
    assert.strictEqual(resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.ok(resultado.enginesExecutados.includes('motor_associacao_fornecedor'));
  });

  await test('pipeline retorna revisar_manual em conflito entre motores', async () => {
    const service = criarServiceComMotores({
      produtoGtin: {
        id: 40,
        codigo: 'GTIN-40',
        nome: 'Produto A',
        codigo_barras: '7893333333333',
        ativo: 1
      },
      associacao: {
        id: 3,
        produtoId: 41,
        fornecedorCnpj: '11111111000111',
        codigoFornecedor: 'CONFLITO',
        status: 'ativa'
      },
      produtoFornecedor: {
        id: 41,
        codigo: 'FORN-41',
        nome: 'Produto B',
        codigo_barras: '7894444444444',
        ativo: 1
      }
    });

    const resposta = await service.identificar({
      codigoBarras: '7893333333333',
      fornecedorCnpj: '11111111000111',
      codigoFornecedor: 'CONFLITO'
    });

    const resultado = resposta.resultado;
    assert.strictEqual(resultado.decisao.acao, MiipAction.REVISAR_MANUAL);
    assert.strictEqual(resultado.decisao.conflito, true);
  });

  await test('pipeline retorna criar_novo sem GTIN nem associação', async () => {
    const service = criarServiceComMotores({});

    const resposta = await service.identificar({
      produtoNome: 'Item desconhecido',
      fornecedorCnpj: '00000000000000',
      codigoFornecedor: 'NADA'
    });

    const resultado = resposta.resultado;
    assert.strictEqual(resultado.decisao.acao, MiipAction.CRIAR_NOVO);
    assert.strictEqual(resultado.candidatos.length, 0);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
