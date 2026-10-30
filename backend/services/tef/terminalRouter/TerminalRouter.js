'use strict';

/**
 * CDS TEF Terminal Router — MRT-02/03/04/05
 *
 * MRT-04: alocação opt-in via request.allocate === true (não altera fluxo
 * financeiro do TefManager, que continua resolve sem allocate).
 * MRT-05: ExecutionContext (topologia / estação / dispositivo) anexado à decisão.
 */

const {
  ROUTE_CODES,
  OPERACOES_ROUTER,
  MODOS_ROUTER,
  EXTENSION_POINTS,
  criarRouteDecision
} = require('./contracts');
const { criarPdvIdentityValidator } = require('./pdvIdentityValidator');
const { carregarBindingSingleton } = require('./singletonFallback');
const {
  obterTerminalRegistry,
  REGISTRY_CODES
} = require('../terminalRegistry');
const {
  obterTerminalAllocator,
  ALLOCATION_CODES,
  RELEASE_REASONS
} = require('../terminalAllocator');
const {
  obterExecutionContextResolver,
  EXEC_CODES
} = require('../executionContext');

class TerminalRouter {
  constructor(opcoes = {}) {
    this._modoPadrao = opcoes.modo || MODOS_ROUTER.COMPAT_SINGLETON;
    this._exigirPdvId = opcoes.exigirPdvId === true;
    this._identity = opcoes.identityValidator || criarPdvIdentityValidator(opcoes.identityDeps || {});
    this._carregarSingleton = opcoes.carregarBindingSingleton || carregarBindingSingleton;
    this._depsSingleton = opcoes.singletonDeps || {};
    this._registry = opcoes.registry || null;
    this._allocator = opcoes.allocator || null;
    this._execResolver = opcoes.executionContextResolver || null;
    this._mapaPdvEstacao = Array.isArray(opcoes.mapaPdvEstacao) ? opcoes.mapaPdvEstacao : [];
  }

  _getRegistry() {
    return this._registry || obterTerminalRegistry();
  }

  _getAllocator() {
    return this._allocator || obterTerminalAllocator();
  }

  _getExecResolver() {
    return this._execResolver || obterExecutionContextResolver();
  }

  _montarMapaPdvEstacao(request = {}) {
    if (Array.isArray(request.mapaPdvEstacao) && request.mapaPdvEstacao.length) {
      return request.mapaPdvEstacao;
    }
    if (this._mapaPdvEstacao.length) return this._mapaPdvEstacao;
    // Deriva de meta.estacao nos terminais do Registry (quando cadastrado)
    try {
      return this._getRegistry().listarTodos().map((t) => ({
        pdvId: t.pdvId,
        hostname: t.meta?.estacaoHostname || t.meta?.hostname || null,
        mac: t.meta?.estacaoMac || t.meta?.mac || null
      })).filter((m) => m.pdvId && (m.hostname || m.mac));
    } catch (_) {
      return [];
    }
  }

  /**
   * Libera lease obtido via resolve({ allocate: true }).
   * Respeita bloqueio de operação inconclusiva (MRT-04 / TEF-14).
   */
  liberarAlocacao(leaseId, motivo = RELEASE_REASONS.SUCESSO_CONFIRMADO, opcoes = {}) {
    return this._getAllocator().liberar(leaseId, motivo, opcoes);
  }

  marcarAlocacaoInconclusiva(leaseId) {
    return this._getAllocator().marcarInconclusivo(leaseId);
  }

