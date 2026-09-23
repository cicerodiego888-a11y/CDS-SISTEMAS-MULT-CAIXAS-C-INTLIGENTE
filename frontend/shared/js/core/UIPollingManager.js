/**
 * UIPollingManager — polling ciente de página/componente (Sprint 6).
 */
(function (global) {
  'use strict';

  /** @type {Map<string, Object>} */
  const _polls = new Map();
  let _seq = 0;

  function log(detail) {
    if (global.CDS_UI_DEBUG) {
      try { console.debug('[UI-POLLING]', detail); } catch { /* ignore */ }
    }
  }

  function perf(type, entry, extra = {}) {
    const Monitor = global.PerformanceMonitor;
    if (!Monitor || !Monitor.isEnabled || !Monitor.isEnabled()) return;
    Monitor.record(`polling:${type}`, {
      pollId: entry?.id || null,
      page: entry?.page || null,
      component: entry?.component || null,
      interval: entry?.interval || null,
      executions: entry?.execucoes || 0,
      inFlight: entry?.emExecucao || 0,
      overlaps: entry?.sobreposicoes || 0,
      pageActive: entry?.page
        ? !!(global.UINavigation && global.UINavigation.isActivePage(entry.page))
        : null,
      documentVisible: typeof document !== 'undefined' ? !document.hidden : null,
      ...extra
    });
  }

  const UIPollingManager = {
    start(options = {}) {
      const id = options.id || `poll-${++_seq}`;
      this.stop(id);
      const page = options.page
        || (global.UINavigation && global.UINavigation.getPage())
        || null;
      const entry = {
        id,
        page,
        component: options.component || null,
        interval: Math.max(500, Number(options.interval) || 30000),
        ativo: true,
        prioridade: options.prioridade || 'normal',
        ultimaExecucao: null,
        execucoes: 0,
        emExecucao: 0,
        sobreposicoes: 0,
        timer: null,
        fn: options.fn
      };
      const tick = async () => {
        if (!entry.ativo) return;
        if (page && global.UINavigation && !global.UINavigation.isActivePage(page)) {
          perf('off-page', entry);
          this.stop(id);
          return;
        }
        entry.execucoes += 1;
        if (entry.emExecucao > 0) entry.sobreposicoes += 1;
        entry.emExecucao += 1;
        entry.ultimaExecucao = new Date().toISOString();
        const startedAt = (global.performance && typeof global.performance.now === 'function')
          ? global.performance.now()
          : Date.now();
        perf('execute', entry);
        try {
          await entry.fn(entry);
        } catch (err) {
          log({ id, error: String(err && err.message || err) });
          perf('error', entry, { error: String(err && err.message || err).slice(0, 160) });
        } finally {
          const endedAt = (global.performance && typeof global.performance.now === 'function')
            ? global.performance.now()
            : Date.now();
          entry.emExecucao = Math.max(0, entry.emExecucao - 1);
          perf('end', entry, { duration: Math.max(0, endedAt - startedAt) });
        }
      };
      entry.timer = setInterval(tick, entry.interval);
      _polls.set(id, entry);
      perf('start', entry, { runImmediately: !!options.runImmediately });
      if (options.runImmediately) tick();
      return id;
    },

    stop(id) {
      const entry = _polls.get(id);
      if (!entry) return;
      entry.ativo = false;
      if (entry.timer) clearInterval(entry.timer);
      _polls.delete(id);
      log({ id, status: 'stopped' });
      perf('stop', entry);
    },

    stopByPage(page) {
      if (!page) return;
      for (const [id, entry] of [..._polls.entries()]) {
        if (entry.page === page) this.stop(id);
      }
    },

    list() {
      return [..._polls.values()].map((e) => ({
        id: e.id,
        page: e.page,
        component: e.component,
        interval: e.interval,
        ativo: e.ativo,
        prioridade: e.prioridade,
        ultimaExecucao: e.ultimaExecucao,
        execucoes: e.execucoes,
        emExecucao: e.emExecucao,
        sobreposicoes: e.sobreposicoes
      }));
    },

    /**
     * Antes de atualizar: se usuário edita o componente, preferir soft/incremental.
     */
    shouldSoftUpdate(container) {
      if (document.querySelector('.modal.show')) return true;
      if (global.UIFocusManager && global.UIFocusManager.isEditing(container)) return true;
      return false;
    },

    _resetForTests() {
      for (const id of [..._polls.keys()]) this.stop(id);
      _seq = 0;
    }
  };

  global.UIPollingManager = UIPollingManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = UIPollingManager;
})(typeof window !== 'undefined' ? window : global);
