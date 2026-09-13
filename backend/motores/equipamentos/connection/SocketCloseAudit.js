/**
 * RC15.9 — Auditoria da origem do encerramento TCP
 * Diferencia LOCAL_CLOSE / REMOTE_CLOSE / ERROR_CLOSE / TIMEOUT_CLOSE.
 */

'use strict';

const CLOSE_KIND = Object.freeze({
  LOCAL_CLOSE: 'LOCAL_CLOSE',
  REMOTE_CLOSE: 'REMOTE_CLOSE',
  ERROR_CLOSE: 'ERROR_CLOSE',
  TIMEOUT_CLOSE: 'TIMEOUT_CLOSE'
});

/** @type {WeakMap<object, object>} */
const _state = new WeakMap();

function agoraIso() {
  return new Date().toISOString();
}

function getLogger() {
  try {
    return require('../services/LoggerService');
  } catch (_) {
    return {
      info: async (msg, ctx) => console.log('[socket-close]', msg, ctx?.contexto || ctx || ''),
      warn: async (msg, ctx) => console.warn('[socket-close]', msg, ctx?.contexto || ctx || '')
    };
  }
}

function capturarStack(pular = 2) {
  const err = new Error('SOCKET_CLOSE_STACK');
  const lines = String(err.stack || '')
    .split('\n')
    .slice(pular)
    .map((l) => l.trim())
    .filter(Boolean);
  // Remove frames internos do próprio audit
  return lines
    .filter((l) => !/SocketCloseAudit\.js/.test(l))
    .slice(0, 18)
    .join('\n');
}

/**
 * Node duplex, após FIN remoto, chama end()/destroy() internamente.
 * Isso NÃO é LOCAL_CLOSE do CDS.
 */
function isAutoDuplexStack(stack) {
  const lines = String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  const appFrames = lines.filter((l) => {
    if (/node:internal|node:events|node:net|node:stream/.test(l)) return false;
    if (/SocketCloseAudit\.js/.test(l)) return false;
    if (/<anonymous>/.test(l) && !/\.(js|ts|cjs|mjs)/.test(l)) return false;
    return true;
  });
  if (appFrames.length === 0) return true;
  // Só frames de half-close do runtime
  return appFrames.every((l) => /endWritableNT|endReadableNT|finish\b|afterWrite|onSocketEnd|socketOnEnd/i.test(l));
}

function _estado(socket) {
  if (!socket) return null;
  let s = _state.get(socket);
  if (!s) {
    s = {
      localPending: false,
      localOrigem: null,
      localMetodo: null,
      localStack: null,
      localKind: null,
      localAt: null,
      remoteEndSeen: false,
      timeoutSeen: false,
      errorSeen: false,
      lastError: null,
      wrapped: false,
      closeLogged: false
    };
    _state.set(socket, s);
  }
  return s;
}

function _consoleBlock(titulo, linhas) {
  try {
    console.log(['', `===== ${titulo} =====`, ...linhas, '='.repeat(titulo.length + 12), ''].join('\n'));
  } catch (_) { /* ignore */ }
}

/**
 * Registra intenção local de encerrar (antes de end/destroy/disconnect).
 */
