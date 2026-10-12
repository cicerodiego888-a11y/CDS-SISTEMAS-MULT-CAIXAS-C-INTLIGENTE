'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const { CRITERIOS } = require('../../backend/motores/miip/core/MiipIdentificacaoV2Policy');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const MiipLearningService = require('../../backend/motores/miip/services/MiipLearningService');
const { MiipOrchestrator } = require('../../backend/motores/miip/MiipOrchestrator');
const { criarPipelinePadrao } = require('../../backend/motores/miip/core/MiipPipelineFactory');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');
const MotorGTIN = require('../../backend/motores/miip/engines/gtin/MotorGTIN');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');
const { MiipLearningMetricsCollector } = require('../../backend/motores/miip/metrics/MiipLearningMetricsCollector');
const { MiipAprendizadoLogService } = require('../../backend/motores/miip/logs/MiipAprendizadoLogService');

const CNPJ_NOVO = '33333333000191';
const GTIN = '7891000100103';

/** Banco em memória: produtos + miip_associacoes, com registro de toda escrita. */
function criarBanco(produtosIniciais = [], associacoesIniciais = []) {
  const produtos = new Map(produtosIniciais.map((p) => [p.id, { ...p }]));
  const associacoes = associacoesIniciais.map((a, i) => ({ id: i + 1, confirmacoes: 1, metadados: {}, ...a }));
  const escritas = [];
  let nextId = associacoes.length + 1;
  const chave = (a) => `${a.fornecedorCnpj}::${a.codigoFornecedor}`;

  const produtoRepository = {
    async buscarPorGtin(gtin) {
      const p = [...produtos.values()].find((x) => x.codigo_barras === gtin);
      return p ? ProdutoSnapshot.fromRow(p) : null;
    },
    async buscarPorId(id) {
      const p = produtos.get(Number(id));
      return p ? ProdutoSnapshot.fromRow(p) : null;
    }
  };

  const associacoesRepository = {
    async buscarPorFornecedorCodigo(cnpj, codigo) {
      return associacoes.find((a) => a.fornecedorCnpj === cnpj && a.codigoFornecedor === codigo && a.status === 'ativa') ?? null;
    },
    async buscarAssociacao(cnpj, codigo) {
      return associacoes.find((a) => a.fornecedorCnpj === cnpj && a.codigoFornecedor === codigo) ?? null;
    },
    async salvarAssociacao(dados) {
      const registro = { id: nextId++, confirmacoes: 1, status: 'ativa', ...dados };
      escritas.push(['salvar', registro]);
      associacoes.push(registro);
      return registro;
    },
    async incrementarConfirmacoes(id) {
      const a = associacoes.find((x) => x.id === id);
      escritas.push(['incrementar', id]);
      a.confirmacoes += 1;
      return { ...a };
    },
    async reativarAssociacao(id) {
      const a = associacoes.find((x) => x.id === id);
      escritas.push(['reativar', id]);
      a.status = 'ativa';
      return { ...a };
    },
    async desativarAssociacao(id) {
      const a = associacoes.find((x) => x.id === id);
      escritas.push(['desativar', id]);
      a.status = 'inativa';
      return true;
    }
  };

  return { produtos, associacoes, escritas, chave, produtoRepository, associacoesRepository };
}

function criarMiip(banco) {
  const registry = new MotorRegistry();
  registry.registrar({
    codigo: 'motor_gtin', Classe: MotorGTIN, ativo: true, prioridade: 10,
    meta: { config: { produtoRepository: banco.produtoRepository } }
  });
  registry.registrar({
    codigo: 'motor_associacao_fornecedor', Classe: MotorAssociacaoFornecedor, ativo: true, prioridade: 20,
    meta: { config: { associacoesRepository: banco.associacoesRepository, produtoRepository: banco.produtoRepository } }
  });
  const pipeline = criarPipelinePadrao({
    motorRegistry: registry,
    configuracoesRepository: { async buscarPorChave() { return null; } }
  });
  return new MiipService({
    orchestrator: new MiipOrchestrator({ pipeline }),
    inicializar: () => {},
    featureFlags: new MiipFeatureFlags(),
    integracaoLog: new MiipIntegracaoLogService(),
    configuracoesRepository: { async buscarPorChave() { return null; }, parseValor() { return true; } },
    learningService: new MiipLearningService({
      associacoesRepository: banco.associacoesRepository,
      produtoRepository: banco.produtoRepository,
      metricsCollector: new MiipLearningMetricsCollector(),
      logService: new MiipAprendizadoLogService()
    })
  });
}

