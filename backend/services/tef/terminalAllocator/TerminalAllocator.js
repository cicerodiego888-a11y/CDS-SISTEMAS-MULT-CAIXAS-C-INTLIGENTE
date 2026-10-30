'use strict';

/**
 * CDS TEF Terminal Allocator — MRT-04
 *
 * Controle de ocupação por terminal lógico + runtime (ex. Destaxa global).
 * Não altera locks financeiros (tefLockService / TEF-13/14).
 * Store em memória — após reinício, leases são recuperados como liberados.
 */

const crypto = require('crypto');
const {
  ALLOCATION_CODES,
  RELEASE_REASONS,
  RELEASE_PERMITIDOS,
  politicaIsolamento,
  criarLease
} = require('./contracts');

const DEFAULT_OCUPACAO_MS = 120000;

class TerminalAllocator {
  constructor(opcoes = {}) {
    /** @type {Map<string, object>} leaseId → lease */
    this._leases = new Map();
    /** @type {Map<string, string>} terminalTefId → leaseId */
    this._porTerminal = new Map();
    /** @type {Map<string, string>} runtimeKey → leaseId */
    this._porRuntime = new Map();
    this._ocupacaoTimeoutMs = Number(opcoes.ocupacaoTimeoutMs) || DEFAULT_OCUPACAO_MS;
    this._now = opcoes.now || (() => Date.now());
    this._idFactory = opcoes.idFactory
      || (() => `lease_${crypto.randomBytes(8).toString('hex')}`);
  }

  _expirado(lease) {
    if (!lease || !lease.expiraEm) return false;
    return this._now() >= new Date(lease.expiraEm).getTime();
  }

  /**
   * Expira só a ocupação do mapa se NÃO estiver marcada inconclusiva.
   * Timeout de ocupação ≠ liberação financeira.
   */
  _varrerExpirados() {
    for (const [leaseId, lease] of this._leases.entries()) {
      if (lease.liberado) continue;
      if (!this._expirado(lease)) continue;
      if (lease.resultadoFinanceiroInconclusivo) {
        // Mantém ocupação — inconclusiva não libera por timeout
        continue;
      }
      this._removerIndices(lease);
      lease.liberado = true;
      lease.liberadoEm = new Date(this._now()).toISOString();
      lease.motivoLiberacao = RELEASE_REASONS.TIMEOUT_OCUPACAO;
    }
  }

  _removerIndices(lease) {
    if (lease.terminalTefId && this._porTerminal.get(lease.terminalTefId) === lease.leaseId) {
      this._porTerminal.delete(lease.terminalTefId);
    }
    if (lease.runtimeKey && this._porRuntime.get(lease.runtimeKey) === lease.leaseId) {
      this._porRuntime.delete(lease.runtimeKey);
    }
  }

  statusTerminal(terminalTefId) {
    this._varrerExpirados();
    const id = String(terminalTefId || '');
    const leaseId = this._porTerminal.get(id);
    if (!leaseId) {
      return { ocupado: false, lease: null, tipo: null };
    }
    const lease = this._leases.get(leaseId);
    if (!lease || lease.liberado) {
      return { ocupado: false, lease: null, tipo: null };
    }
    return { ocupado: true, lease, tipo: 'TERMINAL' };
  }

  statusRuntime(runtimeKey) {
    this._varrerExpirados();
    const key = String(runtimeKey || '');
    const leaseId = this._porRuntime.get(key);
    if (!leaseId) {
      return { ocupado: false, lease: null, tipo: null };
    }
    const lease = this._leases.get(leaseId);
    if (!lease || lease.liberado) {
      return { ocupado: false, lease: null, tipo: null };
    }
    return { ocupado: true, lease, tipo: 'RUNTIME' };
  }

  obterLease(leaseId) {
    return this._leases.get(String(leaseId)) || null;
  }

  listarLeasesAtivos() {
    this._varrerExpirados();
    return [...this._leases.values()].filter((l) => !l.liberado);
  }