  /**
   * MRT-05 — Resolve e anexa ExecutionContext. Bloqueia só quando dispositivo
   * inativo (default) ou flags exigir* explícitas. Não substitui locks MRT-04.
   */
  _aplicarExecutionContext(decision, request = {}, extras = {}) {
    if (!decision) return decision;

    const resolvido = this._getExecResolver().resolver({
      pdvId: decision.pdvId,
      pdv: decision.pdv,
      hostHints: request.hostHints || {},
      terminalTefId: decision.terminalTefId,
      dispositivo: extras.dispositivo !== undefined
        ? extras.dispositivo
        : (decision.meta?.dispositivo || null),
      provedor: decision.provedor
        || decision.adapterBinding?.registro?.provedor
        || null,
      mapaPdvEstacao: this._montarMapaPdvEstacao(request),
      exigirDispositivo: request.exigirDispositivo,
      exigirExecucaoLocal: request.exigirExecucaoLocal,
      exigirEstacaoVinculada: request.exigirEstacaoVinculada
    });

    const ctx = resolvido.executionContext;
    const mapCodigo = {
      [EXEC_CODES.DISPOSITIVO_INDISPONIVEL]: ROUTE_CODES.DISPOSITIVO_INDISPONIVEL,
      [EXEC_CODES.TERMINAL_SEM_DISPOSITIVO]: ROUTE_CODES.TERMINAL_SEM_DISPOSITIVO,
      [EXEC_CODES.ESTACAO_NAO_VINCULADA]: ROUTE_CODES.ESTACAO_NAO_VINCULADA,
      [EXEC_CODES.ESTACAO_REMOTA_NAO_SUPORTADA]: ROUTE_CODES.ESTACAO_REMOTA_NAO_SUPORTADA,
      [EXEC_CODES.TOPOLOGIA_INCOMPATIVEL_PROVEDOR]: ROUTE_CODES.ESTACAO_REMOTA_NAO_SUPORTADA
    };

    if (resolvido.bloqueante) {
      return criarRouteDecision({
        ...decision,
        sucesso: false,
        codigo: mapCodigo[resolvido.codigo] || ROUTE_CODES.ROUTER_ERRO_INTERNO,
        mensagem: resolvido.mensagem,
        modo: MODOS_ROUTER.EXEC_CONTEXT,
        executionContext: ctx,
        isolamento: {
          ...(decision.isolamento || {}),
          alocacaoAtiva: false
        },
        meta: {
          ...(decision.meta || {}),
          executionContextBloqueante: true,
          extensionPoints: EXTENSION_POINTS
        }
      });
    }

    return criarRouteDecision({
      ...decision,
      executionContext: ctx,
      meta: {
        ...(decision.meta || {}),
        executionContextResolvido: true,
        topologia: ctx.topologia,
        localidadeExecucao: ctx.localidadeExecucao,
        extensionPoints: EXTENSION_POINTS
      }
    });
  }

  /**
   * Contexto → (opcional) alocação. Ordem: ExecutionContext depois decisão lógica;
   * allocate só se contexto não bloqueante.
   */
  _finalizarDecisao(decision, request = {}, extras = {}) {
    const comContexto = this._aplicarExecutionContext(decision, request, extras);
    return this._aplicarAlocacao(comContexto, request);
  }

