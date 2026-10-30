'use strict';

/**
 * MRT-06 — Integração controlada Terminal Router ↔ TefManager.
 *
 * Não reescreve o ciclo financeiro: só monta o pedido de resolve,
 * classifica liberação de lease e carrega mapa PDV→estação (read-only).
 * TEF-13/14/15/17 permanecem no TefManager.
 */

const { obterTerminalRouter } = require('./terminalRouter');
const { RELEASE_REASONS } = require('./terminalAllocator');
const { LOCALIDADE_EXECUCAO } = require('./executionContext');
const tefContrato = require('./tefContrato');
const { FINANCIAL_STATES } = require('./tefFinancialSafetyPolicy');

/**
 * Monta o pedido de resolve para autorização.
 * allocate=true + exigirExecucaoLocal=true: bloqueia REMOTA sem bridge;
 * serializa Destaxa via Allocator.
 */
function montarPedidoAutorizacao(dados = {}, extras = {}) {
  return {
    pdvId: dados.pdv_id ?? dados.pdvId ?? dados.terminal_id ?? dados.terminalId ?? null,
    empresaId: dados.empresa_id ?? dados.empresaId ?? null,
    lojaId: dados.loja_id ?? dados.lojaId ?? null,
    operacao: 'autorizar',
    provedorPreferido: dados.provedor_preferido ?? dados.provedorPreferido ?? null,
    hostHints: {
      hostname: dados.hostname || null,
      mac: dados.mac || null
    },
    mapaPdvEstacao: extras.mapaPdvEstacao || dados.mapaPdvEstacao || null,
    allocate: extras.allocate !== false,
    exigirExecucaoLocal: extras.exigirExecucaoLocal !== false,
    exigirDispositivo: extras.exigirDispositivo,
    exigirEstacaoVinculada: extras.exigirEstacaoVinculada,
    ocupacaoTimeoutMs: extras.ocupacaoTimeoutMs
  };
}

/**
 * Carrega mapa PDV→hostname da tabela terminais (somente leitura; sem migration).
 */
async function carregarMapaPdvEstacao(dependencias = {}) {
  if (Array.isArray(dependencias.mapaPdvEstacao)) {
    return dependencias.mapaPdvEstacao;
  }
  const getAll = dependencias.getAll || defaultGetAll;
  try {
    const rows = await getAll(
      `SELECT id AS pdvId, hostname FROM terminais WHERE ativo = 1 AND hostname IS NOT NULL AND TRIM(hostname) != ''`
    );
    return (rows || []).map((r) => ({
      pdvId: String(r.pdvId),
      hostname: r.hostname || null,
      mac: null
    }));
  } catch (_) {
    return [];
  }
}