  /**
   * Marca operação financeira inconclusiva — bloqueia liberação por timeout/sucesso falso.
   */
  marcarInconclusivo(leaseId) {
    const lease = this._leases.get(String(leaseId));
    if (!lease || lease.liberado) {
      return { ok: false, codigo: ALLOCATION_CODES.LEASE_NAO_ENCONTRADO };
    }
    lease.resultadoFinanceiroInconclusivo = true;
    // Estende ocupação enquanto pendente (sem liberar)
    lease.expiraEm = null;
    return { ok: true, lease: criarLease(lease) };
  }

  /**
   * Adquire ocupação do terminal (+ runtime se política exigir).
   */
  adquirir(pedido = {}) {
    this._varrerExpirados();

    const terminalTefId = pedido.terminalTefId != null ? String(pedido.terminalTefId) : null;
    if (!terminalTefId) {
      return {
        ok: false,
        codigo: ALLOCATION_CODES.PARAMETRO_INVALIDO,
        mensagem: 'terminalTefId obrigatório para alocação',
        lease: null
      };
    }

    const provedor = String(pedido.provedor || 'default').toLowerCase();
    const politica = politicaIsolamento(provedor);
    const runtimeKey = politica.runtimeKey
      || (pedido.runtimeKey != null ? String(pedido.runtimeKey) : null);

    // Dupla alocação do mesmo terminal
    const stTerm = this.statusTerminal(terminalTefId);
    if (stTerm.ocupado) {
      return {
        ok: false,
        codigo: ALLOCATION_CODES.TERMINAL_OCUPADO,
        mensagem: `Terminal TEF ${terminalTefId} já ocupado (lease ${stTerm.lease.leaseId})`,
        lease: null,
        conflito: { tipo: 'TERMINAL', lease: stTerm.lease }
      };
    }

    // Runtime singleton ocupado (ex. Destaxa global) — distinto de terminal ocupado
    if (runtimeKey) {
      const stRt = this.statusRuntime(runtimeKey);
      if (stRt.ocupado) {
        return {
          ok: false,
          codigo: ALLOCATION_CODES.RUNTIME_OCUPADO,
          mensagem: `Runtime ${runtimeKey} ocupado (política ${politica.modo}) — lease ${stRt.lease.leaseId}`,
          lease: null,
          conflito: { tipo: 'RUNTIME', lease: stRt.lease, politica }
        };
      }
    }

    const timeoutMs = Number(pedido.ocupacaoTimeoutMs) || this._ocupacaoTimeoutMs;
    const leaseId = this._idFactory();
    const agora = this._now();
    const lease = criarLease({
      leaseId,
      terminalTefId,
      runtimeKey,
      pdvId: pedido.pdvId != null ? String(pedido.pdvId) : null,
      provedor,
      adquiridoEm: new Date(agora).toISOString(),
      expiraEm: new Date(agora + timeoutMs).toISOString(),
      ocupacaoTimeoutMs: timeoutMs,
      resultadoFinanceiroInconclusivo: false,
      liberado: false,
      meta: {
        politica: politica.modo,
        permiteTerminaisParalelos: politica.permiteTerminaisParalelos,
        operacao: pedido.operacao || null,
        ...(pedido.meta || {})
      }
    });

    try {
      this._leases.set(leaseId, lease);
      this._porTerminal.set(terminalTefId, leaseId);
      if (runtimeKey) {
        this._porRuntime.set(runtimeKey, leaseId);
      }
    } catch (error) {
      this._removerIndices(lease);
      this._leases.delete(leaseId);
      return {
        ok: false,
        codigo: ALLOCATION_CODES.AQUISICAO_FALHOU,
        mensagem: `Falha na aquisição do lock: ${error.message}`,
        lease: null
      };
    }

    return {
      ok: true,
      codigo: ALLOCATION_CODES.ALLOCATED,
      mensagem: 'Terminal alocado',
      lease: criarLease(lease),
      politica
    };
  }

