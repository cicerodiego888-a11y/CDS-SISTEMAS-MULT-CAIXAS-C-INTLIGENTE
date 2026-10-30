'use strict';

/**
 * MRT-12 — Seleção de adapter orientada pelo RouteDecision.
 *
 * Autorização: usa exclusivamente adapterBinding da decisão do TerminalRouter.
 * NÃO faz fallback arbitrário para buscarConfiguracaoPrincipal / LIMIT 1.
 *
 * Compatibilidade singleton Destaxa: quando o Router devolve COMPAT_SINGLETON
 * com binding carregado por singletonFallback, a seleção consome esse registro
 * (mesma origem LIMIT 1, mas já decidida pelo roteador — sem segunda consulta cega).
 *
 * Pós-autorização (consulta/cancelamento/estorno): tefAdapterCiclo
 * resolve pelo vínculo da transação (MRT-13). status() de instalação
 * permanece em tefFactory.obterAdapter — singleton de instalação.
 */

const { criarAdapter, provedorReconhecido } = require('./tefFactory');

const SELECTION_CODES = Object.freeze({
  ADAPTER_OK: 'ADAPTER_OK',
  ROUTE_DECISION_AUSENTE: 'ADAPTER_ROUTE_DECISION_AUSENTE',
  ROUTE_DECISION_FALHOU: 'ADAPTER_ROUTE_DECISION_FALHOU',
  BINDING_AUSENTE: 'ADAPTER_BINDING_AUSENTE',
  REGISTRO_AUSENTE: 'ADAPTER_REGISTRO_AUSENTE',
  PROVEDOR_AUSENTE: 'ADAPTER_PROVEDOR_AUSENTE',
  PROVEDOR_NAO_RECONHECIDO: 'ADAPTER_PROVEDOR_NAO_RECONHECIDO',
  ADAPTER_CRIACAO_FALHOU: 'ADAPTER_CRIACAO_FALHOU'
});

function erroSelecao(codigo, mensagem, detalhes = {}) {
  const error = new Error(mensagem);
  error.codigo = codigo;
  error.code = codigo;
  error.detalhes = detalhes;
  error.tefAdapterSelection = true;
  return error;
}

/**
 * Extrai provedor / registro / identidades a partir da RouteDecision sem criar adapter.
 * @returns {{ ok: boolean, codigo: string, mensagem: string, provedor: string|null, registro: object|null, terminalTefId: string|null, modo: string|null, fonte: string|null, executionContext: object|null }}
 */
