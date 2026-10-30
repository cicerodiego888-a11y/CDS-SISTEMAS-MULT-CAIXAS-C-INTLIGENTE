'use strict';

/**
 * MRT-07 — Recuperação segura de alocações após reinício/falha.
 *
 * Regras obrigatórias:
 * - NÃO aprovar pagamento
 * - NÃO cancelar pagamento
 * - NÃO repetir autorização
 * - NÃO liberar inconclusivo financeiro (TEF-14)
 * - NÃO presumir cancelamento por timeout
 *
 * Após reinício: limpa leases voláteis e aplica HOLD de recuperação no runtime
 * Destaxa (GLOBAL_SERIALIZE) enquanto houver pendência TEF-14 — até reconciliação
 * explícita existente (fora desta sprint).
 */

const {
  RECOVERY_CODES,
  ACOES_PROIBIDAS,
  MONITOR_STATES
} = require('./contracts');
const { RELEASE_REASONS } = require('../terminalAllocator/contracts');
const { criarTerminalMonitor } = require('./TerminalMonitor');

const HOLD_TERMINAL_PREFIX = 'recuperacao:tef_transacao:';

class TerminalRecoveryService {
  constructor(opcoes = {}) {
    this._getAllocator = opcoes.getAllocator
      || (() => require('../terminalAllocator').obterTerminalAllocator());
    this._listarPendencias = opcoes.listarPendencias
      || (() => {
        try {
          return require('../TefManager').listarTravasPendencias();
        } catch (_) {
          return [];
        }
      });
    this._monitor = opcoes.monitor || criarTerminalMonitor({
      getAllocator: this._getAllocator,
      listarPendencias: this._listarPendencias,
      getRegistry: opcoes.getRegistry
    });
    this._ultimaRecuperacao = null;
    this._recuperacaoEmCurso = false;
  }

  /**
   * Recuperação idempotente pós-reinício.
   * @returns {object}
   */
  recuperarAposReinicio(opcoes = {}) {
    if (this._recuperacaoEmCurso) {
      return {
        ok: true,
        codigo: RECOVERY_CODES.RECUPERACAO_DUPLICADA,
        mensagem: 'Recuperação já em curso — ignorada (idempotente)',
        autoAprovacao: false,
        autoCancelamento: false,
        autoRetry: false,
        acoesProibidas: ACOES_PROIBIDAS
      };
    }

    // Segunda chamada no mesmo ciclo de vida com mesmos holds → duplicada
    if (
      this._ultimaRecuperacao
      && this._ultimaRecuperacao.holdsAtivos > 0
      && opcoes.forcar !== true
    ) {
      const allocator = this._getAllocator();
      const holdsExistentes = allocator.listarLeasesAtivos()
        .filter((l) => l.meta?.recuperacao === true);
      if (holdsExistentes.length > 0) {
        return {
          ok: true,
          codigo: RECOVERY_CODES.RECUPERACAO_DUPLICADA,
          mensagem: 'Holds de recuperação já aplicados — sem nova ação',
          holdsAtivos: holdsExistentes.length,
          leaseIds: holdsExistentes.map((l) => l.leaseId),
          autoAprovacao: false,
          autoCancelamento: false,
          autoRetry: false,
          acoesProibidas: ACOES_PROIBIDAS,
          monitor: this._monitor.listarEstados({
            pendenciasCompletas: opcoes.pendenciasCompletas
          })
        };
      }
    }

    this._recuperacaoEmCurso = true;
    try {
      const allocator = this._getAllocator();
      const limpeza = allocator.recuperarAposReinicio();
      const pendencias = Array.isArray(opcoes.pendenciasCompletas)
        ? opcoes.pendenciasCompletas
        : (this._listarPendencias() || []);

      const holds = [];
      const destaxaPendentes = pendencias.filter(
        (p) => String(p.provedor || '').toLowerCase() === 'destaxa'
      );

      // Um único hold GLOBAL_SERIALIZE cobre todas as pendências Destaxa
      if (destaxaPendentes.length > 0) {
        const ancora = destaxaPendentes[0];
        const terminalHold = ancora.terminalTefId
          || (ancora.payload_retorno?.roteamento?.terminalTefId)
          || `${HOLD_TERMINAL_PREFIX}${ancora.transacaoId || ancora.id}`;

        const aq = allocator.adquirir({
          terminalTefId: String(terminalHold),
          pdvId: ancora.pdvId || null,
          provedor: 'destaxa',
          ocupacaoTimeoutMs: 86400000 * 30,
          meta: {
            recuperacao: true,
            transacaoId: String(ancora.transacaoId || ancora.id),
            pendenciasDestaxa: destaxaPendentes.map((p) => String(p.transacaoId || p.id)),
            naoAprovar: true,
            naoCancelar: true,
            naoRepetir: true
          }
        });

        if (aq.ok) {
          allocator.marcarInconclusivo(aq.lease.leaseId);
          holds.push(aq.lease);
        } else {
          // Runtime já ocupado por hold concurrent — tratar como ok idempotente
          holds.push({
            leaseId: null,
            conflito: aq.conflito || null,
            codigo: aq.codigo,
            meta: { recuperacao: true, aquisicaoParcial: true }
          });
        }
      }

      // Holds por terminal explícito (não-Destaxa) com tip no payload — só ocupação, sem financeiro
      for (const p of pendencias) {
        if (String(p.provedor || '').toLowerCase() === 'destaxa') continue;
        const tip = p.terminalTefId || p.payload_retorno?.roteamento?.terminalTefId;
        if (!tip) continue;
        const st = allocator.statusTerminal(tip);
        if (st.ocupado) continue;
        const aq = allocator.adquirir({
          terminalTefId: String(tip),
          provedor: p.provedor || 'default',
          pdvId: p.pdvId || null,
          ocupacaoTimeoutMs: 86400000 * 30,
          meta: {
            recuperacao: true,
            transacaoId: String(p.transacaoId || p.id),
            naoAprovar: true,
            naoCancelar: true,
            naoRepetir: true
          }
        });
        if (aq.ok) {
          allocator.marcarInconclusivo(aq.lease.leaseId);
          holds.push(aq.lease);
        }
      }

      const monitor = this._monitor.listarEstados({
        pendenciasCompletas: pendencias
      });

      const resultado = {
        ok: true,
        codigo: holds.length
          ? RECOVERY_CODES.HOLDS_APLICADOS
          : (pendencias.length ? RECOVERY_CODES.RECUPERACAO_OK : RECOVERY_CODES.SEM_PENDENCIAS),
        mensagem: holds.length
          ? 'Leases voláteis limpos; holds de recuperação aplicados (financeiro intacto)'
          : (pendencias.length
            ? 'Leases limpos; pendências financeiras permanecem no TEF-14 sem hold de terminal'
            : 'Leases limpos; nenhuma pendência financeira'),
        leasesLimpos: limpeza.liberados || 0,
        leasesAnteriores: limpeza.leasesAnteriores || [],
        holdsAtivos: holds.filter((h) => h.leaseId).length,
        holds,
        pendenciasFinanceiras: pendencias.length,
        autoAprovacao: false,
        autoCancelamento: false,
        autoRetry: false,
        liberouInconclusivoFinanceiro: false,
        acoesProibidas: ACOES_PROIBIDAS,
        monitor,
        recuperadoEm: new Date().toISOString()
      };

      this._ultimaRecuperacao = resultado;
      return resultado;
    } catch (error) {
      return {
        ok: false,
        codigo: RECOVERY_CODES.RECUPERACAO_ERRO,
        mensagem: error.message,
        autoAprovacao: false,
        autoCancelamento: false,
        autoRetry: false,
        acoesProibidas: ACOES_PROIBIDAS
      };
    } finally {
      this._recuperacaoEmCurso = false;
    }
  }

