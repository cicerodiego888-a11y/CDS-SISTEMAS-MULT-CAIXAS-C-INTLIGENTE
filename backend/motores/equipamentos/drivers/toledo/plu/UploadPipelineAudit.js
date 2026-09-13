/**
 * RC15.7 — Auditoria do pipeline Upload PLU (CONNECT → HANDSHAKE → UPLOAD → ACK → FIM).
 * Somente instrumentação — não altera comportamento.
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

const SOLICITANTES = Object.freeze({
  CONNECTION_MANAGER: 'ConnectionManager',
  OPERATION_ENGINE: 'OperationEngine',
  UPLOAD_PLU_OPERATION: 'UploadPluOperation',
  DRIVER: 'Driver'
});

function pad(label, valor) {
  const dots = '.'.repeat(Math.max(2, 20 - String(label).length));
  return `${label}${dots}${valor}`;
}

function criarContexto(meta = {}) {
  return {
    plu: meta.plu || null,
    host: meta.host || null,
    porta: meta.porta != null ? Number(meta.porta) : null,
    equipamentoId: meta.equipamentoId != null ? Number(meta.equipamentoId) : null,
    connect: 'NÃO EXECUTADO',
    handshake: 'NÃO EXECUTADO',
    upload: 'NÃO EXECUTADO',
    ack: 'NÃO EXECUTADO',
    fim: false,
    motivo: null,
    handshakeSolicitadoPor: [],
    handshakeMomento: null,
    requireHandshakeBeforeUpload: meta.requireHandshakeBeforeUpload,
    eventos: []
  };
}

function atual() {
  return als.getStore() || null;
}

function run(meta, fn) {
  const ctx = criarContexto(meta);
  return als.run(ctx, async () => {
    try {
      return await fn(ctx);
    } catch (err) {
      if (!ctx.motivo) {
        ctx.motivo = err.message || err.code || String(err);
      }
      if (ctx.upload === 'NÃO EXECUTADO' && /handshake|timeout/i.test(String(ctx.motivo))) {
        // típico: falhou no handshake antes do upload
      }
      throw err;
    } finally {
      finalizarELogar();
    }
  });
}

function marcar(estagio, status, extra = {}) {
  const ctx = atual();
  if (!ctx) return;
  const st = String(status || '').toUpperCase();
  if (estagio === 'CONNECT') ctx.connect = st;
  else if (estagio === 'HANDSHAKE') ctx.handshake = st;
  else if (estagio === 'UPLOAD') ctx.upload = st;
  else if (estagio === 'ACK') ctx.ack = st;
  if (extra.motivo) ctx.motivo = extra.motivo;
  ctx.eventos.push({
    t: new Date().toISOString(),
    estagio,
    status: st,
    ...extra
  });
}

/**
 * Registra quem pediu o handshake (pode acumular vários).
 * @param {string} solicitante ConnectionManager|OperationEngine|UploadPluOperation|Driver
 * @param {object} [meta]
 */
function handshakeSolicitado(solicitante, meta = {}) {
  const ctx = atual();
  if (!ctx) return;
  const quem = String(solicitante || 'Desconhecido');
  if (!ctx.handshakeSolicitadoPor.includes(quem)) {
    ctx.handshakeSolicitadoPor.push(quem);
  }
  if (!ctx.handshakeMomento) {
    ctx.handshakeMomento = new Date().toISOString();
  }
  if (ctx.handshake === 'NÃO EXECUTADO') {
    ctx.handshake = 'EXECUTADO';
  }
  ctx.eventos.push({
    t: ctx.handshakeMomento,
    estagio: 'HANDSHAKE_SOLICITADO',
    status: 'EXECUTADO',
    solicitante: quem,
    ...meta
  });
}

function handshakeResultado(ok, motivo = null) {
  const ctx = atual();
  if (!ctx) return;
  ctx.handshake = ok ? 'EXECUTADO' : 'FALHOU';
  if (!ok && motivo) ctx.motivo = motivo;
}