const ARROZ = {
  id: 10, codigo: 'INT-10', nome: 'Arroz 5kg', codigo_barras: GTIN, unidade: 'UN',
  estoque_atual: 7, ncm: '10063021', ativo: 1
};

const itemNota = (extras = {}) => ({
  codigo_barras: GTIN,
  codigo_fornecedor: 'NOVO-77',
  fornecedor_cnpj: CNPJ_NOVO,
  produto_nome: 'ARROZ T1 5KG',
  ncm: '10063021',
  unidade: 'FD',
  ...extras
});

describe('Sprint 2.4 — governança do aprendizado automático MIIP', () => {
  test('identificação automática por código de barras não cria mapeamento CNPJ + cProd', async () => {
    const banco = criarBanco([ARROZ]);
    const miip = criarMiip(banco);
    const produtoAntes = JSON.stringify(banco.produtos.get(10));

    const r = await miip.identificar(itemNota());

    assert.equal(r.produtoId, 10, 'código de barras exato continua assimilando');
    assert.equal(r.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.CODIGO_BARRAS);
    assert.equal(banco.escritas.length, 0, 'nenhuma escrita em miip_associacoes');
    assert.equal(banco.associacoes.length, 0);
    assert.equal(JSON.stringify(banco.produtos.get(10)), produtoAntes, 'cadastro, unidade, estoque e fiscal intactos');
  });

  test('reprocessar a mesma nota não cria registros', async () => {
    const banco = criarBanco([ARROZ]);
    const miip = criarMiip(banco);
    for (let i = 0; i < 3; i += 1) {
      const r = await miip.identificar(itemNota());
      assert.equal(r.produtoId, 10);
    }
    assert.equal(banco.escritas.length, 0);
    assert.equal(banco.associacoes.length, 0);
  });

  test('confirmação manual cria o mapeamento e ele passa a ser reutilizado', async () => {
    const banco = criarBanco([ARROZ]);
    const miip = criarMiip(banco);

    const fb = await miip.registrarFeedback({
      confirmado: true,
      produtoId: 10,
      fornecedorCnpj: CNPJ_NOVO,
      codigoFornecedor: 'NOVO-77',
      descricaoFornecedor: 'ARROZ T1 5KG',
      origem: 'central_revisao',
      usuarioId: 3,
      operacaoId: 'nota-1-linha-0'
    });
    assert.equal(fb.gravado, true);
    assert.equal(banco.associacoes.length, 1);
    const assoc = banco.associacoes[0];
    assert.equal(assoc.produtoId, 10);
    assert.equal(assoc.fornecedorCnpj, CNPJ_NOVO);
    assert.equal(assoc.codigoFornecedor, 'NOVO-77');
    assert.equal(assoc.origem, 'central_revisao');
    assert.equal(assoc.fonte, 'aprendizado');
    assert.equal(assoc.confirmadoPorUsuarioId, 3);
    assert.equal(assoc.metadados.tipo_confirmacao, 'manual_operador');

    const semBarras = await miip.identificar(itemNota({ codigo_barras: 'SEM GTIN' }));
    assert.equal(semBarras.produtoId, 10);
    assert.equal(semBarras.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
    assert.equal(semBarras.aprendizado.motivo, 'mapeamento_existente_reutilizado');

    const escritasAntes = banco.escritas.length;
    await miip.identificar(itemNota({ codigo_barras: 'SEM GTIN' }));
    await miip.identificar(itemNota());
    assert.equal(banco.escritas.length, escritasAntes, 'reutilização automática não escreve');
    assert.equal(banco.associacoes.length, 1);
  });

  test('mapeamento ativo e válido existente é reutilizado sem escrita', async () => {
    const banco = criarBanco([ARROZ], [
      { fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', produtoId: 10, status: 'ativa' }
    ]);
    const miip = criarMiip(banco);
    const r = await miip.identificar(itemNota({ codigo_barras: '' }));
    assert.equal(r.produtoId, 10);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
    assert.equal(banco.escritas.length, 0);
  });

  test('mapeamento inativo não é usado nem reativado automaticamente', async () => {
    const banco = criarBanco([ARROZ], [
      { fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', produtoId: 10, status: 'inativa' }
    ]);
    const miip = criarMiip(banco);
    const r = await miip.identificar(itemNota({ codigo_barras: '' }));
    assert.equal(r.produtoId, null);
    assert.notEqual(r.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(banco.escritas.length, 0);
    assert.equal(banco.associacoes[0].status, 'inativa');
  });

  test('mapeamento para produto inativo exige revisão', async () => {
    const banco = criarBanco([{ ...ARROZ, ativo: 0 }], [
      { fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', produtoId: 10, status: 'ativa' }
    ]);
    const miip = criarMiip(banco);
    const r = await miip.identificar(itemNota({ codigo_barras: '' }));
    assert.equal(r.produtoId, null);
    assert.equal(r.resultado.decisao.acao, MiipAction.REVISAR_MANUAL);
    assert.equal(banco.escritas.length, 0);
  });

  test('mapeamento conflitante (cProd → outro produto) não é sobrescrito pelo código de barras', async () => {
    const FEIJAO = { id: 20, codigo: 'INT-20', nome: 'Feijão', codigo_barras: '7891000200209', ativo: 1 };
    const banco = criarBanco([ARROZ, FEIJAO], [
      { fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', produtoId: 20, status: 'ativa' }
    ]);
    const miip = criarMiip(banco);

    const r = await miip.identificar(itemNota());
    assert.equal(r.produtoId, 10, 'hierarquia da Sprint 2.3: barras exato vence');
    assert.equal(banco.escritas.length, 0, 'mapeamento conflitante não é substituído');
    assert.equal(banco.associacoes[0].produtoId, 20);
    assert.equal(banco.associacoes[0].status, 'ativa');

    const semConfirmarTroca = await miip.registrarFeedback({
      confirmado: true, produtoId: 10, fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', origem: 'central_revisao'
    });
    assert.equal(semConfirmarTroca.pendenteDecisao, true, 'troca exige confirmação explícita de substituição');
    assert.equal(banco.escritas.length, 0);

    const forjado = await miip.registrarFeedback({
      confirmado: true, produtoId: 10, fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', origem: 'auto_motor_gtin'
    });
    assert.equal(forjado.gravado, false);
    assert.equal(forjado.motivo, 'aprendizado_automatico_nao_permitido');
    assert.equal(banco.associacoes[0].produtoId, 20);
    assert.equal(banco.escritas.length, 0);
  });

  test('Sprint 2.6 — mapeamento legado auto_motor_gtin sem código de barras só sugere, sem escrita nem reclassificação', async () => {
    const banco = criarBanco([ARROZ], [
      { fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', produtoId: 10, status: 'ativa', origem: 'auto_motor_gtin', fonte: 'aprendizado' }
    ]);
    const antes = JSON.stringify(banco.associacoes);
    const miip = criarMiip(banco);
    const r = await miip.identificar(itemNota({ codigo_barras: 'SEM GTIN' }));
    assert.equal(r.produtoId, null, 'legado automático não é confirmação humana');
    assert.equal(r.resultado.decisao.acao, MiipAction.SUGERIR);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
    assert.equal(Number(r.resultado.decisao.melhorCandidato.produtoId), 10, 'produto mapeado vira a sugestão');
    assert.equal(banco.escritas.length, 0);
    assert.equal(JSON.stringify(banco.associacoes), antes, 'registro legado intacto');
  });

  test('Sprint 2.5 — mapeamento manual cujo GTIN do XML pertence a outro produto: barras vence, mapeamento intacto', async () => {
    const CAIXA = { id: 30, codigo: 'INT-30', nome: 'Arroz cx 6', codigo_barras: '7891000300305', ativo: 1 };
    const banco = criarBanco([ARROZ, CAIXA], [
      { fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77', produtoId: 10, status: 'ativa', origem: 'Confirmacao Manual' }
    ]);
    const miip = criarMiip(banco);
    const r = await miip.identificar(itemNota({ codigo_barras: CAIXA.codigo_barras }));
    assert.equal(r.produtoId, 30, 'hierarquia 2.3: código de barras exato precede o mapeamento');
    assert.equal(banco.escritas.length, 0, 'mapeamento manual não é substituído');
    assert.equal(banco.associacoes[0].produtoId, 10);
  });

  test('confirmação manual para produto inexistente ou inativo é rejeitada', async () => {
    const banco = criarBanco([{ ...ARROZ, ativo: 0 }]);
    const miip = criarMiip(banco);
    const inativo = await miip.registrarFeedback({
      confirmado: true, produtoId: 10, fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77'
    });
    assert.equal(inativo.motivo, 'produto_inativo');
    const inexistente = await miip.registrarFeedback({
      confirmado: true, produtoId: 999, fornecedorCnpj: CNPJ_NOVO, codigoFornecedor: 'NOVO-77'
    });
    assert.equal(inexistente.motivo, 'produto_inexistente');
    assert.equal(banco.escritas.length, 0);
  });
});
