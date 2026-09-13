/**
 * Testes — MotorGTIN (MIIP) — Sprint 3 + 3.1
 * Executar: npm run test:miip-gtin
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const MiipConfidence = require('../../backend/motores/miip/core/MiipConfidence');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const MiipEvidence = require('../../backend/motores/miip/core/MiipEvidence');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const MotorGTIN = require('../../backend/motores/miip/engines/MotorGTIN');
const { ProdutoRepository } = require('../../backend/motores/miip/repositories/ProdutoRepository');
const { MiipMetricsCollector } = require('../../backend/motores/miip/metrics/MiipMetricsCollector');
const { MiipMotorLogService } = require('../../backend/motores/miip/logs/MiipMotorLogService');
const { normalizarGtin } = require('../../backend/motores/miip/utils/normalizarGtin');

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

function criarRepositoryMock(produto) {
  return {
    async buscarPorGtin(gtin) {
      if (!produto) return null;
      if (produto.codigo_barras !== gtin) return null;
      return criarSnapshot(produto);
    }
  };
}

function criarMotor(opcoes = {}) {
  return new MotorGTIN({
    produtoRepository: opcoes.produtoRepository ?? criarRepositoryMock(opcoes.produto ?? null),
    metricsCollector: opcoes.metrics ?? new MiipMetricsCollector(),
    logService: opcoes.logs ?? new MiipMotorLogService()
  });
}

async function main() {
  console.log('\n=== Testes MotorGTIN — MIIP (Sprint 3 + 3.1) ===\n');

  await test('MotorGTIN estende IMotorIdentificacao', () => {
    const validacao = IMotorIdentificacao.validarHeranca(MotorGTIN);
    assert.strictEqual(validacao.valido, true, validacao.erros.join('; '));
  });

  await test('MotorGTIN utiliza ProdutoRepository por padrão', () => {
    const motor = new MotorGTIN();
    assert.ok(motor._produtoRepository instanceof ProdutoRepository);
  });

  await test('MotorGTIN não acessa SQL diretamente', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/engines/gtin/MotorGTIN.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const padroesProibidos = [/SELECT\s+/i, /FROM\s+produtos/i, /db\.get\(/i, /db\.all\(/i, /db\.run\(/i];
    padroesProibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão SQL proibido encontrado: ${padrao}`);
    });
  });

  await test('normalizarGtin aceita EAN-13 com hífens', () => {
    assert.strictEqual(normalizarGtin('789-1234-5678-90'), '7891234567890');
  });

  await test('normalizarGtin rejeita comprimento inválido', () => {
    assert.strictEqual(normalizarGtin('12345'), null);
  });

  await test('identificar retorna vazio sem codigoBarras', async () => {
    const motor = criarMotor();
    const candidatos = await motor.identificar({ produtoNome: 'Arroz 5kg' });
    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar ignora nome e fornecedor', async () => {
    const motor = criarMotor({
      produtoRepository: {
        async buscarPorGtin() {
          throw new Error('buscarPorGtin não deveria ser chamado');
        }
      }
    });

    const candidatos = await motor.identificar({
      produtoNome: 'Produto Qualquer',
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'ABC123'
    });

    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna MiipCandidate com snapshot e evidências', async () => {
    const motor = criarMotor({
      produto: {
        id: 10,
        codigo: 'ARROZ-5KG',
        nome: 'Arroz 5kg',
        codigo_barras: '7891234567890',
        ativo: 1
      }
    });

    const candidatos = await motor.identificar({ codigoBarras: '7891234567890' });
    assert.strictEqual(candidatos.length, 1);
    assert.ok(candidatos[0] instanceof MiipCandidate);
    assert.ok(candidatos[0].snapshot instanceof ProdutoSnapshot);
    assert.strictEqual(candidatos[0].produtoId, 10);
    assert.strictEqual(candidatos[0].scoreTotal, 100);
    assert.strictEqual(candidatos[0].confianca, MiipConfidence.ALTA);
    assert.ok(candidatos[0].evidencias[0] instanceof MiipEvidence);
    assert.strictEqual(candidatos[0].evidencias[0].tipo, 'gtin_exato');
    assert.strictEqual(candidatos[0].evidencias[0].valor, '7891234567890');
    assert.deepStrictEqual(candidatos[0].motoresQueVotaram, ['motor_gtin']);
    assert.strictEqual(candidatos[0].atributosExtraidos.campoOrigem, 'codigo_barras');
    assert.strictEqual(candidatos[0].atributosExtraidos.origemDados, 'ProdutoRepository');
  });

  await test('identificar encontra produto inativo com score reduzido', async () => {
    const motor = criarMotor({
      produto: {
        id: 11,
        codigo: 'FEIJAO-1KG',
        nome: 'Feijão 1kg',
        codigo_barras: '7891234567891',
        ativo: 0
      }
    });

    const candidatos = await motor.identificar({ codigoBarras: '7891234567891' });
    assert.strictEqual(candidatos.length, 1);
    assert.strictEqual(candidatos[0].scoreTotal, 60);
    assert.strictEqual(candidatos[0].confianca, MiipConfidence.MEDIA);
  });

  await test('identificar retorna vazio quando GTIN não existe', async () => {
    const motor = criarMotor();
    const candidatos = await motor.identificar({ codigoBarras: '7891234567890' });
    assert.deepStrictEqual(candidatos, []);
  });

  await test('executar produz candidatos sem decisão de negócio', async () => {
    const metrics = new MiipMetricsCollector();
    const logs = new MiipMotorLogService();
    const motor = criarMotor({
      metrics,
      logs,
      produto: {
        id: 20,
        codigo: 'ACUCAR',
        nome: 'Açúcar 1kg',
        codigo_barras: '7891234567892',
        ativo: 1
      }
    });

    const resultado = await motor.executar({ codigoBarras: '7891234567892' });
    assert.strictEqual(resultado.motor, 'motor_gtin');
    assert.strictEqual(resultado.candidatos.length, 1);
    assert.ok(resultado.candidatos[0] instanceof MiipCandidate);
    assert.strictEqual(resultado.decisao, undefined);
    assert.ok(Array.isArray(resultado.evidencias));
    assert.ok(resultado.startedAt);
    assert.ok(resultado.finishedAt);
    assert.ok(resultado.duracaoMs >= 0);

    const metricas = metrics.obterPorMotor('motor_gtin');
    assert.strictEqual(metricas.totalConsultas, 1);
    assert.strictEqual(metricas.totalEncontrados, 1);

    assert.strictEqual(logs.total(), 1);
    assert.strictEqual(logs.listar({ motor: 'motor_gtin' }).length, 1);
  });

  await test('executar retorna candidato para GTIN inativo sem decisão', async () => {
    const motor = criarMotor({
      produto: {
        id: 21,
        codigo: 'SAL',
        nome: 'Sal 1kg',
        codigo_barras: '7891234567893',
        ativo: 0
      }
    });

    const resultado = await motor.executar({ codigoBarras: '7891234567893' });
    assert.strictEqual(resultado.candidatos.length, 1);
    assert.strictEqual(resultado.candidatos[0].scoreTotal, 60);
    assert.strictEqual(resultado.decisao, undefined);
  });

  await test('executar retorna vazio para GTIN ausente', async () => {
    const metrics = new MiipMetricsCollector();
    const motor = criarMotor({ metrics });

    const resultado = await motor.executar({ produtoNome: 'Sem GTIN' });
    assert.strictEqual(resultado.candidatos.length, 0);
    assert.strictEqual(resultado.decisao, undefined);

    const metricas = metrics.obterPorMotor('motor_gtin');
    assert.strictEqual(metricas.totalNaoEncontrados, 1);
  });

  await test('identificar retorna vazio para GTIN inválido', async () => {
    const motor = criarMotor({
      produto: {
        id: 10,
        codigo: 'ARROZ-5KG',
        nome: 'Arroz 5kg',
        codigo_barras: '7891234567890',
        ativo: 1
      }
    });

    const candidatos = await motor.identificar({ codigoBarras: 'GTIN-INVALIDO-XYZ' });
    assert.deepStrictEqual(candidatos, []);
  });

  await test('identificar retorna um candidato com GTIN duplicado no cadastro (LIMIT 1)', async () => {
    const motor = criarMotor({
      produtoRepository: {
        async buscarPorGtin(gtin) {
          if (gtin !== '7891234567894') return null;
          return criarSnapshot({
            id: 30,
            codigo: 'DUP-1',
            nome: 'Produto duplicado (primeiro)',
            codigo_barras: gtin,
            ativo: 1
          });
        }
      }
    });

    const candidatos = await motor.identificar({ codigoBarras: '7891234567894' });
    assert.strictEqual(candidatos.length, 1);
    assert.strictEqual(candidatos[0].produtoId, 30);
  });

  await test('executar registra métricas de erro sem propagar exceção', async () => {
    const metrics = new MiipMetricsCollector();
    const logs = new MiipMotorLogService();
    const motor = criarMotor({
      metrics,
      logs,
      produtoRepository: {
        async buscarPorGtin() {
          throw new Error('falha sqlite');
        }
      }
    });

    const resultado = await motor.executar({ codigoBarras: '7891234567890' });
    assert.strictEqual(resultado.candidatos.length, 0);

    const metricas = metrics.obterPorMotor('motor_gtin');
    assert.strictEqual(metricas.totalErros, 1);
    assert.strictEqual(logs.listar({ motor: 'motor_gtin' })[0].erro, 'falha sqlite');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
