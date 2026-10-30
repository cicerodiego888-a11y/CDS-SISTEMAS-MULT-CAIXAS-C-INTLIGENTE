'use strict';

/**
 * MRT-07 — Monitoramento do estado dos terminais (somente leitura + agregação).
 * Não autoriza, não libera financeiro, não altera TEF-13/14/15.
 */

const { MONITOR_STATES, criarSnapshotMonitor } = require('./contracts');
const { politicaIsolamento } = require('../terminalAllocator/contracts');

function classificarEstado({ registryEstado, lease, holdRecuperacao, pendenciaRelacionada, dispositivo }) {
  if (holdRecuperacao) {
    return MONITOR_STATES.EM_RECUPERACAO;
  }
  if (lease && lease.resultadoFinanceiroInconclusivo) {
    return MONITOR_STATES.INCONCLUSIVO;
  }
  if (pendenciaRelacionada && !lease) {
    // Após reinício: lease sumiu, financeiro ainda pendente
    return MONITOR_STATES.EM_RECUPERACAO;
  }
  if (lease && !lease.liberado) {
    return MONITOR_STATES.OCUPADO;
  }
  if (
    registryEstado === 'INDISPONIVEL'
    || registryEstado === 'INATIVO'
    || registryEstado === 'NAO_PROVISIONADO'
    || (dispositivo && dispositivo.ativo === false)
  ) {
    return MONITOR_STATES.INDISPONIVEL;
  }
  return MONITOR_STATES.LIVRE;
}

class TerminalMonitor {
  constructor(opcoes = {}) {
    this._getRegistry = opcoes.getRegistry
      || (() => require('../terminalRegistry').obterTerminalRegistry());
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
  }