  /**
   * Libera lease. Bloqueia se inconclusivo (exceto FORCAR_ADMIN / RECUPERACAO_REINICIO).
   * TIMEOUT_OCUPACAO sozinho não libera se inconclusivo.
   */
  liberar(leaseId, motivo = RELEASE_REASONS.SUCESSO_CONFIRMADO, opcoes = {}) {
    const id = String(leaseId || '');
    const lease = this._leases.get(id);
    if (!lease) {
      return {
        ok: false,
        codigo: ALLOCATION_CODES.LEASE_NAO_ENCONTRADO,
        mensagem: `Lease ${id} não encontrado`
      };
    }
    if (lease.liberado) {
      return {
        ok: false,
        codigo: ALLOCATION_CODES.LEASE_JA_LIBERADO,
        mensagem: `Lease ${id} já estava liberado`,
        lease: criarLease(lease)
      };
    }

    const reason = String(motivo || '');
    if (lease.resultadoFinanceiroInconclusivo
      && reason !== RELEASE_REASONS.FORCAR_ADMIN
      && reason !== RELEASE_REASONS.RECUPERACAO_REINICIO
      && opcoes.forcar !== true) {
      return {
        ok: false,
        codigo: ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA,
        mensagem: 'Não liberar terminal com operação financeira inconclusiva (TEF-14)',
        lease: criarLease(lease)
      };
    }

    if (!RELEASE_PERMITIDOS.has(reason) && opcoes.forcar !== true) {
      // Timeout de ocupação sem inconclusiva: permitido via varredura; explícito só se não inconclusivo
      if (reason === RELEASE_REASONS.TIMEOUT_OCUPACAO && !lease.resultadoFinanceiroInconclusivo) {
        // ok
      } else if (reason === RELEASE_REASONS.TIMEOUT_OCUPACAO) {
        return {
          ok: false,
          codigo: ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA,
          mensagem: 'Timeout de ocupação não libera lease inconclusivo',
          lease: criarLease(lease)
        };
      } else {
        return {
          ok: false,
          codigo: ALLOCATION_CODES.PARAMETRO_INVALIDO,
          mensagem: `Motivo de liberação não permitido: ${reason}`
        };
      }
    }

    this._removerIndices(lease);
    lease.liberado = true;
    lease.liberadoEm = new Date(this._now()).toISOString();
    lease.motivoLiberacao = reason;
    return {
      ok: true,
      codigo: ALLOCATION_CODES.ALLOCATED,
      mensagem: 'Lease liberado',
      lease: criarLease(lease)
    };
  }

  /**
   * Recuperação após reinício: limpa todos os leases em memória.
   * Não toca tef_transacoes / pendências financeiras.
   */
  recuperarAposReinicio() {
    const ativos = this.listarLeasesAtivos().map((l) => criarLease(l));
    for (const lease of this._leases.values()) {
      if (!lease.liberado) {
        this._removerIndices(lease);
        lease.liberado = true;
        lease.liberadoEm = new Date(this._now()).toISOString();
        lease.motivoLiberacao = RELEASE_REASONS.RECUPERACAO_REINICIO;
        // Inconclusivas financeiras permanecem no TefManager/TEF-14 — só zera ocupação em memória
        lease.resultadoFinanceiroInconclusivo = false;
      }
    }
    this._porTerminal.clear();
    this._porRuntime.clear();
    this._leases.clear();
    return {
      ok: true,
      liberados: ativos.length,
      leasesAnteriores: ativos,
      mensagem: 'Ocupações em memória recuperadas após reinício (financeiro inconclusivo permanece no TEF-14)'
    };
  }

  resetParaTestes() {
    this._leases.clear();
    this._porTerminal.clear();
    this._porRuntime.clear();
  }
}

function criarTerminalAllocator(opcoes = {}) {
  return new TerminalAllocator(opcoes);
}

let compartilhado = null;
function obterTerminalAllocator() {
  if (!compartilhado) compartilhado = criarTerminalAllocator();
  return compartilhado;
}

function resetTerminalAllocatorParaTestes() {
  if (compartilhado) compartilhado.resetParaTestes();
  compartilhado = null;
}

module.exports = {
  TerminalAllocator,
  criarTerminalAllocator,
  obterTerminalAllocator,
  resetTerminalAllocatorParaTestes
};
