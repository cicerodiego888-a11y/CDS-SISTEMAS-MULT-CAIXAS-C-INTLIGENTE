'use strict';

/**
 * TEF-17 — Política segura de cancelamento/estorno Destaxa.
 *
 * Evidência documental (Destaxa 1.83):
 * - docs/06: operação `EST` = "Estorno de transação" via iniciaTransacaoDestaxa.
 *   Campos de entrada específicos de EST NÃO estão documentados (somente exemplos CRT).
 * - docs/08: finalizaTransacaoDestaxa(confirmacao=9) aborta a transação corrente /
 *   pendentes no Client — distinto de EST (estorno comercial de tx já aprovada).
 * - DLL: apenas 4 exports; não há função dedicada de cancelamento.
 *
 * Regra: o CDS nunca afirma cancelamento/estorno sem confirmação financeira válida
 * do provedor. Timeout ≠ cancelamento. EST não é executado inventando parâmetros.
 */

const tefContrato = require('../tefContrato');
const { OPERACOES, FINALIZACAO_CANCELAR, FINALIZACAO_CONFIRMAR, ERROS } = require('./destaxaConstantes');

const OUTCOMES = Object.freeze({
  CONFIRMADO: 'CANCELAMENTO_CONFIRMADO',
  RECUSADO: 'CANCELAMENTO_RECUSADO',
  NAO_SUPORTADO: 'CANCELAMENTO_NAO_SUPORTADO',
  INCONCLUSIVO: 'CANCELAMENTO_INCONCLUSIVO',
  DADOS_INSUFICIENTES: 'CANCELAMENTO_DADOS_INSUFICIENTES',
  TIMEOUT: 'CANCELAMENTO_TIMEOUT'
});

const CODIGOS = Object.freeze({
  NAO_SUPORTADO: 'DESTAXA_CANCELAMENTO_NAO_SUPORTADO',
  DADOS_INSUFICIENTES: 'DESTAXA_CANCELAMENTO_DADOS_INSUFICIENTES',
  RECUSADO: 'DESTAXA_CANCELAMENTO_RECUSADO',
  INCONCLUSIVO: 'DESTAXA_CANCELAMENTO_INCONCLUSIVO',
  TIMEOUT: 'DESTAXA_CANCELAMENTO_TIMEOUT',
  CONFIRMADO: 'DESTAXA_CANCELAMENTO_CONFIRMADO'
});

/**
 * Contrato real auditado — não inventar campos EST.
 */
const CONTRATO_CANCELAMENTO_DESTAXA = Object.freeze({
  versaoDocumentacao: '1.83',
  fontes: Object.freeze([
    '06-api-iniciatransacaodestaxa.md',
    '08-api-finalizatransacaodestaxa.md',
    '04-interface-dll-ac.md'
  ]),
  exportsDll: Object.freeze([
    'iniciaClientDestaxa',
    'iniciaTransacaoDestaxa',
    'continuaTransacaoDestaxa',
    'finalizaTransacaoDestaxa'
  ]),
  exportCancelamentoDedicado: false,
  operacaoEstorno: OPERACOES.EST,
  operacaoEstornoDescricao: 'Estorno de transação',
  camposEntradaEstDocumentados: null,
  camposEntradaEstInventadosProibidos: true,
  abortarTransacaoCorrente: Object.freeze({
    api: 'finalizaTransacaoDestaxa',
    confirmacaoCancelar: FINALIZACAO_CANCELAR,
    confirmacaoConfirmar: FINALIZACAO_CONFIRMAR,
    distintoDeEstornoComercial: true,
    podeSerRecusadoPeloClient: true,
    codigoRecusaContinuarFluxo: '99'
  }),
  timeoutNaoCancela: true,
  estornoComercialHabilitadoNoCds: false,
  motivoBloqueioEstorno: 'Campos de entrada da operação EST não documentados oficialmente; execução real bloqueada (TEF-17).'
});

function textoPresente(valor) {
  return valor != null && String(valor).trim() !== '';
}

/**
 * Dados tipicamente necessários para localizar uma tx a estornar.
 * Sem lista oficial Destaxa de chaves EST — usados só para diagnóstico CDS.
 */