/**
 * Resolve flag requireHandshakeBeforeUpload (se existir em algum lugar).
 */
function resolverRequireHandshake(opcoes = {}) {
  if (opcoes && Object.prototype.hasOwnProperty.call(opcoes, 'requireHandshakeBeforeUpload')) {
    return opcoes.requireHandshakeBeforeUpload;
  }
  if (opcoes && Object.prototype.hasOwnProperty.call(opcoes, 'require_handshake_before_upload')) {
    return opcoes.require_handshake_before_upload;
  }
  if (process.env.REQUIRE_HANDSHAKE_BEFORE_UPLOAD != null
    && String(process.env.REQUIRE_HANDSHAKE_BEFORE_UPLOAD).trim() !== '') {
    const v = String(process.env.REQUIRE_HANDSHAKE_BEFORE_UPLOAD).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  // Busca opcional em configurações do motor (sem alterar comportamento)
  try {
    const caps = require('../ToledoCapabilities');
    if (caps && typeof caps.getCapabilities === 'function') {
      const c = caps.getCapabilities();
      if (c && c.requireHandshakeBeforeUpload != null) {
        return c.requireHandshakeBeforeUpload;
      }
      if (c && c.capabilities && c.capabilities.requireHandshakeBeforeUpload != null) {
        return c.capabilities.requireHandshakeBeforeUpload;
      }
    }
  } catch (_) { /* ignore */ }
  return undefined;
}

function finalizarELogar() {
  const ctx = atual();
  if (!ctx || ctx.fim) return ctx;
  ctx.fim = true;

  const lines = [
    '',
    '===== UPLOAD PIPELINE =====',
    pad('CONNECT', ctx.connect),
    pad('HANDSHAKE', ctx.handshake),
    pad('UPLOAD', ctx.upload),
    pad('ACK', ctx.ack)
  ];

  if (ctx.handshakeSolicitadoPor.length) {
    lines.push('Handshake solicitado por:');
    for (const q of ctx.handshakeSolicitadoPor) {
      lines.push(`• ${q}`);
    }
    if (ctx.handshakeMomento) {
      lines.push(`Momento: ${ctx.handshakeMomento}`);
    }
  } else if (ctx.handshake === 'NÃO EXECUTADO') {
    lines.push('Handshake solicitado por:');
    lines.push('• (nenhum — driver já online / handshake não chamado)');
  }

  if (ctx.requireHandshakeBeforeUpload !== undefined) {
    lines.push(`requireHandshakeBeforeUpload=${String(ctx.requireHandshakeBeforeUpload)}`);
  } else {
    lines.push('requireHandshakeBeforeUpload=(não configurado)');
  }

  if (ctx.upload === 'NÃO EXECUTADO' || ctx.handshake === 'FALHOU' || ctx.connect === 'FALHOU') {
    lines.push('Motivo:');
    lines.push(ctx.motivo || '—');
  }

  if (ctx.plu != null) {
    lines.push(`PLU: ${ctx.plu}`);
  }
  lines.push('==============================');
  lines.push('');

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  return snapshot(ctx);
}

function snapshot(ctx = atual()) {
  if (!ctx) return null;
  return {
    connect: ctx.connect,
    handshake: ctx.handshake,
    upload: ctx.upload,
    ack: ctx.ack,
    motivo: ctx.motivo,
    handshakeSolicitadoPor: [...ctx.handshakeSolicitadoPor],
    handshakeMomento: ctx.handshakeMomento,
    requireHandshakeBeforeUpload: ctx.requireHandshakeBeforeUpload,
    plu: ctx.plu,
    host: ctx.host,
    porta: ctx.porta,
    equipamentoId: ctx.equipamentoId,
    eventos: [...ctx.eventos]
  };
}

module.exports = {
  SOLICITANTES,
  run,
  atual,
  marcar,
  handshakeSolicitado,
  handshakeResultado,
  resolverRequireHandshake,
  finalizarELogar,
  snapshot,
  pad
};
