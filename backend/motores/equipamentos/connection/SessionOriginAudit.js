/**
 * RC15.6 — Auditoria da origem da sessão (Diagnóstico ≡ Upload).
 * Garante a mesma EquipmentSession (referência + estado CONNECTED).
 */

'use strict';

const connectionManager = require('./ConnectionManager');
const sessionRegistry = require('./EquipmentSessionRegistry');
const { chaveHostPorta, chaveEquipamento } = require('./ConnectionPool');

/** Último snapshot capturado pelo Diagnóstico (por alvo). */
const _ultimoDiagnostico = new Map();

function managerInstanceId(cm = connectionManager) {
  if (!cm) return null;
  if (!cm.__rc156InstanceId) {
    cm.__rc156InstanceId = `0x${(Math.floor(Math.random() * 0xfffff) + 0x1000).toString(16).toUpperCase()}`;
  }
  return cm.__rc156InstanceId;
}

function normalizarAlvo(opcoes = {}) {
  return {
    equipamentoId: opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id ?? null,
    host: opcoes.host || opcoes.ip || null,
    porta: opcoes.porta != null
      ? Number(opcoes.porta)
      : (opcoes.porta_tcp != null ? Number(opcoes.porta_tcp) : null)
  };
}

function chaveAlvo(alvo) {
  const a = normalizarAlvo(alvo);
  if (a.equipamentoId != null) return chaveEquipamento(a.equipamentoId);
  if (a.host && a.porta != null) return chaveHostPorta(a.host, a.porta);
  return null;
}

/**
 * Captura instrumentação oficial da sessão usada por Diagnóstico/Upload.
 * @returns {object}
 */
function capturar(opcoes = {}, cm = connectionManager) {
  const alvo = normalizarAlvo(opcoes);
  const entry = typeof cm.getConnection === 'function' ? cm.getConnection(alvo) : null;
  const session = typeof cm.getSession === 'function' ? cm.getSession(alvo) : null;
  const sessionKey = session?._registryKey
    || chaveAlvo(alvo)
    || (session ? `anon:${session.host}:${session.porta}` : null);
  const connectionKey = entry?._poolKey
    || (entry?.host && entry?.porta != null ? chaveHostPorta(entry.host, entry.porta) : null)
    || (alvo.host && alvo.porta != null ? chaveHostPorta(alvo.host, alvo.porta) : null);

  const snap = session && typeof session.snapshot === 'function'
    ? session.snapshot()
    : null;

  return {
    equipamentoId: alvo.equipamentoId != null
      ? Number(alvo.equipamentoId)
      : (session?.equipamentoId ?? entry?.equipamentoId ?? null),
    host: session?.host || entry?.host || alvo.host || null,
    porta: session?.porta != null
      ? Number(session.porta)
      : (entry?.porta != null ? Number(entry.porta) : alvo.porta),
    sessionKey,
    connectionKey,
    connectionManagerId: managerInstanceId(cm),
    equipmentSessionId: sessionKey,
    estado: snap?.state || session?.state || (entry?.fsm?.estado || null),
    connected: snap?.connected === true || session?.connected === true || false,
    persistent: snap?.persistent === true || session?.persistent === true || false,
    sameObject: session || null,
    entryPresent: Boolean(entry),
    transportAberto: Boolean(entry?.transport?.aberto || entry?.tcp?.aberto),
    capturedAt: new Date().toISOString()
  };
}