  /**
   * Aplica alocação se request.allocate === true sobre uma decisão já bem-sucedida.
   */
  _aplicarAlocacao(decision, request = {}) {
    if (request.allocate !== true) {
      return decision;
    }
    if (!decision.sucesso) {
      return decision;
    }

    const terminalTefId = decision.terminalTefId
      || (decision.modo === MODOS_ROUTER.COMPAT_SINGLETON
        ? 'singleton:instalacao'
        : null);

    if (!terminalTefId) {
      return criarRouteDecision({
        ...decision,
        sucesso: false,
        codigo: ROUTE_CODES.ALOCACAO_FALHOU,
        mensagem: 'allocate=true exige terminalTefId resolvido',
        isolamento: {
          ...(decision.isolamento || {}),
          alocacaoAtiva: false
        }
      });
    }

    let aloc;
    try {
      aloc = this._getAllocator().adquirir({
        terminalTefId,
        pdvId: decision.pdvId,
        provedor: decision.provedor || decision.adapterBinding?.registro?.provedor || 'default',
        operacao: request.operacao || 'autorizar',
        ocupacaoTimeoutMs: request.ocupacaoTimeoutMs,
        meta: { modoRouter: decision.modo }
      });
    } catch (error) {
      return criarRouteDecision({
        ...decision,
        sucesso: false,
        codigo: ROUTE_CODES.ALOCACAO_FALHOU,
        mensagem: `Falha na aquisição do lock: ${error.message}`,
        isolamento: { ...(decision.isolamento || {}), alocacaoAtiva: false }
      });
    }

    if (!aloc.ok) {
      const codigoRota = aloc.codigo === ALLOCATION_CODES.TERMINAL_OCUPADO
        ? ROUTE_CODES.TERMINAL_OCUPADO
        : aloc.codigo === ALLOCATION_CODES.RUNTIME_OCUPADO
          ? ROUTE_CODES.RUNTIME_OCUPADO
          : ROUTE_CODES.ALOCACAO_FALHOU;
      return criarRouteDecision({
        ...decision,
        sucesso: false,
        codigo: codigoRota,
        mensagem: aloc.mensagem,
        isolamento: {
          ...(decision.isolamento || {}),
          alocacaoAtiva: false,
          conflito: aloc.conflito || null
        },
        meta: {
          ...(decision.meta || {}),
          alocacao: aloc,
          alocacaoAtiva: false
        }
      });
    }

    return criarRouteDecision({
      ...decision,
      codigo: decision.codigo === ROUTE_CODES.REGISTRY_RESOLVED
        ? ROUTE_CODES.REGISTRY_RESOLVED
        : decision.codigo,
      modo: MODOS_ROUTER.ALLOCATE,
      mensagem: `${decision.mensagem} — lease ${aloc.lease.leaseId} adquirido`,
      isolamento: {
        lockKeySugerida: `lease:${aloc.lease.leaseId}`,
        permiteParaleloNoMesmoHost: aloc.politica?.permiteTerminaisParalelos === true,
        alocacaoAtiva: true,
        leaseId: aloc.lease.leaseId,
        terminalTefId: aloc.lease.terminalTefId,
        runtimeKey: aloc.lease.runtimeKey,
        tipoOcupacao: aloc.lease.runtimeKey ? 'TERMINAL+RUNTIME' : 'TERMINAL'
      },
      meta: {
        ...(decision.meta || {}),
        alocacaoAtiva: true,
        lease: aloc.lease,
        politicaIsolamento: aloc.politica || null,
        extensionPoints: EXTENSION_POINTS
      }
    });
  }

