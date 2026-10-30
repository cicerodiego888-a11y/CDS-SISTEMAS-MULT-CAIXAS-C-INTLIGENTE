'use strict';

/**
 * MRT-02 — Contratos do CDS TEF Terminal Router.
 * Extensões futuras (Registry / alocação / concorrência): ver EXTENSION_POINTS.
 */

const ROUTE_CODES = Object.freeze({
  ROUTE_OK: 'ROUTE_OK',
  PDV_OBRIGATORIO_EM_MODO_STRICT: 'PDV_OBRIGATORIO_EM_MODO_STRICT',
  PDV_IDENTIDADE_INVALIDA: 'PDV_IDENTIDADE_INVALIDA',
  PDV_HOSTNAME_OU_MAC_PROIBIDO: 'PDV_HOSTNAME_OU_MAC_PROIBIDO',
  PDV_INEXISTENTE: 'PDV_INEXISTENTE',
  PDV_INATIVO: 'PDV_INATIVO',
  PDV_SEM_VINCULO: 'PDV_SEM_VINCULO',
  EMPRESA_LOJA_INCOMPATIVEL: 'EMPRESA_LOJA_INCOMPATIVEL',
  SINGLETON_FALLBACK: 'SINGLETON_FALLBACK',
  REGISTRY_RESOLVED: 'REGISTRY_RESOLVED',
  TERMINAL_INATIVO: 'TERMINAL_INATIVO',
  TERMINAL_INDISPONIVEL: 'TERMINAL_INDISPONIVEL',
  TERMINAL_NAO_PROVISIONADO: 'TERMINAL_NAO_PROVISIONADO',
  TERMINAL_AMBIGUO: 'TERMINAL_AMBIGUO',
  TERMINAL_OCUPADO: 'TERMINAL_OCUPADO',
  RUNTIME_OCUPADO: 'RUNTIME_OCUPADO',
  ALOCACAO_FALHOU: 'ALOCACAO_FALHOU',
  DISPOSITIVO_INDISPONIVEL: 'DISPOSITIVO_INDISPONIVEL',
  TERMINAL_SEM_DISPOSITIVO: 'TERMINAL_SEM_DISPOSITIVO',
  ESTACAO_NAO_VINCULADA: 'ESTACAO_NAO_VINCULADA',
  ESTACAO_REMOTA_NAO_SUPORTADA: 'ESTACAO_REMOTA_NAO_SUPORTADA',
  ROUTER_ERRO_INTERNO: 'ROUTER_ERRO_INTERNO'
});

const OPERACOES_ROUTER = Object.freeze([
  'autorizar',
  'cancelar',
  'consultar',
  'diagnosticar',
  'reimprimir'
]);

const MODOS_ROUTER = Object.freeze({
  /** MRT-02: valida PDV se informado; binding = config singleton atual. */
  COMPAT_SINGLETON: 'COMPAT_SINGLETON',
  /** MRT-03: PDV com TerminalTEF no Registry. */
  REGISTRY_RESOLVE: 'REGISTRY_RESOLVE',
  /** MRT-04: resolve + alocação de ocupação (opt-in via request.allocate). */
  ALLOCATE: 'ALLOCATE',
  /** MRT-05: resolve + ExecutionContext (topologia / estação / dispositivo). */
  EXEC_CONTEXT: 'EXEC_CONTEXT'
});

/**
 * Pontos de extensão.
 */
const EXTENSION_POINTS = Object.freeze({
  registry: 'TerminalRegistry ativo (MRT-03) — store memória + migration proposta',
  allocation: 'TerminalAllocator ativo (MRT-04) — opt-in request.allocate=true',
  concurrency: 'Destaxa GLOBAL_SERIALIZE; outros PER_TERMINAL até evidência',
  multiPdvBinding: 'Binding Registry quando há cadastro; senão LIMIT 1 singleton',
  executionContext: 'ExecutionContext MRT-05 — topologia + estação física ≠ pdvId',
  executionRemote: 'MULTI_ESTACAO Destaxa requer bridge remota — não implementada',
  persistenciaOficial: 'Migration proposta NÃO aplicada ao banco oficial (MRT-03)',
  tefManagerFinanceiro: 'Fluxo financeiro TefManager inalterado — alocação/contexto não substituem TEF-13/14',
  adapterSelection: 'MRT-12 — autorização seleciona adapter via RouteDecision.adapterBinding (sem LIMIT 1 cego)'
});

/**
 * @typedef {object} ResolveRouteRequest
 * @property {string|number|null} [pdvId] - identidade CDS = terminais.id (NÃO hostname/MAC)
 * @property {string|number|null} [empresaId]
 * @property {string|number|null} [lojaId]
 * @property {string} [operacao]
 * @property {string|null} [provedorPreferido]
 * @property {object} [hostHints] - { hostname, mac } apenas hint de estação; nunca identidade comercial
 * @property {Array} [mapaPdvEstacao] - [{ pdvId, hostname, mac }] para inferir topologia
 * @property {boolean} [exigirDispositivo]
 * @property {boolean} [exigirExecucaoLocal]
 * @property {boolean} [exigirEstacaoVinculada]
 */

/**
 * @typedef {object} RouteDecision
 * @property {boolean} sucesso
 * @property {string} codigo
 * @property {string} mensagem
 * @property {string} modo
 * @property {string|null} pdvId
 * @property {object|null} pdv
 * @property {string|null} terminalTefId - null em MRT-02 (sem Registry)
 * @property {string|null} dispositivoId - null em MRT-02
 * @property {string|null} provedor
 * @property {string|null} ambiente
 * @property {object|null} adapterBinding
 * @property {object} isolamento
 * @property {object|null} executionContext - MRT-05
 * @property {object} extensoes
 */

function criarRouteDecision(parcial = {}) {
  const sucesso = parcial.sucesso === true;
  return {
    sucesso,
    codigo: parcial.codigo || (sucesso ? ROUTE_CODES.ROUTE_OK : ROUTE_CODES.ROUTER_ERRO_INTERNO),
    mensagem: parcial.mensagem || '',
    modo: parcial.modo || MODOS_ROUTER.COMPAT_SINGLETON,
    pdvId: parcial.pdvId != null ? String(parcial.pdvId) : null,
    pdv: parcial.pdv || null,
    empresaId: parcial.empresaId != null ? String(parcial.empresaId) : null,
    lojaId: parcial.lojaId != null ? String(parcial.lojaId) : null,
    terminalTefId: parcial.terminalTefId != null ? String(parcial.terminalTefId) : null,
    dispositivoId: parcial.dispositivoId != null ? String(parcial.dispositivoId) : null,
    provedor: parcial.provedor || null,
    ambiente: parcial.ambiente || null,
    adapterBinding: parcial.adapterBinding || null,
    isolamento: parcial.isolamento || {
      lockKeySugerida: null,
      permiteParaleloNoMesmoHost: false,
      alocacaoAtiva: false
    },
    executionContext: parcial.executionContext || null,
    extensoes: {
      ...EXTENSION_POINTS,
      ...(parcial.extensoes || {})
    },
    meta: parcial.meta || null
  };
}

module.exports = {
  ROUTE_CODES,
  OPERACOES_ROUTER,
  MODOS_ROUTER,
  EXTENSION_POINTS,
  criarRouteDecision
};