  /**
   * Remove hold de recuperação APENAS quando a pendência financeira correspondente
   * já não existe (reconciliação TEF-14 concluída externamente).
   * Nunca remove se ainda houver pendência.
   */
  sincronizarHoldsComPendencias(opcoes = {}) {
    const allocator = this._getAllocator();
    const pendencias = Array.isArray(opcoes.pendenciasCompletas)
      ? opcoes.pendenciasCompletas
      : (this._listarPendencias() || []);
    const idsPendentes = new Set(
      pendencias.map((p) => String(p.transacaoId || p.id))
    );

    const removidos = [];
    const mantidos = [];
    for (const lease of allocator.listarLeasesAtivos()) {
      if (lease.meta?.recuperacao !== true) continue;
      const txId = lease.meta?.transacaoId != null ? String(lease.meta.transacaoId) : null;
      const lista = Array.isArray(lease.meta?.pendenciasDestaxa)
        ? lease.meta.pendenciasDestaxa.map(String)
        : (txId ? [txId] : []);

      const aindaPendente = lista.some((id) => idsPendentes.has(id))
        || (lista.length === 0 && idsPendentes.size > 0 && lease.provedor === 'destaxa');

      if (aindaPendente) {
        mantidos.push(lease.leaseId);
        continue;
      }

      // Pendência resolvida — pode liberar hold com RECUPERACAO_REINICIO / FORCAR via motivo permitido
      const lib = allocator.liberar(lease.leaseId, RELEASE_REASONS.RECUPERACAO_REINICIO);
      if (lib.ok) removidos.push(lease.leaseId);
      else mantidos.push(lease.leaseId);
    }

    return {
      ok: true,
      removidos,
      mantidos,
      pendenciasRestantes: idsPendentes.size,
      autoAprovacao: false,
      autoCancelamento: false,
      autoRetry: false
    };
  }

  obterUltimaRecuperacao() {
    return this._ultimaRecuperacao;
  }

  monitorar(opcoes = {}) {
    return this._monitor.listarEstados(opcoes);
  }
}

function criarTerminalRecoveryService(opcoes = {}) {
  return new TerminalRecoveryService(opcoes);
}

let compartilhado = null;
function obterTerminalRecoveryService() {
  if (!compartilhado) compartilhado = criarTerminalRecoveryService();
  return compartilhado;
}

function resetTerminalRecoveryServiceParaTestes() {
  compartilhado = null;
}

module.exports = {
  TerminalRecoveryService,
  criarTerminalRecoveryService,
  obterTerminalRecoveryService,
  resetTerminalRecoveryServiceParaTestes,
  HOLD_TERMINAL_PREFIX,
  MONITOR_STATES
};