function avaliarDadosPedido(dados = {}) {
  const nsu = dados.nsu ?? dados.transacao_nsu ?? null;
  const autorizacao = dados.autorizacao ?? dados.transacao_autorizacao ?? null;
  const data = dados.data ?? dados.transacao_data ?? dados.data_transacao ?? null;
  const terminal = dados.terminal ?? null;
  const valor = dados.valor ?? dados.transacao_valor ?? null;

  const presentes = {
    nsu: textoPresente(nsu),
    autorizacao: textoPresente(autorizacao),
    data: textoPresente(data),
    terminal: textoPresente(terminal),
    valor: textoPresente(valor)
  };

  const obrigatoriosCds = ['nsu', 'autorizacao'];
  const faltando = obrigatoriosCds.filter((k) => !presentes[k]);

  return {
    nsu: presentes.nsu ? String(nsu).trim() : null,
    autorizacao: presentes.autorizacao ? String(autorizacao).trim() : null,
    data: presentes.data ? String(data).trim() : null,
    terminal: presentes.terminal ? String(terminal).trim() : null,
    valor: presentes.valor ? String(valor).trim() : null,
    presentes,
    faltando,
    dadosSuficientesParaTentativaFutura: faltando.length === 0
  };
}

/**
 * Avalia pedido de cancelamento/estorno comercial Destaxa sem chamar a DLL.
 */
function avaliarPedidoCancelamento(dados = {}, opcoes = {}) {
  const avaliacaoDados = avaliarDadosPedido(dados);
  const forcarExecucaoTeste = opcoes.permitirSimulacaoProvedor === true;

  if (!CONTRATO_CANCELAMENTO_DESTAXA.estornoComercialHabilitadoNoCds && !forcarExecucaoTeste) {
    return {
      podeExecutarNoProvedor: false,
      outcome: OUTCOMES.NAO_SUPORTADO,
      codigo: CODIGOS.NAO_SUPORTADO,
      mensagem: CONTRATO_CANCELAMENTO_DESTAXA.motivoBloqueioEstorno,
      avaliacaoDados,
      contrato: CONTRATO_CANCELAMENTO_DESTAXA,
      cancelConfirmed: false,
      financialState: 'UNCHANGED'
    };
  }

  if (!avaliacaoDados.dadosSuficientesParaTentativaFutura) {
    return {
      podeExecutarNoProvedor: false,
      outcome: OUTCOMES.DADOS_INSUFICIENTES,
      codigo: CODIGOS.DADOS_INSUFICIENTES,
      mensagem: `Cancelamento Destaxa sem dados obrigatórios: ${avaliacaoDados.faltando.join(', ')}`,
      avaliacaoDados,
      contrato: CONTRATO_CANCELAMENTO_DESTAXA,
      cancelConfirmed: false,
      financialState: 'UNCHANGED'
    };
  }

  return {
    podeExecutarNoProvedor: true,
    outcome: null,
    codigo: null,
    mensagem: null,
    avaliacaoDados,
    contrato: CONTRATO_CANCELAMENTO_DESTAXA,
    cancelConfirmed: false,
    financialState: 'UNCHANGED'
  };
}

/**
 * Mapeia resultado do provedor (mock ou futuro EST) → outcome seguro.
 * Nunca promove timeout/erro/desconhecido a cancelado.
 */
function mapearResultadoProvedor(resultado = {}, contexto = {}) {
  const classificacao = String(resultado.classificacao || resultado.protocolState || '').toUpperCase();
  const codigoDestaxa = String(resultado.codigoDestaxa || resultado.codigo || '').trim().toUpperCase();
  const timeout = resultado.timeout === true
    || classificacao === 'TIMEOUT'
    || codigoDestaxa === '08';

  if (timeout) {
    return {
      outcome: OUTCOMES.TIMEOUT,
      codigo: CODIGOS.TIMEOUT,
      mensagem: resultado.mensagem || 'Timeout durante cancelamento Destaxa — não confirma estorno',
      cancelConfirmed: false,
      financialState: 'UNCHANGED',
      status: tefContrato.STATUS.PENDENTE
    };
  }

  if (resultado.recusado === true || classificacao === 'DENIED' || ['05', '06', '07'].includes(codigoDestaxa)) {
    return {
      outcome: OUTCOMES.RECUSADO,
      codigo: CODIGOS.RECUSADO,
      mensagem: resultado.mensagem || 'Cancelamento/estorno Destaxa recusado pelo provedor',
      cancelConfirmed: false,
      financialState: 'UNCHANGED',
      status: tefContrato.STATUS.NEGADO
    };
  }

  const aprovadoProvedor = resultado.sucesso === true
    && (classificacao === 'SUCCESS' || codigoDestaxa === '00' || resultado.confirmadoPeloProvedor === true);

  if (aprovadoProvedor) {
    return {
      outcome: OUTCOMES.CONFIRMADO,
      codigo: CODIGOS.CONFIRMADO,
      mensagem: resultado.mensagem || 'Cancelamento/estorno Destaxa confirmado pelo provedor',
      cancelConfirmed: true,
      financialState: 'CANCELLED',
      status: tefContrato.STATUS.CANCELADO
    };
  }

  if (resultado.naoSuportado === true) {
    return {
      outcome: OUTCOMES.NAO_SUPORTADO,
      codigo: CODIGOS.NAO_SUPORTADO,
      mensagem: resultado.mensagem || CONTRATO_CANCELAMENTO_DESTAXA.motivoBloqueioEstorno,
      cancelConfirmed: false,
      financialState: 'UNCHANGED',
      status: tefContrato.STATUS.ERRO
    };
  }

  return {
    outcome: OUTCOMES.INCONCLUSIVO,
    codigo: CODIGOS.INCONCLUSIVO,
    mensagem: resultado.mensagem
      || 'Resultado de cancelamento Destaxa inconclusivo — transação permanece rastreável sem estorno financeiro',
    cancelConfirmed: false,
    financialState: 'UNCHANGED',
    status: tefContrato.STATUS.PENDENTE,
    detalhe: { classificacao, codigoDestaxa, contexto }
  };
}