function markLocalClose(socketOrNull, opts = {}) {
  const origem = opts.origem || 'desconhecida';
  const metodo = opts.metodo || 'close';
  const kind = opts.kind || CLOSE_KIND.LOCAL_CLOSE;
  const stack = opts.stack || capturarStack(3);
  const meta = {
    host: opts.host != null ? opts.host : null,
    porta: opts.porta != null ? opts.porta : null
  };

  if (socketOrNull) {
    const s = _estado(socketOrNull);
    // Half-close automático do Node após FIN remoto — não sobrescreve REMOTE
    if (s.remoteEndSeen && isAutoDuplexStack(stack) && kind === CLOSE_KIND.LOCAL_CLOSE) {
      s.autoDuplexAfterRemote = true;
      return {
        timestamp: agoraIso(),
        evento: 'SOCKET_END_AUTO_DUPLEX',
        origem: 'node:duplex',
        metodo,
        kind: CLOSE_KIND.REMOTE_CLOSE,
        host: meta.host,
        porta: meta.porta,
        stack,
        ignoradoComoLocal: true
      };
    }
    s.localPending = true;
    s.localOrigem = origem;
    s.localMetodo = metodo;
    s.localStack = stack;
    s.localKind = kind;
    s.localAt = Date.now();
    s.autoDuplexAfterRemote = false;
    if (kind === CLOSE_KIND.TIMEOUT_CLOSE) s.timeoutSeen = true;
    if (kind === CLOSE_KIND.ERROR_CLOSE) s.errorSeen = true;
  }

  _consoleBlock('SOCKET END REQUEST', [
    `Origem:`,
    `${origem}`,
    `Método:`,
    `${metodo}`,
    `Tipo:`,
    `${kind}`,
    meta.host != null ? `Host: ${meta.host}` : null,
    meta.porta != null ? `Porta: ${meta.porta}` : null,
    `Stack:`,
    stack || '(sem stack)'
  ].filter((x) => x != null));

  const payload = {
    timestamp: agoraIso(),
    evento: 'SOCKET_END_REQUEST',
    origem,
    metodo,
    kind,
    host: meta.host,
    porta: meta.porta,
    stack
  };
  getLogger().info('SOCKET END REQUEST', {
    operacao: 'socket_close_audit',
    contexto: payload
  }).catch(() => {});

  return payload;
}

function markRemoteEnd(socket, opts = {}) {
  const s = socket ? _estado(socket) : null;

  // Se já havia pedido local, o "end" é eco do peer após nosso FIN — não é REMOTE
  if (s?.localPending) {
    return { kind: s.localKind || CLOSE_KIND.LOCAL_CLOSE, remoto: false };
  }

  if (s) s.remoteEndSeen = true;

  _consoleBlock('SOCKET REMOTE END', [
    `Evento:`,
    `socket.on("end")`,
    `Sem chamada local para end()`,
    opts.host != null ? `Host: ${opts.host}` : null,
    opts.porta != null ? `Porta: ${opts.porta}` : null,
    `Tipo:`,
    CLOSE_KIND.REMOTE_CLOSE
  ].filter((x) => x != null));

  const payload = {
    timestamp: agoraIso(),
    evento: 'SOCKET_REMOTE_END',
    kind: CLOSE_KIND.REMOTE_CLOSE,
    host: opts.host != null ? opts.host : null,
    porta: opts.porta != null ? opts.porta : null
  };
  getLogger().warn('SOCKET REMOTE END', {
    operacao: 'socket_close_audit',
    contexto: payload
  }).catch(() => {});

  return { kind: CLOSE_KIND.REMOTE_CLOSE, remoto: true, ...payload };
}

function markTimeout(socket) {
  const s = socket ? _estado(socket) : null;
  if (s) s.timeoutSeen = true;
}

function markError(socket, err) {
  const s = socket ? _estado(socket) : null;
  if (s) {
    s.errorSeen = true;
    s.lastError = err?.message || String(err || '');
  }
}

/**
 * Classifica o close final e emite log consolidado.
 */