  /**
   * @param {object} request
   * @returns {Promise<object>}
   */
  async resolve(request = {}) {
    const operacao = String(request.operacao || 'autorizar').toLowerCase();
    if (OPERACOES_ROUTER.length && !OPERACOES_ROUTER.includes(operacao)) {
      // ainda resolve identidade
    }

    let singleton;
    try {
      singleton = await this._carregarSingleton(this._depsSingleton);
    } catch (error) {
      return criarRouteDecision({
        sucesso: false,
        codigo: ROUTE_CODES.ROUTER_ERRO_INTERNO,
        mensagem: `Falha no fallback singleton: ${error.message}`,
        modo: this._modoPadrao
      });
    }

    const pdvBruto = request.pdvId != null
      ? request.pdvId
      : (request.terminal_id != null ? request.terminal_id : request.terminalId);

    const validacao = await this._identity.validarPdvId(pdvBruto, {
      empresaId: request.empresaId ?? request.empresa_id,
      lojaId: request.lojaId ?? request.loja_id,
      configSingleton: singleton.config || singleton.adapterBinding?.registro || null
    });

    if (pdvBruto != null && pdvBruto !== '' && !validacao.ok) {
      return criarRouteDecision({
        sucesso: false,
        codigo: validacao.codigo,
        mensagem: validacao.mensagem,
        modo: this._modoPadrao,
        pdvId: validacao.pdv?.pdvId || null,
        pdv: validacao.pdv,
        empresaId: request.empresaId ?? request.empresa_id ?? null,
        lojaId: request.lojaId ?? request.loja_id ?? null,
        meta: { operacao, validacaoAusente: false, registryAtivo: true }
      });
    }

    if (validacao.ausente && this._exigirPdvId) {
      return criarRouteDecision({
        sucesso: false,
        codigo: ROUTE_CODES.PDV_OBRIGATORIO_EM_MODO_STRICT,
        mensagem: 'pdvId obrigatório neste modo do Router',
        modo: this._modoPadrao,
        meta: { operacao }
      });
    }

    const empresaId = request.empresaId ?? request.empresa_id ?? null;
    const lojaId = request.lojaId ?? request.loja_id ?? null;
    const registroSingleton = singleton.ok
      ? (singleton.adapterBinding?.registro || {})
      : {};

    if (validacao.pdv?.pdvId) {
      let reg;
      try {
        reg = await this._getRegistry().resolverPorPdv({
          pdvId: validacao.pdv.pdvId,
          empresaId,
          lojaId,
          provedorPreferido: request.provedorPreferido || null
        });
      } catch (error) {
        return criarRouteDecision({
          sucesso: false,
          codigo: ROUTE_CODES.ROUTER_ERRO_INTERNO,
          mensagem: `Falha no Terminal Registry: ${error.message}`,
          modo: this._modoPadrao,
          pdvId: validacao.pdv.pdvId,
          pdv: validacao.pdv
        });
      }

      if (reg.codigo === REGISTRY_CODES.TERMINAL_AMBIGUO) {
        return criarRouteDecision({
          sucesso: false,
          codigo: ROUTE_CODES.TERMINAL_AMBIGUO,
          mensagem: reg.mensagem,
          modo: MODOS_ROUTER.REGISTRY_RESOLVE,
          pdvId: validacao.pdv.pdvId,
          pdv: validacao.pdv,
          empresaId,
          lojaId,
          meta: { operacao, registry: reg, candidatos: reg.candidatos }
        });
      }

      if (reg.codigo === REGISTRY_CODES.EMPRESA_LOJA_INCOMPATIVEL) {
        return criarRouteDecision({
          sucesso: false,
          codigo: ROUTE_CODES.EMPRESA_LOJA_INCOMPATIVEL,
          mensagem: reg.mensagem,
          modo: MODOS_ROUTER.REGISTRY_RESOLVE,
          pdvId: validacao.pdv.pdvId,
          pdv: validacao.pdv,
          empresaId,
          lojaId,
          meta: { operacao, registry: reg }
        });
      }

      if (reg.codigo === REGISTRY_CODES.TERMINAL_INATIVO
        || reg.codigo === REGISTRY_CODES.TERMINAL_INDISPONIVEL
        || reg.codigo === REGISTRY_CODES.TERMINAL_NAO_PROVISIONADO) {
        const map = {
          [REGISTRY_CODES.TERMINAL_INATIVO]: ROUTE_CODES.TERMINAL_INATIVO,
          [REGISTRY_CODES.TERMINAL_INDISPONIVEL]: ROUTE_CODES.TERMINAL_INDISPONIVEL,
          [REGISTRY_CODES.TERMINAL_NAO_PROVISIONADO]: ROUTE_CODES.TERMINAL_NAO_PROVISIONADO
        };
        return criarRouteDecision({
          sucesso: false,
          codigo: map[reg.codigo],
          mensagem: reg.mensagem,
          modo: MODOS_ROUTER.REGISTRY_RESOLVE,
          pdvId: validacao.pdv.pdvId,
          pdv: validacao.pdv,
          empresaId,
          lojaId,
          terminalTefId: reg.terminal?.id || null,
          dispositivoId: reg.terminal?.dispositivo?.id || null,
          provedor: reg.terminal?.provedor || null,
          ambiente: reg.terminal?.ambiente || null,
          meta: { operacao, registry: reg, estadoTerminal: reg.terminal?.estado }
        });
      }

      if (reg.ok && reg.codigo === REGISTRY_CODES.REGISTRY_HIT) {
        const binding = this._getRegistry().montarBinding(
          reg.terminal,
          singleton.ok ? singleton.adapterBinding : null
        );
        const decision = criarRouteDecision({
          sucesso: true,
          codigo: ROUTE_CODES.REGISTRY_RESOLVED,
          mensagem: 'Terminal TEF resolvido pelo Registry',
          modo: MODOS_ROUTER.REGISTRY_RESOLVE,
          pdvId: validacao.pdv.pdvId,
          pdv: validacao.pdv,
          empresaId,
          lojaId,
          terminalTefId: reg.terminal.id,
          dispositivoId: reg.dispositivo?.id || null,
          provedor: reg.terminal.provedor,
          ambiente: reg.terminal.ambiente,
          adapterBinding: binding,
          isolamento: {
            lockKeySugerida: `terminal_tef:${reg.terminal.id}`,
            permiteParaleloNoMesmoHost: false,
            alocacaoAtiva: false
          },
          meta: {
            operacao,
            pdvOmitido: false,
            registryAtivo: true,
            registryHit: true,
            alocacaoAtiva: false,
            singletonDisponivel: singleton.ok === true,
            separacao: reg.separacao,
            dispositivo: reg.dispositivo || reg.terminal?.dispositivo || null,
            extensionPoints: EXTENSION_POINTS
          }
        });
        return this._finalizarDecisao(decision, request, {
          dispositivo: reg.dispositivo || reg.terminal?.dispositivo || null
        });
      }
    }

    const provedor = registroSingleton.provedor || registroSingleton.tefProvedor || null;
    const ambiente = registroSingleton.ambiente || registroSingleton.tefAmbiente || null;

    const decisionSingleton = criarRouteDecision({
      sucesso: true,
      codigo: validacao.ausente ? ROUTE_CODES.SINGLETON_FALLBACK : ROUTE_CODES.ROUTE_OK,
      mensagem: validacao.ausente
        ? (singleton.ok
          ? 'Roteamento compatível singleton (pdvId omitido) — fluxo TEF atual preservado'
          : `Singleton sem config persistida (${singleton.mensagem}); fluxo segue para factory`)
        : (singleton.ok
          ? 'PDV validado; sem terminal no Registry — fallback singleton preservado'
          : `PDV validado; Registry miss e singleton ausente (${singleton.mensagem})`),
      modo: MODOS_ROUTER.COMPAT_SINGLETON,
      pdvId: validacao.pdv?.pdvId || null,
      pdv: validacao.pdv || null,
      empresaId,
      lojaId,
      terminalTefId: request.allocate === true ? 'singleton:instalacao' : null,
      dispositivoId: null,
      provedor: provedor ? String(provedor).toLowerCase() : null,
      ambiente: ambiente ? String(ambiente).toLowerCase() : null,
      adapterBinding: singleton.ok ? singleton.adapterBinding : null,
      isolamento: {
        lockKeySugerida: validacao.pdv?.pdvId
          ? `pdv:${validacao.pdv.pdvId}`
          : 'instalacao:singleton',
        permiteParaleloNoMesmoHost: false,
        alocacaoAtiva: false
      },
      meta: {
        operacao,
        pdvOmitido: Boolean(validacao.ausente),
        registryAtivo: true,
        registryHit: false,
        registryMiss: Boolean(validacao.pdv?.pdvId),
        alocacaoAtiva: false,
        singletonDisponivel: singleton.ok === true,
        extensionPoints: EXTENSION_POINTS
      }
    });

    return this._finalizarDecisao(decisionSingleton, request, { dispositivo: null });
  }
}

function criarTerminalRouter(opcoes = {}) {
  return new TerminalRouter(opcoes);
}

let compartilhado = null;
function obterTerminalRouter() {
  if (!compartilhado) compartilhado = criarTerminalRouter();
  return compartilhado;
}

function resetTerminalRouterParaTestes() {
  compartilhado = null;
}

module.exports = {
  TerminalRouter,
  criarTerminalRouter,
  obterTerminalRouter,
  resetTerminalRouterParaTestes
};