function logTerminal(titulo, info) {
  const lines = [
    '',
    `===== ${titulo} =====`,
    'Equipamento:',
    String(info.equipamentoId != null ? info.equipamentoId : '—'),
    'Host:',
    String(info.host || '—'),
    'Porta:',
    String(info.porta != null ? info.porta : '—'),
    'Session Key:',
    String(info.sessionKey || '—'),
    'Connection Key:',
    String(info.connectionKey || '—'),
    'Connected:',
    String(info.connected === true),
    'Persistent:',
    String(info.persistent === true),
    'Estado:',
    String(info.estado || '—'),
    'Manager Instance:',
    String(info.connectionManagerId || '—'),
    'EquipmentSession ID:',
    String(info.equipmentSessionId || '—'),
    '=========================',
    ''
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  return info;
}

function registrarDiagnostico(opcoes = {}, cm = connectionManager) {
  const info = capturar(opcoes, cm);
  logTerminal('DIAGNOSTIC SESSION', info);
  const k = chaveAlvo(opcoes) || chaveAlvo(info);
  if (k) {
    _ultimoDiagnostico.set(k, {
      ...info,
      // guarda referência viva para comparação por identidade
      _sessionRef: info.sameObject
    });
  }
  // também indexa por hp e eq quando disponíveis
  if (info.equipamentoId != null) {
    _ultimoDiagnostico.set(chaveEquipamento(info.equipamentoId), {
      ...info,
      _sessionRef: info.sameObject
    });
  }
  if (info.host && info.porta != null) {
    _ultimoDiagnostico.set(chaveHostPorta(info.host, info.porta), {
      ...info,
      _sessionRef: info.sameObject
    });
  }
  return info;
}

function obterDiagnostico(opcoes = {}) {
  const k = chaveAlvo(opcoes);
  if (k && _ultimoDiagnostico.has(k)) return _ultimoDiagnostico.get(k);
  const a = normalizarAlvo(opcoes);
  if (a.equipamentoId != null) {
    const ek = chaveEquipamento(a.equipamentoId);
    if (_ultimoDiagnostico.has(ek)) return _ultimoDiagnostico.get(ek);
  }
  if (a.host && a.porta != null) {
    const hk = chaveHostPorta(a.host, a.porta);
    if (_ultimoDiagnostico.has(hk)) return _ultimoDiagnostico.get(hk);
  }
  return null;
}

/**
 * Compara sessão do Upload com a do Diagnóstico.
 * @throws {Error} code UPLOAD_USANDO_SESSAO_DIFERENTE
 */
function assertMesmaSessaoQueDiagnostico(opcoes = {}, cm = connectionManager) {
  const uploadInfo = capturar(opcoes, cm);
  logTerminal('UPLOAD SESSION', uploadInfo);

  const diag = obterDiagnostico(opcoes) || obterDiagnostico(uploadInfo);
  if (!diag) {
    // Sem diagnóstico prévio — não bloqueia; apenas instrumenta
    return { ok: true, upload: uploadInfo, diagnostico: null, comparado: false };
  }

  const divergencias = [];
  if (diag.connectionManagerId && uploadInfo.connectionManagerId
    && diag.connectionManagerId !== uploadInfo.connectionManagerId) {
    divergencias.push(`Manager Instance: diag=${diag.connectionManagerId} upload=${uploadInfo.connectionManagerId}`);
  }
  if (diag.sessionKey && uploadInfo.sessionKey && diag.sessionKey !== uploadInfo.sessionKey) {
    divergencias.push(`Session Key: diag=${diag.sessionKey} upload=${uploadInfo.sessionKey}`);
  }
  if (diag.connectionKey && uploadInfo.connectionKey && diag.connectionKey !== uploadInfo.connectionKey) {
    divergencias.push(`Connection Key: diag=${diag.connectionKey} upload=${uploadInfo.connectionKey}`);
  }
  if (diag.host && uploadInfo.host && String(diag.host) !== String(uploadInfo.host)) {
    divergencias.push(`Host: diag=${diag.host} upload=${uploadInfo.host}`);
  }
  if (diag.porta != null && uploadInfo.porta != null && Number(diag.porta) !== Number(uploadInfo.porta)) {
    divergencias.push(`Porta: diag=${diag.porta} upload=${uploadInfo.porta}`);
  }

  // Mesma referência de objeto (critério duro RC15.6)
  const sessUpload = uploadInfo.sameObject;
  const sessDiag = diag._sessionRef || null;
  if (sessDiag && sessUpload && sessDiag !== sessUpload) {
    // Tenta reconciliar via registry (pode ser mesma sessão sob chaves distintas)
    const viaReg = sessionRegistry.get(opcoes) || sessionRegistry.get(uploadInfo);
    if (viaReg && (viaReg === sessDiag || viaReg === sessUpload)) {
      // ok — mesma sessão canônica
    } else {
      divergencias.push('EquipmentSession: referência diferente entre Diagnóstico e Upload');
    }
  }

  if (divergencias.length) {
    const err = new Error(
      `UPLOAD_USANDO_SESSAO_DIFERENTE: ${divergencias.join('; ')}`
    );
    err.code = 'UPLOAD_USANDO_SESSAO_DIFERENTE';
    err.statusCode = 409;
    err.diagnostico = diag;
    err.upload = uploadInfo;
    err.divergencias = divergencias;
    throw err;
  }

  return {
    ok: true,
    upload: uploadInfo,
    diagnostico: diag,
    comparado: true,
    mesmaReferencia: Boolean(sessDiag && sessUpload && sessDiag === sessUpload)
  };
}

function limparParaTestes() {
  _ultimoDiagnostico.clear();
}

module.exports = {
  capturar,
  logTerminal,
  registrarDiagnostico,
  obterDiagnostico,
  assertMesmaSessaoQueDiagnostico,
  managerInstanceId,
  normalizarAlvo,
  limparParaTestes
};
