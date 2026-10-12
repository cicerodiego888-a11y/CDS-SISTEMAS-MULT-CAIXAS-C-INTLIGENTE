'use strict';

/**
 * Sprint 2.6 — identificação simples (grupos 1 a 5).
 * Serviço MIIP real (pipeline, política V2, motores de barras e fornecedor, aprendizado)
 * sobre um banco em memória que registra toda escrita.
 */

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
const { mapearDecisaoPipelineParaImportacao } = require('../../backend/motores/miip/utils/MiipResultadoImportacaoMapper');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');
const { MiipLearningMetricsCollector } = require('../../backend/motores/miip/metrics/MiipLearningMetricsCollector');
const { MiipAprendizadoLogService } = require('../../backend/motores/miip/logs/MiipAprendizadoLogService');

const CNPJ = '44444444000191';
const GTIN_SORVETE = '7898043912748';

function semZeros(c) {
  return String(c || '').replace(/^0+/, '');
}

function criarBanco(produtosIniciais = [], associacoesIniciais = []) {
  const produtos = new Map(produtosIniciais.map((p) => [p.id, { ...p }]));
  const associacoes = associacoesIniciais.map((a, i) => ({ id: i + 1, confirmacoes: 1, metadados: {}, ...a }));
  const escritas = [];
  let nextId = associacoes.length + 1;

  const produtoRepository = {
    async buscarPorGtin(gtin) {
      const p = [...produtos.values()].find((x) => x.codigo_barras === gtin);
      return p ? ProdutoSnapshot.fromRow(p) : null;
    },
    async listarPorGtin(gtin) {
      return [...produtos.values()]
        .filter((x) => x.codigo_barras && semZeros(x.codigo_barras) === semZeros(gtin))
        .map((p) => ProdutoSnapshot.fromRow(p));
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
      const ativa = associacoes.find((a) => a.fornecedorCnpj === cnpj && a.codigoFornecedor === codigo && a.status === 'ativa');
      return ativa ?? associacoes.find((a) => a.fornecedorCnpj === cnpj && a.codigoFornecedor === codigo) ?? null;
    },
    async salvarAssociacao(dados) {
      const registro = { id: nextId++, confirmacoes: 1, status: 'ativa', ...dados };
      escritas.push(['salvar', registro.id]);
      associacoes.push(registro);
      return registro;
    },
    async atualizar(id, dados) {
      const a = associacoes.find((x) => x.id === id);
      escritas.push(['atualizar', id]);
      Object.assign(a, dados);
      return { ...a };
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

  return { produtos, associacoes, escritas, produtoRepository, associacoesRepository };
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

const BOMBOM = { id: 1138, codigo: '1138', nome: 'Sorvete Frosty Bombom 2L', codigo_barras: GTIN_SORVETE, unidade: 'PCT', ativo: 1 };
const REFRI = { id: 666, codigo: '666', nome: 'Refrigerante Caju Zero 2L pct 6', codigo_barras: '7898043912731', unidade: 'PCT', ativo: 1 };

const item = (extras = {}) => ({
  codigo_barras: GTIN_SORVETE,
  codigo_fornecedor: '1111260005',
  fornecedor_cnpj: CNPJ,
  produto_nome: 'SORV FROSTY BOMBOM 2L/950G - PCT C/4 UN',
  unidade: 'PCT',
  ...extras
});

const idsCandidatos = (r) => (r.resultado.candidatos || []).map((c) => Number(c.produtoId)).sort((a, b) => a - b);

describe('Sprint 2.6 — grupo 1: código de barras único e correto', () => {
  test('barras exato em um único produto ativo identifica automaticamente, sem escrita', async () => {
    const banco = criarBanco([BOMBOM, REFRI]);
    const r = await criarMiip(banco).identificar(item());
    assert.equal(r.produtoId, 1138);
    assert.equal(r.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.CODIGO_BARRAS);
    assert.equal(banco.escritas.length, 0);
  });

  test('zero à esquerda no XML (GTIN-14 "0…") encontra o mesmo produto', async () => {
    const banco = criarBanco([BOMBOM]);
    const r = await criarMiip(banco).identificar(item({ codigo_barras: `0${GTIN_SORVETE}` }));
    assert.equal(r.produtoId, 1138);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.CODIGO_BARRAS);
  });
});

describe('Sprint 2.6 — grupo 2: sem código válido + mapeamento automático antigo', () => {
  test('legado auto_* sem barras vira sugestão; confirmação manual promove o mesmo registro', async () => {
    const banco = criarBanco([BOMBOM], [
      { fornecedorCnpj: CNPJ, codigoFornecedor: '1111260005', produtoId: 1138, status: 'ativa', origem: 'auto_motor_gtin' }
    ]);
    const miip = criarMiip(banco);

    for (const semCodigo of ['SEM GTIN', '', '00000000']) {
      const r = await miip.identificar(item({ codigo_barras: semCodigo }));
      assert.equal(r.produtoId, null, `"${semCodigo}" não é código de barras`);
      assert.equal(r.resultado.decisao.acao, MiipAction.SUGERIR);
      assert.equal(Number(r.resultado.decisao.melhorCandidato.produtoId), 1138);
      const imp = mapearDecisaoPipelineParaImportacao(null, r.resultado);
      assert.equal(imp.precisaConfirmacao, true, 'Central pergunta "É este?"');
      assert.equal(imp.associadoAutomaticamente, false);
    }
    assert.equal(banco.escritas.length, 0, 'identificar nunca escreve');

    const fb = await miip.registrarFeedback({
      confirmado: true, produtoId: 1138, fornecedorCnpj: CNPJ, codigoFornecedor: '1111260005',
      origem: 'Confirmacao Manual', usuarioId: 7
    });
    assert.equal(fb.sucesso, true);
    assert.equal(fb.promovida, true);
    assert.equal(banco.associacoes.length, 1, 'mesmo registro, sem duplicar');
    const assoc = banco.associacoes[0];
    assert.equal(assoc.origem, 'Confirmacao Manual');
    assert.equal(assoc.metadados.origem_anterior, 'auto_motor_gtin', 'histórico preservado');
    assert.equal(assoc.metadados.tipo_confirmacao, 'manual_operador');
    assert.equal(assoc.confirmadoPorUsuarioId, 7);

    const depois = await miip.identificar(item({ codigo_barras: 'SEM GTIN' }));
    assert.equal(depois.produtoId, 1138, 'após confirmação humana passa a ser automático');
    assert.equal(depois.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
  });
});

describe('Sprint 2.6 — grupo 3: código de barras duplicado', () => {
  const DUP_A = { id: 1165, codigo: '1165', nome: 'Sorvete Napolitano 2L', codigo_barras: '7898043912755', ativo: 1 };
  const DUP_B = { id: 1167, codigo: '1167', nome: 'SORV FROSTY NAPOLITANO 2L', codigo_barras: '7898043912755', ativo: 1 };

  test('mesmo código em dois produtos ativos: pergunta, não escolhe o primeiro', async () => {
    const banco = criarBanco([DUP_A, DUP_B]);
    const r = await criarMiip(banco).identificar(item({ codigo_barras: '7898043912755', codigo_fornecedor: '1111260001' }));
    assert.equal(r.produtoId, null);
    assert.equal(r.resultado.decisao.acao, MiipAction.REVISAR_MANUAL);
    assert.equal(r.resultado.decisao.motivo, 'codigo_barras_ambiguo');
    assert.deepEqual(idsCandidatos(r), [1165, 1167], 'os dois aparecem para escolha');
    assert.equal(banco.escritas.length, 0);

    const imp = mapearDecisaoPipelineParaImportacao(null, r.resultado);
    assert.equal(imp.acao, 'revisar_manual', 'a tela recebe a ação em minúsculas');
    assert.equal(imp.motivoIdentificacao, 'codigo_barras_ambiguo', 'a tela precisa do motivo para o texto da pergunta');
    assert.deepEqual(imp.candidatos.map((c) => Number(c.produtoId)).sort((a, b) => a - b), [1165, 1167]);
  });

  test('duplicado com mapeamento automático antigo para um deles continua perguntando', async () => {
    const banco = criarBanco([DUP_A, DUP_B], [
      { fornecedorCnpj: CNPJ, codigoFornecedor: '1111260001', produtoId: 1165, status: 'ativa', origem: 'auto_motor_gtin' }
    ]);
    const r = await criarMiip(banco).identificar(item({ codigo_barras: '7898043912755', codigo_fornecedor: '1111260001' }));
    assert.equal(r.produtoId, null);
    assert.equal(r.resultado.decisao.acao, MiipAction.REVISAR_MANUAL);
    assert.equal(banco.escritas.length, 0);
  });

  test('duplicado já resolvido por confirmação humana deste fornecedor + código: não pergunta de novo', async () => {
    const banco = criarBanco([DUP_A, DUP_B], [
      { fornecedorCnpj: CNPJ, codigoFornecedor: '1111260001', produtoId: 1167, status: 'ativa', origem: 'Confirmacao Manual' }
    ]);
    const miip = criarMiip(banco);
    const r = await miip.identificar(item({ codigo_barras: '7898043912755', codigo_fornecedor: '1111260001' }));
    assert.equal(r.produtoId, 1167);
    assert.equal(r.resultado.decisao.motivo, 'codigo_barras_repetido_resolvido_por_confirmacao');

    const outroFornecedor = await miip.identificar(item({
      codigo_barras: '7898043912755', codigo_fornecedor: '1111260001', fornecedor_cnpj: '55555555000191'
    }));
    assert.equal(outroFornecedor.produtoId, null, 'a escolha vale só para o mesmo fornecedor + código');
    assert.equal(banco.escritas.length, 0);
  });

  test('duplicado com um dos cadastros inativo: o ativo é identificado', async () => {
    const banco = criarBanco([DUP_A, { ...DUP_B, ativo: 0 }]);
    const r = await criarMiip(banco).identificar(item({ codigo_barras: '7898043912755', codigo_fornecedor: '1111260001' }));
    assert.equal(r.produtoId, 1165);
  });
});

describe('Sprint 2.6 — grupo 4: mapeamento manual conflitante', () => {
  const manualErrado = () => criarBanco([BOMBOM, REFRI], [
    { fornecedorCnpj: CNPJ, codigoFornecedor: '1111260005', produtoId: 666, status: 'ativa', origem: 'Confirmacao Manual' }
  ]);

  test('barras único de outro produto vence; mapeamento manual não é reescrito', async () => {
    const banco = manualErrado();
    const r = await criarMiip(banco).identificar(item());
    assert.equal(r.produtoId, 1138);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.CODIGO_BARRAS);
    assert.equal(banco.escritas.length, 0);
    assert.equal(banco.associacoes[0].produtoId, 666);
    assert.equal(banco.associacoes[0].status, 'ativa');
  });

  test('sem código de barras, a escolha manual registrada continua valendo', async () => {
    const banco = manualErrado();
    const r = await criarMiip(banco).identificar(item({ codigo_barras: 'SEM GTIN' }));
    assert.equal(r.produtoId, 666);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
  });

  test('trocar o mapeamento exige confirmação explícita e preserva o anterior', async () => {
    const banco = manualErrado();
    const miip = criarMiip(banco);
    const pedido = await miip.registrarFeedback({
      confirmado: true, produtoId: 1138, fornecedorCnpj: CNPJ, codigoFornecedor: '1111260005', origem: 'Confirmacao Manual'
    });
    assert.equal(pedido.pendenteDecisao, true);
    assert.equal(pedido.conflito.produtoAtual, 666);
    assert.equal(banco.escritas.length, 0);

    const troca = await miip.registrarFeedback({
      confirmado: true, produtoId: 1138, fornecedorCnpj: CNPJ, codigoFornecedor: '1111260005',
      origem: 'Confirmacao Manual', confirmarSubstituicao: true
    });
    assert.equal(troca.substituida, true);
    assert.equal(banco.associacoes.length, 2);
    assert.equal(banco.associacoes[0].status, 'inativa', 'anterior preservado como histórico');
    assert.equal(banco.associacoes[1].produtoId, 1138);
    assert.equal(banco.associacoes[1].metadados.substituiuAssociacaoId, 1);
  });
});

describe('Sprint 2.6 — grupo 5: produto inativo ou sem correspondência', () => {
  test('código de barras só em produto inativo: não vincula, pede cadastro', async () => {
    const banco = criarBanco([{ ...BOMBOM, ativo: 0 }]);
    const r = await criarMiip(banco).identificar(item());
    assert.equal(r.produtoId, null);
    assert.equal(r.resultado.decisao.acao, MiipAction.CRIAR_NOVO);
    assert.equal(r.resultado.decisao.motivo, 'codigo_barras_produto_inativo');
    const imp = mapearDecisaoPipelineParaImportacao(null, r.resultado);
    assert.equal(imp.associadoAutomaticamente, false);
    assert.equal(imp.precisaCadastro, true);
    assert.equal(Number(imp.produtoEncontrado.ativo), 0, 'a tela sabe que o produto está desativado');
  });

  test('mapeamento manual para produto inativo não vincula', async () => {
    const banco = criarBanco([{ ...REFRI, ativo: 0 }], [
      { fornecedorCnpj: CNPJ, codigoFornecedor: '1111260005', produtoId: 666, status: 'ativa', origem: 'Confirmacao Manual' }
    ]);
    const r = await criarMiip(banco).identificar(item({ codigo_barras: 'SEM GTIN' }));
    assert.equal(r.produtoId, null);
    assert.notEqual(r.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
  });

  test('sem nenhuma correspondência: pendente para vincular ou cadastrar', async () => {
    const banco = criarBanco([REFRI]);
    const r = await criarMiip(banco).identificar(item({ codigo_barras: 'SEM GTIN', codigo_fornecedor: 'X-1' }));
    assert.equal(r.produtoId, null);
    assert.equal(r.resultado.decisao.acao, MiipAction.CRIAR_NOVO);
    const imp = mapearDecisaoPipelineParaImportacao(null, r.resultado);
    assert.equal(imp.precisaCadastro, true);
    assert.equal(imp.produtoEncontrado, null);
    assert.equal(banco.escritas.length, 0);
  });
});

describe('Sprint 2.6 — tela de Compras respeita a decisão tomada na Central', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const fonte = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/compras.js'), 'utf8');

  function extrair(nome) {
    const inicio = fonte.indexOf(`function ${nome}(`);
    assert.ok(inicio >= 0, `função ${nome} não encontrada em compras.js`);
    const fim = fonte.indexOf('\n}\n', inicio);
    return fonte.slice(inicio, fim + 2);
  }

  function criarTela(origemCentral) {
    const ctx = {
      isOrigemCompraCentralNfe: () => origemCentral,
      MIIP_MOTOR_LABELS_COMPRA: {}
    };
    vm.createContext(ctx);
    vm.runInContext([
      'montarSugestaoMiipCompraFromResultado',
      'extrairProdutoIdSugestaoMiip',
      'itemCompraJaDecididoNaCentral',
      'obterSugestaoMiipItemCompra'
    ].map(extrair).join('\n'), ctx);
    return ctx;
  }

  // Linha 2 da NF 926002 validada no navegador: operador escolheu #1167 na Central;
  // o miip_resultado ainda traz a sugestão anterior (#1165).
  const linhaDecidida = () => ({
    produto_id: 1167,
    miip_resultado: {
      precisaConfirmacao: true,
      acao: 'revisar_manual',
      produtoEncontrado: { id: 1165, nome: 'sorvete frosty napolitano 2l' }
    },
    miip_sugestao: { produtoId: 1165, encontrado: true, status: 'pendente' }
  });

  test('entrada da Central com produto decidido: não volta a sugerir outro produto', () => {
    const tela = criarTela(true);
    assert.equal(tela.obterSugestaoMiipItemCompra(linhaDecidida()), null);
    const semSugestaoGravada = { ...linhaDecidida(), miip_sugestao: undefined };
    assert.equal(tela.obterSugestaoMiipItemCompra(semSugestaoGravada), null);
  });

  test('entrada da Central sem produto ainda: a sugestão continua aparecendo', () => {
    const tela = criarTela(true);
    const linha = { ...linhaDecidida(), produto_id: null, miip_sugestao: undefined };
    assert.equal(tela.obterSugestaoMiipItemCompra(linha).produtoId, 1165);
  });

  test('escolha feita na própria tela de Compras continua visível como confirmada', () => {
    const tela = criarTela(true);
    const linha = { ...linhaDecidida(), miip_sugestao: { produtoId: 1167, encontrado: true, status: 'confirmado' } };
    assert.equal(tela.obterSugestaoMiipItemCompra(linha).status, 'confirmado');
  });

  test('compra manual com XML (fora da Central): comportamento anterior mantido', () => {
    const tela = criarTela(false);
    assert.equal(tela.obterSugestaoMiipItemCompra(linhaDecidida()).produtoId, 1165);
  });
});