function classifyAndLogClose(socket, hadError, opts = {}) {
  const s = socket ? _estado(socket) : null;
  if (s?.closeLogged) {
    return s.lastClassification || null;
  }

  let kind = CLOSE_KIND.REMOTE_CLOSE;
  let origem = 'REMOTE (peer)';
  let metodo = 'socket.on("close")';

  if (hadError || s?.errorSeen) {
    kind = CLOSE_KIND.ERROR_CLOSE;
    origem = s?.localPending ? (s.localOrigem || 'local+error') : 'socket.error / peer reset';
    metodo = s?.localMetodo || 'error→close';
  } else if (s?.timeoutSeen && !s?.localPending) {
    kind = CLOSE_KIND.TIMEOUT_CLOSE;
    origem = 'socket.timeout';
    metodo = 'timeout→close';
  } else if (s?.remoteEndSeen && !s?.localPending) {
    // Peer encerrou primeiro; end()/destroy() do duplex Node não conta como CDS
    kind = CLOSE_KIND.REMOTE_CLOSE;
    origem = 'REMOTE (peer)';
    metodo = 'socket.on("end")';
  } else if (s?.localPending) {
    kind = s.localKind || CLOSE_KIND.LOCAL_CLOSE;
    if (s.timeoutSeen && kind === CLOSE_KIND.LOCAL_CLOSE) {
      kind = CLOSE_KIND.TIMEOUT_CLOSE;
    }
    origem = s.localOrigem || 'CDS (local)';
    metodo = s.localMetodo || 'local close';
  } else if (s?.remoteEndSeen) {
    kind = CLOSE_KIND.REMOTE_CLOSE;
    origem = 'REMOTE (peer)';
    metodo = 'socket.on("end")';
  }

  const stack = s?.localStack || null;
  const classification = {
    timestamp: agoraIso(),
    evento: 'SOCKET_CLOSE_CLASSIFIED',
    kind,
    origem,
    metodo,
    hadError: Boolean(hadError),
    localPending: Boolean(s?.localPending),
    remoteEndSeen: Boolean(s?.remoteEndSeen),
    timeoutSeen: Boolean(s?.timeoutSeen),
    errorSeen: Boolean(s?.errorSeen),
    lastError: s?.lastError || null,
    host: opts.host != null ? opts.host : null,
    porta: opts.porta != null ? opts.porta : null,
    stack,
    iniciador: kind === CLOSE_KIND.REMOTE_CLOSE ? 'BALANCA_OU_PEER' : 'CDS'
  };

  if (s) {
    s.closeLogged = true;
    s.lastClassification = classification;
  }

  _consoleBlock('SOCKET CLOSE CLASSIFIED', [
    `Tipo: ${kind}`,
    `Iniciador: ${classification.iniciador}`,
    `Origem: ${origem}`,
    `Método: ${metodo}`,
    `hadError: ${Boolean(hadError)}`,
    classification.host != null ? `Host: ${classification.host}` : null,
    classification.porta != null ? `Porta: ${classification.porta}` : null,
    stack ? `Stack:\n${stack}` : 'Stack: (não aplicável — close remoto ou sem mark local)'
  ].filter((x) => x != null));

  getLogger().info('SOCKET CLOSE CLASSIFIED', {
    operacao: 'socket_close_audit',
    contexto: classification
  }).catch(() => {});

  return classification;
}

/**
 * Intercepta end/destroy/destroySoon do socket nativo.
 */
function instrumentSocket(socket, meta = {}) {
  if (!socket || typeof socket.end !== 'function') return socket;
  const s = _estado(socket);
  if (s.wrapped) return socket;
  s.wrapped = true;

  const host = meta.host;
  const porta = meta.porta;
  const origemPadrao = meta.origem || 'TcpConnection';

  const wrap = (nome, original) => {
    if (typeof original !== 'function') return original;
    return function wrappedCloseMethod(...args) {
      const stack = capturarStack(3);
      const st = _estado(socket);
      // Duplex Node após FIN remoto (sem close local prévio): não emite como CDS
      if (st.remoteEndSeen && !st.localPending && isAutoDuplexStack(stack)) {
        st.autoDuplexAfterRemote = true;
        return original.apply(this, args);
      }
      markLocalClose(socket, {
        origem: origemPadrao,
        metodo: `socket.${nome}()`,
        kind: CLOSE_KIND.LOCAL_CLOSE,
        host,
        porta,
        stack
      });
      return original.apply(this, args);
    };
  };

  try {
    socket.end = wrap('end', socket.end.bind(socket));
    socket.destroy = wrap('destroy', socket.destroy.bind(socket));
    if (typeof socket.destroySoon === 'function') {
      socket.destroySoon = wrap('destroySoon', socket.destroySoon.bind(socket));
    }
  } catch (_) { /* ignore — socket pode ser sealed */ }

  return socket;
}

/** Helpers de API de alto nível */
function logDisconnectCall(origem, metodo, opts = {}) {
  return markLocalClose(opts.socket || null, {
    origem,
    metodo,
    kind: opts.kind || CLOSE_KIND.LOCAL_CLOSE,
    host: opts.host,
    porta: opts.porta,
    stack: opts.stack || capturarStack(3)
  });
}

module.exports = {
  CLOSE_KIND,
  capturarStack,
  isAutoDuplexStack,
  markLocalClose,
  markRemoteEnd,
  markTimeout,
  markError,
  classifyAndLogClose,
  instrumentSocket,
  logDisconnectCall,
  /** @internal testes */
  _resetForTests(socket) {
    if (socket) _state.delete(socket);
  }
};
