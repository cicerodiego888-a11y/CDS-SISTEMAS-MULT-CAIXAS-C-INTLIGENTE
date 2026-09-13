/**
 * Testes — MiipLearningService (MIIP) — Sprint 5 / 5.1
 * Executar: npm run test:miip-learning
 */

const assert = require('assert');
const MiipLearningService = require('../../backend/motores/miip/services/MiipLearningService');
const { ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE } = require('../../backend/motores/miip/services/MiipLearningService');
const MiipLearningEvent = require('../../backend/motores/miip/core/MiipLearningEvent');
const { MiipLearningMetricsCollector } = require('../../backend/motores/miip/metrics/MiipLearningMetricsCollector');
const { MiipAprendizadoLogService } = require('../../backend/motores/miip/logs/MiipAprendizadoLogService');
const { MiipService } = require('../../backend/motores/miip/MiipService');

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

function criarRepositoryMock(estado = {}) {
  const associacoes = new Map();
  let nextId = 1;

  if (estado.inicial) {
    const registro = {
      ...estado.inicial,
      id: estado.inicial.id ?? nextId++,
      metadados: estado.inicial.metadados ?? {},
      confirmacoes: estado.inicial.confirmacoes ?? estado.inicial.metadados?.confirmacoes ?? 0
    };
    associacoes.set(`${registro.fornecedorCnpj}::${registro.codigoFornecedor}`, registro);
  }

  return {
    salvos: [],
    incrementos: [],
    reativacoes: [],
    desativacoes: [],

    async buscarAssociacao(fornecedorCnpj, codigoFornecedor) {
      return associacoes.get(`${fornecedorCnpj}::${codigoFornecedor}`) ?? null;
    },

    async buscarPorId(id) {
      for (const registro of associacoes.values()) {
        if (registro.id === id) return { ...registro };
      }
      return null;
    },

    async salvarAssociacao(dados) {
      const registro = {
        id: nextId++,
        ...dados,
        status: dados.status ?? 'ativa',
        confirmacoes: dados.metadados?.confirmacoes ?? 1,
        metadados: dados.metadados ?? {}
      };
      this.salvos.push(registro);
      associacoes.set(`${dados.fornecedorCnpj}::${dados.codigoFornecedor}`, registro);
      return registro;
    },

    async incrementarConfirmacoes(id, opcoes = {}) {
      const registro = await this.buscarPorId(id);
      if (!registro) return null;
      const confirmacoes = Number(registro.confirmacoes ?? 0) + 1;
      const atualizado = {
        ...registro,
        confirmacoes,
        confirmadoPorUsuarioId: opcoes.usuarioId ?? registro.confirmadoPorUsuarioId,
        metadados: {
          ...registro.metadados,
          confirmacoes,
          ultima_confirmacao: new Date().toISOString(),
          ultimo_usuario: opcoes.usuarioId ?? registro.metadados?.ultimo_usuario
        }
      };
      associacoes.set(`${registro.fornecedorCnpj}::${registro.codigoFornecedor}`, atualizado);
      this.incrementos.push(atualizado);
      return atualizado;
    },

    async reativarAssociacao(id, opcoes = {}) {
      const registro = await this.buscarPorId(id);
      if (!registro) return null;
      const atualizado = { ...registro, status: 'ativa' };
      associacoes.set(`${registro.fornecedorCnpj}::${registro.codigoFornecedor}`, atualizado);
      this.reativacoes.push(atualizado);
      return atualizado;
    },

    async desativarAssociacao(id) {
      const registro = await this.buscarPorId(id);
      if (!registro) return false;
      const atualizado = { ...registro, status: 'inativa' };
      associacoes.set(`${registro.fornecedorCnpj}::${registro.codigoFornecedor}`, atualizado);
      this.desativacoes.push(atualizado);
      return true;
    }
  };
}

function criarService(opcoes = {}) {
  return new MiipLearningService({
    associacoesRepository: opcoes.repository ?? criarRepositoryMock(),
    metricsCollector: opcoes.metrics ?? new MiipLearningMetricsCollector(),
    logService: opcoes.logs ?? new MiipAprendizadoLogService()
  });
}

const CONFIRMACAO_VALIDA = {
  confirmado: true,
  produtoId: 42,
  cnpj: '12.345.678/0001-99',
  codigoFornecedor: ' PROD-001 ',
  fornecedor: 'Fornecedor Teste',
  descricaoFornecedor: 'Arroz Integral 5kg',
  usuario: 7,
  origem: 'xml',
  requestId: 'req-test-001'
};

