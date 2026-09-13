/**
 * Sprint 15.4 — ToledoSyncProgress
 * Progresso em tempo real: %, tempo, lote, itens, velocidade, ETA.
 */

'use strict';

class ToledoSyncProgress {
  constructor() {
    this.reset();
  }

  reset(meta = {}) {
    this._inicio = Date.now();
    this.running = false;
    this.cancelled = false;
    this.modo = meta.modo || null;
    this.equipamentoId = meta.equipamentoId || null;
    this.host = meta.host || null;
    this.porta = meta.porta || null;
    this.syncId = meta.syncId || null;
    this.totalItens = 0;
    this.enviados = 0;
    this.falhas = 0;
    this.loteAtual = null;
    this.lotesTotal = 0;
    this.loteIndex = 0;
    this.produtoAtual = null;
    this.fase = 'idle';
    this.ultimoErro = null;
    this.listeners = this.listeners || [];
  }

  onChange(fn) {
    if (typeof fn === 'function') this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  _emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try { fn(snap); } catch (_) { /* ignore */ }
    }
  }

  start(meta = {}) {
    this.reset(meta);
    this.running = true;
    this.fase = 'running';
    this.totalItens = Number(meta.totalItens) || 0;
    this.lotesTotal = Number(meta.lotesTotal) || 0;
    this._emit();
  }

  setLote(lote, index) {
    this.loteAtual = lote
      ? { id: lote.id, tipo: lote.tipo, quantidade: lote.quantidade, checksum: lote.checksum, seq: lote.seq }
      : null;
    this.loteIndex = Number(index) || 0;
    this._emit();
  }

  setProduto(produto) {
    this.produtoAtual = produto
      ? { plu: produto.plu || produto.codigo, descricao: produto.descricao || produto.nome }
      : null;
    this._emit();
  }

  markItem(ok) {
    if (ok) this.enviados += 1;
    else this.falhas += 1;
    this._emit();
  }

  fail(err) {
    this.ultimoErro = err?.message || String(err || 'erro');
    this._emit();
  }

  cancel() {
    this.cancelled = true;
    this.fase = 'cancelled';
    this.running = false;
    this._emit();
  }

  finish(ok = true) {
    this.running = false;
    this.fase = ok ? 'done' : (this.cancelled ? 'cancelled' : 'error');
    this._emit();
  }

  snapshot() {
    const elapsed = Math.max(0, Date.now() - this._inicio);
    const done = this.enviados + this.falhas;
    const restante = Math.max(0, this.totalItens - done);
    const pct = this.totalItens > 0
      ? Math.min(100, Math.round((done / this.totalItens) * 100))
      : (this.fase === 'done' ? 100 : 0);
    const velocidade = elapsed > 0 ? (done / (elapsed / 1000)) : 0;
    const etaMs = velocidade > 0 ? Math.round((restante / velocidade) * 1000) : null;

    return {
      running: this.running,
      cancelled: this.cancelled,
      fase: this.fase,
      modo: this.modo,
      syncId: this.syncId,
      equipamentoId: this.equipamentoId,
      host: this.host,
      porta: this.porta,
      percent: pct,
      tempoMs: elapsed,
      tempo: formatMs(elapsed),
      loteAtual: this.loteAtual,
      loteIndex: this.loteIndex,
      lotesTotal: this.lotesTotal,
      itensEnviados: this.enviados,
      itensFalhas: this.falhas,
      itensRestantes: restante,
      totalItens: this.totalItens,
      velocidade: Number(velocidade.toFixed(2)),
      velocidadeLabel: `${velocidade.toFixed(1)} it/s`,
      etaMs,
      eta: etaMs != null ? formatMs(etaMs) : null,
      produtoAtual: this.produtoAtual,
      ultimoErro: this.ultimoErro
    };
  }
}

function formatMs(ms) {
  const s = Math.floor(Number(ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

module.exports = ToledoSyncProgress;
module.exports.ToledoSyncProgress = ToledoSyncProgress;
module.exports.formatMs = formatMs;