function montarRespostaCancelamento(avaliacao, info = {}, extras = {}) {
  const mapeado = extras.mapeado || null;
  const outcome = mapeado?.outcome || avaliacao.outcome || OUTCOMES.NAO_SUPORTADO;
  const codigo = mapeado?.codigo || avaliacao.codigo || CODIGOS.NAO_SUPORTADO;
  const cancelConfirmed = mapeado?.cancelConfirmed === true;
  const status = cancelConfirmed
    ? tefContrato.STATUS.CANCELADO
    : (mapeado?.status || tefContrato.STATUS.ERRO);
  const mensagem = mapeado?.mensagem || avaliacao.mensagem || CONTRATO_CANCELAMENTO_DESTAXA.motivoBloqueioEstorno;

  return tefContrato.criarRespostaCancelamento({
    sucesso: cancelConfirmed,
    status,
    nsu: info.nsu || avaliacao.avaliacaoDados?.nsu || null,
    autorizacao: info.autorizacao || avaliacao.avaliacaoDados?.autorizacao || null,
    transacaoId: info.transacao_id || info.transacaoId || null,
    codigo,
    mensagem,
    cancelConfirmed,
    cancelOutcome: outcome,
    financialState: cancelConfirmed ? 'CANCELLED' : 'UNCHANGED',
    payloadRetorno: {
      provedor: 'DESTAXA',
      politica: 'TEF-17',
      outcome,
      cancelConfirmed,
      financialState: cancelConfirmed ? 'CANCELLED' : 'UNCHANGED',
      contrato: {
        operacaoEstorno: CONTRATO_CANCELAMENTO_DESTAXA.operacaoEstorno,
        camposEntradaEstDocumentados: CONTRATO_CANCELAMENTO_DESTAXA.camposEntradaEstDocumentados,
        abortarCorrenteDistintoDeEstorno: true,
        finalizacaoCancelar: FINALIZACAO_CANCELAR,
        estornoComercialHabilitadoNoCds: CONTRATO_CANCELAMENTO_DESTAXA.estornoComercialHabilitadoNoCds
      },
      avaliacaoDados: avaliacao.avaliacaoDados || null,
      provedorBruto: extras.provedorBruto || null
    },
    modo: extras.modo || 'real'
  });
}

/**
 * Resposta segura padrão do adapter (sem EXECUTAR EST/INIT).
 */
function responderCancelamentoSeguro(dados = {}, opcoes = {}) {
  const info = {
    transacao_id: dados.transacao_id || dados.transacaoId || null,
    nsu: dados.nsu || null,
    autorizacao: dados.autorizacao || null,
    motivo: dados.motivo || null
  };

  const avaliacao = avaliarPedidoCancelamento(dados, opcoes);

  if (opcoes.resultadoProvedorSimulado != null) {
    if (!avaliacao.podeExecutarNoProvedor && avaliacao.outcome === OUTCOMES.DADOS_INSUFICIENTES) {
      return montarRespostaCancelamento(avaliacao, info, { modo: opcoes.modo || 'real' });
    }
    const mapeado = mapearResultadoProvedor(opcoes.resultadoProvedorSimulado, { origem: 'simulacao_teste' });
    return montarRespostaCancelamento(
      { ...avaliacao, outcome: mapeado.outcome, codigo: mapeado.codigo, mensagem: mapeado.mensagem },
      info,
      { mapeado, provedorBruto: opcoes.resultadoProvedorSimulado, modo: opcoes.modo || 'teste' }
    );
  }

  return montarRespostaCancelamento(avaliacao, info, { modo: opcoes.modo || 'real' });
}

module.exports = {
  OUTCOMES,
  CODIGOS,
  CONTRATO_CANCELAMENTO_DESTAXA,
  avaliarDadosPedido,
  avaliarPedidoCancelamento,
  mapearResultadoProvedor,
  montarRespostaCancelamento,
  responderCancelamentoSeguro,
  cancelamentoConfirmado: tefContrato.cancelamentoConfirmado,
  ERROS_REF: ERROS
};