function defaultGetAll(sql, params = []) {
  const db = require('../../database');
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function extrairLeaseId(routeDecision) {
  if (!routeDecision) return null;
  return routeDecision.isolamento?.leaseId
    || routeDecision.executionContext?.meta?.leaseId
    || routeDecision.meta?.lease?.leaseId
    || null;
}

/**
 * Classifica se o resultado financeiro permite liberar o lease de ocupação.
 * Inconclusivo / PENDENTE / UNKNOWN / TIMEOUT com TX → NÃO liberar (marcar inconclusivo).
 */
function classificarPosAutorizacao(resultado = {}, contexto = {}) {
  const status = resultado.status || null;
  const financialState = resultado.financialState || null;
  const codigo = String(resultado.codigo || '');
  const temTransacao = contexto.transacaoId != null || resultado.transacao_id != null || resultado.transacaoId != null;

  const inconclusivo = (
    status === tefContrato.STATUS.PENDENTE
    || financialState === FINANCIAL_STATES.UNKNOWN
    || financialState === FINANCIAL_STATES.PENDING
    || codigo === 'TIMEOUT'
    || codigo === 'TEF_UNKNOWN'
    || resultado.protocolState === 'TIMEOUT'
    || contexto.marcarInconclusivo === true
  );

  if (inconclusivo && (temTransacao || contexto.forcarInconclusivo === true)) {
    return {
      acao: 'MARCAR_INCONCLUSIVO',
      motivo: null,
      mensagem: 'Operação financeira inconclusiva — lease de terminal permanece (TEF-14)'
    };
  }

  if (resultado.sucesso === true || status === tefContrato.STATUS.APROVADO) {
    return {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.SUCESSO_CONFIRMADO,
      mensagem: 'Resultado financeiro confirmado (sucesso)'
    };
  }

  if (
    status === tefContrato.STATUS.NEGADO
    || status === tefContrato.STATUS.CANCELADO
    || status === tefContrato.STATUS.ERRO
    || resultado.sucesso === false
  ) {
    return {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.FALHA_CONFIRMADA,
      mensagem: 'Resultado financeiro confirmado (falha/negado/erro)'
    };
  }

  // Sem TX criada e falha pré-financeira (ex. prepare): libera
  if (!temTransacao) {
    return {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.FALHA_CONFIRMADA,
      mensagem: 'Falha antes da execução financeira — libera ocupação'
    };
  }

  return {
    acao: 'MARCAR_INCONCLUSIVO',
    motivo: null,
    mensagem: 'Desfecho não classificado com TX — mantém bloqueio'
  };
}

/**
 * Aplica liberação ou marca inconclusivo no Router/Allocator.
 */
function aplicarPosAutorizacao(leaseId, classificacao, opcoes = {}) {
  if (!leaseId) {
    return { ok: true, ignorado: true, mensagem: 'Sem lease' };
  }
  const router = opcoes.router || obterTerminalRouter();
  if (classificacao.acao === 'MARCAR_INCONCLUSIVO') {
    return {
      ...router.marcarAlocacaoInconclusiva(leaseId),
      acao: 'MARCAR_INCONCLUSIVO'
    };
  }
  if (classificacao.acao === 'LIBERAR') {
    return {
      ...router.liberarAlocacao(leaseId, classificacao.motivo || RELEASE_REASONS.FALHA_CONFIRMADA),
      acao: 'LIBERAR'
    };
  }
  return { ok: false, mensagem: 'Ação desconhecida', acao: classificacao.acao };
}

/**
 * Resolve rota com alocação para autorização (ponto único MRT-06).
 */
async function resolverRotaAutorizacao(dados, dependencias = {}) {
  const router = dependencias.router || obterTerminalRouter();
  const mapaPdvEstacao = await carregarMapaPdvEstacao(dependencias);
  const pedido = montarPedidoAutorizacao(dados, {
    mapaPdvEstacao,
    allocate: dependencias.allocate !== false,
    exigirExecucaoLocal: dependencias.exigirExecucaoLocal !== false,
    exigirDispositivo: dependencias.exigirDispositivo,
    ocupacaoTimeoutMs: dependencias.ocupacaoTimeoutMs
  });
  const routeDecision = await router.resolve(pedido);
  const leaseId = routeDecision.sucesso ? extrairLeaseId(routeDecision) : null;

  // Blindagem extra: REMOTA_REQUERIDA sem bridge nunca autoriza (mesmo se resolver não bloqueou)
  const localidade = routeDecision.executionContext?.localidadeExecucao;
  if (
    routeDecision.sucesso
    && localidade === LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA
    && dependencias.exigirExecucaoLocal !== false
  ) {
    if (leaseId) {
      router.liberarAlocacao(leaseId, RELEASE_REASONS.FALHA_CONFIRMADA);
    }
    return {
      sucesso: false,
      routeDecision: {
        ...routeDecision,
        sucesso: false,
        codigo: 'ESTACAO_REMOTA_NAO_SUPORTADA',
        mensagem: 'Topologia REMOTA_REQUERIDA sem bridge entre computadores — autorização bloqueada (MRT-06)'
      },
      leaseId: null,
      pedido
    };
  }

  return {
    sucesso: routeDecision.sucesso === true,
    routeDecision,
    leaseId,
    pedido
  };
}

module.exports = {
  montarPedidoAutorizacao,
  carregarMapaPdvEstacao,
  extrairLeaseId,
  classificarPosAutorizacao,
  aplicarPosAutorizacao,
  resolverRotaAutorizacao,
  RELEASE_REASONS,
  LOCALIDADE_EXECUCAO
};