function inspecionarSelecaoPorRouteDecision(routeDecision) {
  if (routeDecision == null) {
    return {
      ok: false,
      codigo: SELECTION_CODES.ROUTE_DECISION_AUSENTE,
      mensagem: 'RouteDecision ausente — seleção de adapter exige decisão do TerminalRouter',
      provedor: null,
      registro: null,
      terminalTefId: null,
      modo: null,
      fonte: null,
      executionContext: null
    };
  }

  if (routeDecision.sucesso !== true) {
    return {
      ok: false,
      codigo: SELECTION_CODES.ROUTE_DECISION_FALHOU,
      mensagem: routeDecision.mensagem
        || `RouteDecision sem sucesso (${routeDecision.codigo || 'sem código'}) — adapter não selecionado`,
      provedor: routeDecision.provedor || null,
      registro: null,
      terminalTefId: routeDecision.terminalTefId || null,
      modo: routeDecision.modo || null,
      fonte: null,
      executionContext: routeDecision.executionContext || null
    };
  }

  const binding = routeDecision.adapterBinding;
  if (!binding) {
    return {
      ok: false,
      codigo: SELECTION_CODES.BINDING_AUSENTE,
      mensagem: 'adapterBinding ausente na RouteDecision — sem fallback LIMIT 1 na autorização',
      provedor: routeDecision.provedor || null,
      registro: null,
      terminalTefId: routeDecision.terminalTefId || null,
      modo: routeDecision.modo || null,
      fonte: null,
      executionContext: routeDecision.executionContext || null
    };
  }

  const registro = binding.registro;
  if (!registro || typeof registro !== 'object') {
    return {
      ok: false,
      codigo: SELECTION_CODES.REGISTRO_AUSENTE,
      mensagem: 'adapterBinding.registro ausente — configuração TEF não resolvida pelo Router',
      provedor: routeDecision.provedor || null,
      registro: null,
      terminalTefId: routeDecision.terminalTefId || binding.terminalTefId || null,
      modo: routeDecision.modo || binding.modo || null,
      fonte: binding.fonte || null,
      executionContext: routeDecision.executionContext || null
    };
  }

  const provedorRaw = registro.provedor
    || registro.tefProvedor
    || routeDecision.provedor
    || null;
  const provedor = String(provedorRaw || '').trim().toLowerCase() || null;

  if (!provedor) {
    return {
      ok: false,
      codigo: SELECTION_CODES.PROVEDOR_AUSENTE,
      mensagem: 'Provedor TEF ausente na RouteDecision/adapterBinding — erro explícito, sem seleção arbitrária',
      provedor: null,
      registro,
      terminalTefId: routeDecision.terminalTefId || binding.terminalTefId || null,
      modo: routeDecision.modo || binding.modo || null,
      fonte: binding.fonte || null,
      executionContext: routeDecision.executionContext || null
    };
  }

  if (!provedorReconhecido(provedor)) {
    return {
      ok: false,
      codigo: SELECTION_CODES.PROVEDOR_NAO_RECONHECIDO,
      mensagem: `Provedor TEF não reconhecido/suportado: ${provedor}`,
      provedor,
      registro,
      terminalTefId: routeDecision.terminalTefId || binding.terminalTefId || null,
      modo: routeDecision.modo || binding.modo || null,
      fonte: binding.fonte || null,
      executionContext: routeDecision.executionContext || null
    };
  }

  return {
    ok: true,
    codigo: SELECTION_CODES.ADAPTER_OK,
    mensagem: 'Seleção orientada pelo RouteDecision pronta',
    provedor,
    registro: { ...registro, provedor },
    terminalTefId: routeDecision.terminalTefId != null
      ? String(routeDecision.terminalTefId)
      : (binding.terminalTefId != null ? String(binding.terminalTefId) : null),
    modo: routeDecision.modo || binding.modo || null,
    fonte: binding.fonte || null,
    executionContext: routeDecision.executionContext || null,
    executionMode: binding.executionMode || null,
    ambiente: registro.ambiente || registro.tefAmbiente || routeDecision.ambiente || null
  };
}

/**
 * Cria o adapter a partir da RouteDecision validada.
 * @returns {{ adapter, provedor, terminalTefId, modo, fonte, executionContext, executionMode, registro, codigo, mensagem }}
 */
function selecionarAdapterPorRouteDecision(routeDecision, opcoes = {}) {
  const insp = inspecionarSelecaoPorRouteDecision(routeDecision);
  if (!insp.ok) {
    throw erroSelecao(insp.codigo, insp.mensagem, {
      provedor: insp.provedor,
      terminalTefId: insp.terminalTefId,
      modo: insp.modo,
      fonte: insp.fonte
    });
  }

  let adapter;
  try {
    adapter = criarAdapter(insp.registro, opcoes);
  } catch (error) {
    const codigo = error.codigo || error.code || SELECTION_CODES.ADAPTER_CRIACAO_FALHOU;
    throw erroSelecao(
      codigo,
      error.message || 'Falha ao criar adapter a partir da RouteDecision',
      {
        provedor: insp.provedor,
        terminalTefId: insp.terminalTefId,
        modo: insp.modo,
        fonte: insp.fonte,
        causa: error.detalhes || null
      }
    );
  }

  if (!adapter) {
    throw erroSelecao(
      SELECTION_CODES.ADAPTER_CRIACAO_FALHOU,
      `Adapter inexistente para provedor "${insp.provedor}"`,
      { provedor: insp.provedor }
    );
  }

  return {
    adapter,
    provedor: insp.provedor,
    terminalTefId: insp.terminalTefId,
    modo: insp.modo,
    fonte: insp.fonte,
    executionContext: insp.executionContext,
    executionMode: insp.executionMode,
    registro: insp.registro,
    ambiente: insp.ambiente,
    codigo: SELECTION_CODES.ADAPTER_OK,
    mensagem: insp.mensagem
  };
}

module.exports = {
  SELECTION_CODES,
  inspecionarSelecaoPorRouteDecision,
  selecionarAdapterPorRouteDecision,
  erroSelecao
};