async function main() {
  console.log('\n=== Testes MiipLearningService — MIIP (Sprint 5 / 5.1) ===\n');

  await test('cria MiipLearningEvent com campos oficiais', () => {
    const evento = MiipLearningEvent.create({
      requestId: 'req-1',
      produtoId: 10,
      fornecedor: 'ACME',
      cnpj: '12345678000199',
      codigoFornecedor: 'P1',
      descricaoFornecedor: 'Produto X',
      usuario: 3,
      origem: 'api'
    });

    assert.strictEqual(evento.requestId, 'req-1');
    assert.strictEqual(evento.produtoId, 10);
    assert.strictEqual(evento.cnpj, '12345678000199');
    assert.ok(evento.timestamp);
  });

  await test('rejeita aprendizado sem confirmação explícita', async () => {
    const repo = criarRepositoryMock();
    const service = criarService({ repository: repo });

    const resultado = await service.registrarConfirmacao({
      produtoId: 42,
      cnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.gravado, false);
    assert.strictEqual(resultado.motivo, 'confirmacao_usuario_obrigatoria');
    assert.strictEqual(repo.salvos.length, 0);
  });

  await test('cria nova associação com confirmação explícita', async () => {
    const repo = criarRepositoryMock();
    const metrics = new MiipLearningMetricsCollector();
    const service = criarService({ repository: repo, metrics });

    const resultado = await service.registrarConfirmacao(CONFIRMACAO_VALIDA);

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.gravado, true);
    assert.strictEqual(resultado.motivo, 'associacao_criada');
    assert.strictEqual(resultado.associacaoId, 1);
    assert.strictEqual(resultado.confirmacoes, 1);
    assert.strictEqual(repo.salvos.length, 1);
    assert.strictEqual(repo.salvos[0].produtoId, 42);
    assert.strictEqual(repo.salvos[0].fornecedorCnpj, '12345678000199');
    assert.strictEqual(repo.salvos[0].codigoFornecedor, 'PROD-001');

    const resumo = metrics.obterResumo();
    assert.strictEqual(resumo.aprendizadosNovos, 1);
    assert.strictEqual(resumo.totalAprendizados, 1);
  });

  await test('incrementa confirmações quando associação já existe (mesmo produto)', async () => {
    const repo = criarRepositoryMock({
      inicial: {
        id: 9,
        produtoId: 42,
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'PROD-001',
        status: 'ativa',
        confirmacoes: 2,
        metadados: { confirmacoes: 2 }
      }
    });
    const metrics = new MiipLearningMetricsCollector();
    const service = criarService({ repository: repo, metrics });

    const resultado = await service.registrarConfirmacao(CONFIRMACAO_VALIDA);

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.gravado, false);
    assert.strictEqual(resultado.reutilizacao, true);
    assert.strictEqual(resultado.motivo, 'confirmacao_incrementada');
    assert.strictEqual(resultado.confirmacoes, 3);
    assert.strictEqual(repo.salvos.length, 0);
    assert.strictEqual(repo.incrementos.length, 1);
    assert.strictEqual(metrics.obterResumo().reutilizacoes, 1);
  });

  await test('reativa associação inativa com mesmo produto', async () => {
    const repo = criarRepositoryMock({
      inicial: {
        id: 5,
        produtoId: 42,
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'PROD-001',
        status: 'inativa',
        confirmacoes: 1,
        metadados: { confirmacoes: 1 }
      }
    });
    const metrics = new MiipLearningMetricsCollector();
    const service = criarService({ repository: repo, metrics });

    const resultado = await service.registrarConfirmacao(CONFIRMACAO_VALIDA);

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.reativada, true);
    assert.strictEqual(resultado.motivo, 'associacao_reativada');
    assert.strictEqual(repo.reativacoes.length, 1);
    assert.strictEqual(repo.incrementos.length, 1);
    assert.strictEqual(metrics.obterResumo().associacoesReativadas, 1);
  });

  await test('associação existente ativa com produto diferente retorna ASSOCIACAO_EXISTENTE_DIFERENTE', async () => {
    const repo = criarRepositoryMock({
      inicial: {
        id: 3,
        produtoId: 10,
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'PROD-001',
        status: 'ativa'
      }
    });
    const metrics = new MiipLearningMetricsCollector();
    const service = criarService({ repository: repo, metrics });

    const resultado = await service.registrarConfirmacao(CONFIRMACAO_VALIDA);

    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.gravado, false);
    assert.strictEqual(resultado.rejeitado, false);
    assert.strictEqual(resultado.pendenteDecisao, true);
    assert.strictEqual(resultado.estado, ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE);
    assert.strictEqual(resultado.motivo, 'associacao_existente_diferente');
    assert.deepStrictEqual(resultado.conflito, {
      produtoAtual: 10,
      produtoNovo: 42,
      fornecedor: 'Fornecedor Teste',
      codigoFornecedor: 'PROD-001'
    });
    assert.strictEqual(repo.salvos.length, 0);
    assert.strictEqual(repo.incrementos.length, 0);
    assert.strictEqual(repo.desativacoes.length, 0);
    assert.strictEqual(metrics.obterResumo().conflitos, 1);
  });

  await test('substituição confirmada desativa anterior e grava novo produto', async () => {
    const repo = criarRepositoryMock({
      inicial: {
        id: 3,
        produtoId: 10,
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'PROD-001',
        status: 'ativa'
      }
    });
    const metrics = new MiipLearningMetricsCollector();
    const service = criarService({ repository: repo, metrics });

    const resultado = await service.registrarConfirmacao({
      ...CONFIRMACAO_VALIDA,
      confirmarSubstituicao: true
    });

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.gravado, true);
    assert.strictEqual(resultado.substituida, true);
    assert.strictEqual(resultado.motivo, 'associacao_substituida');
    assert.strictEqual(resultado.associacaoAnteriorId, 3);
    assert.strictEqual(resultado.associacaoId, 1);
    assert.strictEqual(repo.desativacoes.length, 1);
    assert.strictEqual(repo.desativacoes[0].produtoId, 10);
    assert.strictEqual(repo.salvos.length, 1);
    assert.strictEqual(repo.salvos[0].produtoId, 42);
    assert.strictEqual(metrics.obterResumo().substituicoes, 1);
  });

  await test('substituição cancelada mantém associação e retorna conflito', async () => {
    const repo = criarRepositoryMock({
      inicial: {
        id: 3,
        produtoId: 10,
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'PROD-001',
        status: 'ativa'
      }
    });
    const service = criarService({ repository: repo });

    const resultado = await service.registrarConfirmacao({
      ...CONFIRMACAO_VALIDA,
      substituicaoCancelada: true
    });

    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.gravado, false);
    assert.strictEqual(resultado.pendenteDecisao, true);
    assert.strictEqual(resultado.estado, ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE);
    assert.strictEqual(resultado.motivo, 'substituicao_cancelada');
    assert.strictEqual(repo.salvos.length, 0);
    assert.strictEqual(repo.desativacoes.length, 0);

    const atual = await repo.buscarAssociacao('12345678000199', 'PROD-001');
    assert.strictEqual(atual.produtoId, 10);
    assert.strictEqual(atual.status, 'ativa');
  });

  await test('registra logs com usuário, fornecedor, produto e tempo', async () => {
    const logs = new MiipAprendizadoLogService();
    const service = criarService({ logs });

    await service.registrarConfirmacao(CONFIRMACAO_VALIDA);

    assert.ok(logs.total() >= 2);
    const gravado = logs.listar({ evento: 'aprendizado_gravado' })[0];
    assert.ok(gravado);
    assert.strictEqual(gravado.dados.usuario, 7);
    assert.strictEqual(gravado.dados.fornecedor, 'Fornecedor Teste');
    assert.strictEqual(gravado.dados.produtoId, 42);
    assert.strictEqual(gravado.dados.codigoFornecedor, 'PROD-001');
    assert.ok(gravado.duracaoMs >= 0);
  });

  await test('MiipService.registrarFeedback delega ao MiipLearningService', async () => {
    const repo = criarRepositoryMock();
    const learning = criarService({ repository: repo });
    const service = new MiipService({
      learningService: learning,
      inicializar: () => {}
    });

    const resultado = await service.registrarFeedback(CONFIRMACAO_VALIDA);

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.gravado, true);
    assert.strictEqual(resultado.associacaoId, 1);
    assert.strictEqual(resultado.operacaoId, 'req-test-001');
  });

  await test('MiipService.registrarFeedback não grava sem confirmação', async () => {
    const repo = criarRepositoryMock();
    const learning = criarService({ repository: repo });
    const service = new MiipService({
      learningService: learning,
      inicializar: () => {}
    });

    const resultado = await service.registrarFeedback({
      produtoId: 42,
      cnpj: '12345678000199',
      codigoFornecedor: 'PROD-001'
    });

    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.gravado, false);
    assert.strictEqual(resultado.motivo, 'confirmacao_usuario_obrigatoria');
    assert.strictEqual(repo.salvos.length, 0);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
