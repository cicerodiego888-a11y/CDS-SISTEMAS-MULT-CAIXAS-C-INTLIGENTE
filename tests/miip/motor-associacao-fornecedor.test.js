/**
 * Testes — MotorAssociacaoFornecedor (MIIP) — Sprint 4
 * Executar: npm run test:miip-associacao-fornecedor
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const MiipConfidence = require('../../backend/motores/miip/core/MiipConfidence');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const MiipEvidence = require('../../backend/motores/miip/core/MiipEvidence');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/MotorAssociacaoFornecedor');
const { MiipAssociacoesRepository } = require('../../backend/motores/miip/repositories/MiipAssociacoesRepository');
const { ProdutoRepository } = require('../../backend/motores/miip/repositories/ProdutoRepository');
const { MiipMetricsCollector } = require('../../backend/motores/miip/metrics/MiipMetricsCollector');
const { MiipMotorLogService } = require('../../backend/motores/miip/logs/MiipMotorLogService');
const { normalizarCnpj } = require('../../backend/motores/miip/utils/normalizarCnpj');
const { normalizarCodigoFornecedor } = require('../../backend/motores/miip/utils/normalizarCodigoFornecedor');

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

function criarSnapshot(produto) {
  return ProdutoSnapshot.fromRow(produto);
}

function criarAssociacoesMock(associacao) {
  return {
    async buscarPorFornecedorCodigo(fornecedorCnpj, codigoFornecedor) {
      if (!associacao) return null;
      if (associacao.status && associacao.status !== 'ativa') return null;
      if (
        associacao.fornecedorCnpj !== fornecedorCnpj ||
        associacao.codigoFornecedor !== codigoFornecedor
      ) {
        return null;
      }
      return {
        id: associacao.id,
        produtoId: associacao.produtoId,
        fornecedorCnpj: associacao.fornecedorCnpj,
        codigoFornecedor: associacao.codigoFornecedor,
        nomeItem: associacao.nomeItem,
        status: associacao.status ?? 'ativa'
      };
    }
  };
}

function criarProdutoMock(produto) {
  return {
    async buscarPorId(id) {
      if (!produto || Number(produto.id) !== Number(id)) return null;
      return criarSnapshot(produto);
    }
  };
}

function criarMotor(opcoes = {}) {
  const produto = opcoes.produto ?? opcoes.associacao?.produto ?? null;

  return new MotorAssociacaoFornecedor({
    associacoesRepository: opcoes.associacoesRepository
      ?? criarAssociacoesMock(opcoes.associacao ?? null),
    produtoRepository: opcoes.produtoRepository ?? criarProdutoMock(produto),
    metricsCollector: opcoes.metrics ?? new MiipMetricsCollector(),
    logService: opcoes.logs ?? new MiipMotorLogService()
  });
}

const PRODUTO_ATIVO = {
  id: 50,
  codigo: 'ARROZ-INT-5KG',
  nome: 'Arroz Integral 5kg',
  codigo_barras: '7891234567890',
  ativo: 1
};

const ASSOCIACAO_ATIVA = {
  id: 1,
  produtoId: 50,
  fornecedorCnpj: '12345678000199',
  codigoFornecedor: 'PROD-001',
  nomeItem: 'Arroz Integral 5kg',
  status: 'ativa',
  produto: PRODUTO_ATIVO
};

async function main() {
  console.log('\n=== Testes MotorAssociacaoFornecedor — MIIP (Sprint 4) ===\n');

  await test('MotorAssociacaoFornecedor estende IMotorIdentificacao', () => {
    const validacao = IMotorIdentificacao.validarHeranca(MotorAssociacaoFornecedor);
    assert.strictEqual(validacao.valido, true, validacao.erros.join('; '));
  });

  await test('MotorAssociacaoFornecedor utiliza MiipAssociacoesRepository e ProdutoRepository', () => {
    const motor = new MotorAssociacaoFornecedor();
    assert.ok(motor._associacoesRepository instanceof MiipAssociacoesRepository);
    assert.ok(motor._produtoRepository instanceof ProdutoRepository);
  });

  await test('MotorAssociacaoFornecedor não acessa SQL diretamente', () => {
    const arquivo = path.join(
      __dirname,
      '../../backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor.js'
    );
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const padroesProibidos = [/SELECT\s+/i, /FROM\s+miip_associacoes/i, /db\.get\(/i, /db\.all\(/i];
    padroesProibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão SQL proibido: ${padrao}`);
    });
  });

  await test('normalizarCnpj remove máscara', () => {
    assert.strictEqual(normalizarCnpj('12.345.678/0001-99'), '12345678000199');
  });

  await test('normalizarCodigoFornecedor preserva cProd', () => {
    assert.strictEqual(normalizarCodigoFornecedor('  PROD-001  '), 'PROD-001');
  });

  await test('identificar retorna vazio sem CNPJ (fornecedor desconhecido)', async () => {
    const motor = criarMotor({ associacao: ASSOCIACAO_ATIVA });
    const candidatos = await motor.identificar({ codigoFornecedor: 'PROD-001' });
    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna vazio sem codigoFornecedor (código inexistente)', async () => {
    const motor = criarMotor({ associacao: ASSOCIACAO_ATIVA });
    const candidatos = await motor.identificar({ fornecedorCnpj: '12345678000199' });
    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar ignora GTIN e nome do item', async () => {
    const motor = criarMotor({
      associacoesRepository: {
        async buscarPorFornecedorCodigo() {
          throw new Error('buscarPorFornecedorCodigo não deveria ser chamado');
        }
      }
    });

    const candidatos = await motor.identificar({
      produtoNome: 'Outro Produto',
      codigoBarras: '7899999999999',
      fornecedorNome: 'Fornecedor X'
    });

    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna MiipCandidate com snapshot para fornecedor conhecido', async () => {
    const motor = criarMotor({ associacao: ASSOCIACAO_ATIVA });

    const candidatos = await motor.identificar({
      fornecedorCnpj: '12.345.678/0001-99',
      codigoFornecedor: 'PROD-001'
    });

    assert.strictEqual(candidatos.length, 1);
    assert.ok(candidatos[0] instanceof MiipCandidate);
    assert.ok(candidatos[0].snapshot instanceof ProdutoSnapshot);
    assert.strictEqual(candidatos[0].produtoId, 50);
    assert.strictEqual(candidatos[0].scoreTotal, 100);
    assert.strictEqual(candidatos[0].confianca, MiipConfidence.ALTA);
    assert.ok(candidatos[0].evidencias[0] instanceof MiipEvidence);
    assert.strictEqual(candidatos[0].evidencias[0].tipo, 'associacao_fornecedor');
    assert.strictEqual(candidatos[0].atributosExtraidos.origemDados, 'MiipAssociacoesRepository');
    assert.deepStrictEqual(candidatos[0].motoresQueVotaram, ['motor_associacao_fornecedor']);
  });

  await test('identificar retorna vazio quando associação não existe', async () => {
    const motor = criarMotor({ associacao: null });

    const candidatos = await motor.identificar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'INEXISTENTE'
    });

    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna vazio para associação inativa', async () => {
    const motor = criarMotor({
      associacao: {
        ...ASSOCIACAO_ATIVA,
        status: 'inativa'
      }
    });

    const candidatos = await motor.identificar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna vazio quando produto não existe', async () => {
    const motor = criarMotor({
      associacao: ASSOCIACAO_ATIVA,
      produtoRepository: {
        async buscarPorId() {
          return null;
        }
      }
    });

    const candidatos = await motor.identificar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna score reduzido para produto inativo', async () => {
    const motor = criarMotor({
      associacao: ASSOCIACAO_ATIVA,
      produto: {
        ...PRODUTO_ATIVO,
        ativo: 0
      }
    });

    const candidatos = await motor.identificar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.strictEqual(candidatos.length, 1);
    assert.strictEqual(candidatos[0].scoreTotal, 60);
    assert.strictEqual(candidatos[0].confianca, MiipConfidence.MEDIA);
  });

  await test('executar produz candidatos sem decisão de negócio', async () => {
    const metrics = new MiipMetricsCollector();
    const logs = new MiipMotorLogService();
    const motor = criarMotor({ associacao: ASSOCIACAO_ATIVA, metrics, logs });

    const resultado = await motor.executar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.strictEqual(resultado.motor, 'motor_associacao_fornecedor');
    assert.strictEqual(resultado.candidatos.length, 1);
    assert.strictEqual(resultado.decisao, undefined);
    assert.ok(resultado.duracaoMs >= 0);

    const metricas = metrics.obterPorMotor('motor_associacao_fornecedor');
    assert.strictEqual(metricas.totalConsultas, 1);
    assert.strictEqual(metricas.totalEncontrados, 1);

    const log = logs.listar({ motor: 'motor_associacao_fornecedor' })[0];
    assert.strictEqual(logs.total(), 1);
    assert.strictEqual(log.fornecedorCnpj, '12345678000199');
    assert.strictEqual(log.codigoFornecedor, 'PROD-001');
    assert.strictEqual(log.produtoId, 50);
  });

  await test('executar retorna vazio quando associação ausente', async () => {
    const metrics = new MiipMetricsCollector();
    const motor = criarMotor({ associacao: null, metrics });

    const resultado = await motor.executar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'PROD-999'
    });

    assert.strictEqual(resultado.candidatos.length, 0);
    assert.strictEqual(metrics.obterPorMotor('motor_associacao_fornecedor').totalNaoEncontrados, 1);
  });

  await test('executar registra métricas de erro sem propagar exceção', async () => {
    const metrics = new MiipMetricsCollector();
    const logs = new MiipMotorLogService();
    const motor = criarMotor({
      metrics,
      logs,
      associacoesRepository: {
        async buscarPorFornecedorCodigo() {
          throw new Error('falha sqlite');
        }
      }
    });

    const resultado = await motor.executar({
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.strictEqual(resultado.candidatos.length, 0);
    assert.strictEqual(metrics.obterPorMotor('motor_associacao_fornecedor').totalErros, 1);
    assert.strictEqual(logs.listar({ motor: 'motor_associacao_fornecedor' })[0].erro, 'falha sqlite');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