  /**
   * Visão agregada: Registry × Allocator × pendências TEF-14.
   */
  listarEstados(opcoes = {}) {
    const registry = this._getRegistry();
    const allocator = this._getAllocator();
      const pendenciasBase = Array.isArray(opcoes.pendenciasCompletas)
        ? opcoes.pendenciasCompletas
        : (this._listarPendencias() || []);

    const porTransacao = new Map();
    for (const p of pendenciasBase) {
      const id = String(p.transacaoId || p.id);
      porTransacao.set(id, { ...p, transacaoId: id });
    }

    const terminais = typeof registry.listarTodos === 'function'
      ? registry.listarTodos()
      : [];

    const snapshots = [];
    const cobertos = new Set();

    for (const t of terminais) {
      const stLease = allocator.statusTerminal(t.id);
      const lease = stLease.ocupado ? stLease.lease : null;
      const politica = politicaIsolamento(t.provedor);
      const stRt = politica.runtimeKey
        ? allocator.statusRuntime(politica.runtimeKey)
        : { ocupado: false, lease: null };

      const holdRecuperacao = Boolean(
        (lease && lease.meta?.recuperacao === true)
        || (stRt.lease && stRt.lease.meta?.recuperacao === true
          && (!lease || lease.leaseId === stRt.lease.leaseId))
      );

      // Pendência relacionada por provedor Destaxa (runtime) ou por terminalTefId no meta
      let pendenciaRelacionada = null;
      for (const p of porTransacao.values()) {
        const tip = p.terminalTefId || p.payload_retorno?.roteamento?.terminalTefId;
        if (tip && String(tip) === String(t.id)) {
          pendenciaRelacionada = p;
          break;
        }
        if (
          !tip
          && String(p.provedor || '').toLowerCase() === String(t.provedor || '').toLowerCase()
          && String(t.provedor || '').toLowerCase() === 'destaxa'
        ) {
          pendenciaRelacionada = p;
          break;
        }
      }

      const vendaId = pendenciaRelacionada?.vendaId
        ?? pendenciaRelacionada?.venda_id
        ?? null;

      const estadoMonitor = classificarEstado({
        registryEstado: t.estado,
        lease,
        holdRecuperacao,
        pendenciaRelacionada,
        dispositivo: t.dispositivo
      });

      cobertos.add(String(t.id));
      snapshots.push(criarSnapshotMonitor({
        terminalTefId: t.id,
        pdvId: t.pdvId,
        provedor: t.provedor,
        runtimeKey: politica.runtimeKey,
        estadoMonitor,
        estadoRegistry: t.estado,
        leaseId: lease?.leaseId || null,
        leaseInconclusivo: lease?.resultadoFinanceiroInconclusivo === true,
        holdRecuperacao,
        transacaoIdPendente: pendenciaRelacionada?.transacaoId || null,
        vendaId,
        semVendaVinculada: Boolean(pendenciaRelacionada) && (vendaId == null || vendaId === ''),
        semLease: !lease && Boolean(pendenciaRelacionada),
        semResultadoDefinitivo: Boolean(pendenciaRelacionada),
        resultadoTardio: Boolean(
          pendenciaRelacionada?.resultadoTardio
          || pendenciaRelacionada?.estado === 'AGUARDANDO_RESULTADO_TARDIO'
        ),
        mensagem: `Monitor ${estadoMonitor}`,
        meta: {
          dispositivoId: t.dispositivo?.id || null,
          runtimeOcupado: stRt.ocupado === true
        }
      }));
    }

    // Runtime Destaxa sem terminal cadastrado (singleton) — entrada sintética
    const polDestaxa = politicaIsolamento('destaxa');
    const stDestaxa = allocator.statusRuntime(polDestaxa.runtimeKey);
    const pendDestaxa = [...porTransacao.values()].find(
      (p) => String(p.provedor || '').toLowerCase() === 'destaxa'
    );
    if (stDestaxa.ocupado || pendDestaxa) {
      const lease = stDestaxa.lease;
      const holdRecuperacao = lease?.meta?.recuperacao === true;
      snapshots.push(criarSnapshotMonitor({
        terminalTefId: lease?.terminalTefId || 'runtime:destaxa:global',
        pdvId: lease?.pdvId || null,
        provedor: 'destaxa',
        runtimeKey: polDestaxa.runtimeKey,
        estadoMonitor: classificarEstado({
          lease,
          holdRecuperacao,
          pendenciaRelacionada: pendDestaxa
        }),
        leaseId: lease?.leaseId || null,
        leaseInconclusivo: lease?.resultadoFinanceiroInconclusivo === true,
        holdRecuperacao,
        transacaoIdPendente: pendDestaxa?.transacaoId || null,
        vendaId: pendDestaxa?.vendaId || pendDestaxa?.venda_id || null,
        semVendaVinculada: Boolean(pendDestaxa)
          && !(pendDestaxa.vendaId || pendDestaxa.venda_id),
        semLease: !lease && Boolean(pendDestaxa),
        semResultadoDefinitivo: Boolean(pendDestaxa),
        resultadoTardio: Boolean(pendDestaxa?.resultadoTardio),
        mensagem: 'Runtime Destaxa (GLOBAL_SERIALIZE)',
        meta: { sinteticoRuntime: true, cobertosRegistry: [...cobertos] }
      }));
    }

    // Pendências sem lease e sem terminal no Registry
    for (const p of porTransacao.values()) {
      const tip = p.terminalTefId || p.payload_retorno?.roteamento?.terminalTefId;
      if (tip && cobertos.has(String(tip))) continue;
      if (String(p.provedor || '').toLowerCase() === 'destaxa') continue; // já coberto no runtime
      snapshots.push(criarSnapshotMonitor({
        terminalTefId: tip || `orfao:transacao:${p.transacaoId}`,
        pdvId: null,
        provedor: p.provedor || null,
        estadoMonitor: MONITOR_STATES.EM_RECUPERACAO,
        transacaoIdPendente: p.transacaoId,
        vendaId: p.vendaId || p.venda_id || null,
        semVendaVinculada: !(p.vendaId || p.venda_id),
        semLease: true,
        semResultadoDefinitivo: true,
        resultadoTardio: Boolean(p.resultadoTardio),
        mensagem: 'Pendência financeira sem lease em memória (pós-reinício ou pré-MRT-06)',
        meta: { orfao: true }
      }));
    }

    return {
      ok: true,
      codigo: 'MONITOR_OK',
      geradoEm: new Date().toISOString(),
      totais: {
        livre: snapshots.filter((s) => s.estadoMonitor === MONITOR_STATES.LIVRE).length,
        ocupado: snapshots.filter((s) => s.estadoMonitor === MONITOR_STATES.OCUPADO).length,
        inconclusivo: snapshots.filter((s) => s.estadoMonitor === MONITOR_STATES.INCONCLUSIVO).length,
        indisponivel: snapshots.filter((s) => s.estadoMonitor === MONITOR_STATES.INDISPONIVEL).length,
        emRecuperacao: snapshots.filter((s) => s.estadoMonitor === MONITOR_STATES.EM_RECUPERACAO).length
      },
      terminais: snapshots,
      pendenciasFinanceiras: porTransacao.size,
      acoesProibidasRespeitadas: true
    };
  }

  statusTerminal(terminalTefId) {
    const todos = this.listarEstados();
    return todos.terminais.find((t) => String(t.terminalTefId) === String(terminalTefId)) || null;
  }

  statusRuntimeDestaxa() {
    const todos = this.listarEstados();
    return todos.terminais.find((t) => t.runtimeKey === 'runtime:destaxa:global') || null;
  }
}

function criarTerminalMonitor(opcoes = {}) {
  return new TerminalMonitor(opcoes);
}

module.exports = {
  TerminalMonitor,
  criarTerminalMonitor,
  classificarEstado
};
