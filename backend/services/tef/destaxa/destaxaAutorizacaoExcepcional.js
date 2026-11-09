'use strict';

/**
 * TEF-DESTAXA-51.02 — Autorização excepcional de uso único (R$1,00 débito CRT).
 *
 * Gate DESTAXA_REAL_TRANSACTION_ENABLED permanece OFF por padrão.
 * Emissão somente por chamada explícita (nunca no boot).
 * Consumo atômico ISSUED→CONSUMED antes da chamada financeira.
 * Ledger em arquivo local (não banco oficial); consumida sobrevive a restart.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  ERROS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  OPERACOES,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('./destaxaConstantes');
const { normalizarTipoTef } = require('../tefFluxoPagamento');
const {
  modalidadeHomologacaoDebitoPermitida
} = require('./destaxaHomologacaoDebitoPolitica');

const ESTADOS_AUTH = Object.freeze({
  ISSUED: 'ISSUED',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED'
});

const TTL_PADRAO_MS = 30 * 60 * 1000;
const LOCK_TENTATIVAS = 40;
const LOCK_ESPERA_MS = 25;

let caminhoLedgerOverride = null;

function caminhoLedgerPadrao() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, 'CDS-SISTEMAS', 'tef', 'destaxa-autorizacao-excepcional.json');
}

function obterCaminhoLedger() {
  return caminhoLedgerOverride || caminhoLedgerPadrao();
}

function configurarCaminhoLedgerParaTeste(caminho) {
  if (caminho != null && typeof caminho !== 'string') {
    throw new TypeError('caminho do ledger de teste deve ser string ou null');
  }
  caminhoLedgerOverride = caminho ? path.resolve(caminho) : null;
  return obterCaminhoLedger();
}

function limparCaminhoLedgerDeTeste() {
  caminhoLedgerOverride = null;
}

function agoraMs() {
  return Date.now();
}

function novoId() {
  return crypto.randomBytes(16).toString('hex');
}

function sleepSync(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    /* spin curto — lock local de arquivo */
  }
}

function caminhoLock(ledgerPath) {
  return `${ledgerPath}.lock`;
}

function adquirirLock(ledgerPath) {
  const lockPath = caminhoLock(ledgerPath);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  for (let i = 0; i < LOCK_TENTATIVAS; i += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}:${new Date().toISOString()}`);
      return fd;
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        sleepSync(LOCK_ESPERA_MS);
        continue;
      }
      throw error;
    }
  }
  const erro = new Error('Não foi possível obter lock da autorização excepcional Destaxa');
  erro.codigo = ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_CONCORRENCIA;
  throw erro;
}

function liberarLock(fd, ledgerPath) {
  try {
    if (fd != null) fs.closeSync(fd);
  } catch (_) { /* ignore */ }
  try {
    fs.unlinkSync(caminhoLock(ledgerPath));
  } catch (_) { /* ignore */ }
}

function ledgerVazio() {
  return {
    versao: 1,
    atualizadoEm: new Date().toISOString(),
    autorizacoes: []
  };
}

function lerLedgerUnlocked(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return ledgerVazio();
  try {
    const bruto = fs.readFileSync(ledgerPath, 'utf8');
    if (!bruto.trim()) return ledgerVazio();
    const parsed = JSON.parse(bruto);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.autorizacoes)) {
      return ledgerVazio();
    }
    return {
      versao: Number(parsed.versao) || 1,
      atualizadoEm: parsed.atualizadoEm || null,
      autorizacoes: parsed.autorizacoes.filter((a) => a && typeof a === 'object')
    };
  } catch (_) {
    return ledgerVazio();
  }
}

function gravarLedgerUnlocked(ledgerPath, ledger) {
  const payload = {
    versao: 1,
    atualizadoEm: new Date().toISOString(),
    autorizacoes: Array.isArray(ledger.autorizacoes) ? ledger.autorizacoes : []
  };
  const tmp = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, ledgerPath);
}

function comLockLedger(fn) {
  const ledgerPath = obterCaminhoLedger();
  const fd = adquirirLock(ledgerPath);
  try {
    const ledger = lerLedgerUnlocked(ledgerPath);
    const resultado = fn(ledger, ledgerPath);
    return resultado;
  } finally {
    liberarLock(fd, ledgerPath);
  }
}

function auditar(evento, dados = {}) {
  try {
    const destaxaLogger = require('./destaxaLogger');
    destaxaLogger.registrarPersistente(evento, {
      sprint: 'TEF-DESTAXA-51.02',
      ...dados
    });
  } catch (_) {
    /* auditoria best-effort */
  }
}

function projetarPublico(auth) {
  if (!auth) return null;
  return {
    authorizationId: auth.authorizationId,
    status: auth.status,
    valorCentavos: auth.valorCentavos,
    tipoPermitido: [...(auth.tipoPermitido || [])],
    formaPagamento: auth.formaPagamento,
    operacao: auth.operacao,
    emitidoEm: auth.emitidoEm,
    expiresAt: auth.expiresAt,
    consumidoEm: auth.consumidoEm || null,
    motivo: auth.motivo || null
  };
}

function marcarExpiradas(ledger, agora = agoraMs()) {
  let mudou = false;
  for (const auth of ledger.autorizacoes) {
    if (auth.status === ESTADOS_AUTH.ISSUED && Number(auth.expiresAtMs) <= agora) {
      auth.status = ESTADOS_AUTH.EXPIRED;
      auth.expiradoEm = new Date(agora).toISOString();
      mudou = true;
    }
  }
  return mudou;
}

function tipoCompativel(tipoPdv, tipoPermitido = []) {
  const tipo = normalizarTipoTef(tipoPdv);
  if (!modalidadeHomologacaoDebitoPermitida(tipo)) return false;
  const permitidos = (tipoPermitido || []).map((t) => normalizarTipoTef(t));
  return permitidos.includes(tipo);
}

/**
 * Emite autorização excepcional one-shot. NÃO chamar no boot.
 */
function emitirAutorizacaoExcepcional(opcoes = {}) {
  const ttlMs = Number.isFinite(Number(opcoes.ttlMs)) && Number(opcoes.ttlMs) > 0
    ? Math.floor(Number(opcoes.ttlMs))
    : TTL_PADRAO_MS;
  const agora = agoraMs();
  const authorizationId = String(opcoes.authorizationId || novoId()).trim();
  const registro = {
    authorizationId,
    status: ESTADOS_AUTH.ISSUED,
    valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    tipoPermitido: ['cartao_debito', 'debito'],
    formaPagamento: 'A vista',
    operacao: OPERACOES.CRT,
    emitidoEm: new Date(agora).toISOString(),
    expiresAtMs: agora + ttlMs,
    expiresAt: new Date(agora + ttlMs).toISOString(),
    consumidoEm: null,
    motivo: String(opcoes.motivo || 'homologacao-debito-r1').slice(0, 120),
    emitidoPor: String(opcoes.emitidoPor || 'manual').slice(0, 80)
  };

  return comLockLedger((ledger, ledgerPath) => {
    marcarExpiradas(ledger, agora);
    if (ledger.autorizacoes.some((a) => a.authorizationId === authorizationId)) {
      const erro = new Error(`authorizationId já existe: ${authorizationId}`);
      erro.codigo = ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA;
      throw erro;
    }
    ledger.autorizacoes.push(registro);
    gravarLedgerUnlocked(ledgerPath, ledger);
    auditar('autorizacao.excepcional.emitida', {
      authorizationId,
      expiresAt: registro.expiresAt,
      valorCentavos: registro.valorCentavos,
      operacao: registro.operacao
    });
    return {
      ok: true,
      autorizacao: projetarPublico(registro)
    };
  });
}

function inspecionarAutorizacaoExcepcional(authorizationId) {
  const id = String(authorizationId || '').trim();
  if (!id) {
    return { ok: false, codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_AUSENTE, autorizacao: null };
  }
  return comLockLedger((ledger, ledgerPath) => {
    const agora = agoraMs();
    const mudou = marcarExpiradas(ledger, agora);
    if (mudou) gravarLedgerUnlocked(ledgerPath, ledger);
    const auth = ledger.autorizacoes.find((a) => a.authorizationId === id) || null;
    if (!auth) {
      return {
        ok: false,
        codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_AUSENTE,
        autorizacao: null
      };
    }
    return {
      ok: auth.status === ESTADOS_AUTH.ISSUED,
      codigo: auth.status === ESTADOS_AUTH.ISSUED
        ? null
        : (auth.status === ESTADOS_AUTH.EXPIRED
          ? ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_EXPIRADA
          : ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_CONSUMIDA),
      autorizacao: projetarPublico(auth)
    };
  });
}

/**
 * Localiza ISSUED compatível sem consumir (prepararAutorizacao).
 */
function encontrarAutorizacaoIssuidaCompativel({
  valorCentavos = null,
  tipoPdv = null,
  operacao = OPERACOES.CRT,
  authorizationId = null
} = {}) {
  return comLockLedger((ledger, ledgerPath) => {
    const agora = agoraMs();
    const mudou = marcarExpiradas(ledger, agora);
    if (mudou) gravarLedgerUnlocked(ledgerPath, ledger);

    const candidatas = ledger.autorizacoes.filter((a) => a.status === ESTADOS_AUTH.ISSUED);
    const id = authorizationId != null ? String(authorizationId).trim() : '';
    const lista = id
      ? candidatas.filter((a) => a.authorizationId === id)
      : candidatas;

    for (const auth of lista) {
      if (Number(auth.valorCentavos) !== Number(valorCentavos)) continue;
      if (String(auth.operacao || '').toUpperCase() !== String(operacao || '').toUpperCase()) continue;
      if (!tipoCompativel(tipoPdv, auth.tipoPermitido)) continue;
      return {
        ok: true,
        autorizacao: projetarPublico(auth)
      };
    }
    return {
      ok: false,
      codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_AUSENTE,
      autorizacao: null
    };
  });
}

/**
 * Consumo atômico ISSUED→CONSUMED. Capability retornada autoriza uma sessão nativa.
 */
function consumirAutorizacaoExcepcionalAtomico({
  authorizationId = null,
  valorCentavos = null,
  tipoPdv = null,
  operacao = OPERACOES.CRT
} = {}) {
  return comLockLedger((ledger, ledgerPath) => {
    const agora = agoraMs();
    marcarExpiradas(ledger, agora);

    const id = authorizationId != null ? String(authorizationId).trim() : '';
    let auth = null;
    if (id) {
      auth = ledger.autorizacoes.find((a) => a.authorizationId === id) || null;
    } else {
      auth = ledger.autorizacoes.find((a) => {
        if (a.status !== ESTADOS_AUTH.ISSUED) return false;
        if (Number(a.valorCentavos) !== Number(valorCentavos)) return false;
        if (String(a.operacao || '').toUpperCase() !== String(operacao || '').toUpperCase()) return false;
        return tipoCompativel(tipoPdv, a.tipoPermitido);
      }) || null;
    }

    if (!auth) {
      auditar('autorizacao.excepcional.consumo_falhou', {
        authorizationId: id || null,
        motivo: 'ausente'
      });
      return {
        ok: false,
        codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_AUSENTE,
        mensagem: 'Autorização excepcional Destaxa ausente',
        permit: null
      };
    }

    if (auth.status === ESTADOS_AUTH.CONSUMED || auth.status === ESTADOS_AUTH.REJECTED) {
      auditar('autorizacao.excepcional.consumo_falhou', {
        authorizationId: auth.authorizationId,
        motivo: 'consumida'
      });
      return {
        ok: false,
        codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_CONSUMIDA,
        mensagem: 'Autorização excepcional Destaxa já consumida — sem retry',
        permit: null,
        autorizacao: projetarPublico(auth)
      };
    }

    if (auth.status === ESTADOS_AUTH.EXPIRED || Number(auth.expiresAtMs) <= agora) {
      auth.status = ESTADOS_AUTH.EXPIRED;
      auth.expiradoEm = new Date(agora).toISOString();
      gravarLedgerUnlocked(ledgerPath, ledger);
      auditar('autorizacao.excepcional.consumo_falhou', {
        authorizationId: auth.authorizationId,
        motivo: 'expirada'
      });
      return {
        ok: false,
        codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_EXPIRADA,
        mensagem: 'Autorização excepcional Destaxa expirada',
        permit: null,
        autorizacao: projetarPublico(auth)
      };
    }

    if (Number(auth.valorCentavos) !== Number(valorCentavos)
      || String(auth.operacao || '').toUpperCase() !== String(operacao || '').toUpperCase()
      || !tipoCompativel(tipoPdv, auth.tipoPermitido)) {
      auditar('autorizacao.excepcional.consumo_falhou', {
        authorizationId: auth.authorizationId,
        motivo: 'constraints'
      });
      return {
        ok: false,
        codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA,
        mensagem: 'Autorização excepcional incompatível com valor/modalidade/operação',
        permit: null,
        autorizacao: projetarPublico(auth)
      };
    }

    auth.status = ESTADOS_AUTH.CONSUMED;
    auth.consumidoEm = new Date(agora).toISOString();
    auth.consumidoValorCentavos = Number(valorCentavos);
    auth.consumidoTipo = normalizarTipoTef(tipoPdv);
    gravarLedgerUnlocked(ledgerPath, ledger);

    const permit = Object.freeze({
      authorizationId: auth.authorizationId,
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      tipoPermitido: Object.freeze(['cartao_debito', 'debito']),
      formaPagamento: 'A vista',
      operacao: OPERACOES.CRT,
      consumidoEm: auth.consumidoEm,
      exceptional: true,
      oneShot: true,
      retryAllowed: false
    });

    auditar('autorizacao.excepcional.consumida', {
      authorizationId: auth.authorizationId,
      valorCentavos: permit.valorCentavos,
      tipo: auth.consumidoTipo,
      operacao: permit.operacao
    });

    return {
      ok: true,
      codigo: null,
      mensagem: 'Autorização excepcional consumida',
      permit,
      autorizacao: projetarPublico(auth)
    };
  });
}

/**
 * Valida capability já consumida (em memória do bridge) para uma operação.
 */
function validarPermitExcepcional(permit, {
  valorCentavos = null,
  tipoPdv = null,
  operacao = OPERACOES.CRT
} = {}) {
  if (!permit || permit.exceptional !== true || permit.oneShot !== true) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA,
      mensagem: 'Permit excepcional ausente ou inválido'
    };
  }
  if (Number(permit.valorCentavos) !== Number(valorCentavos)) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA,
      mensagem: 'Permit excepcional com valor divergente'
    };
  }
  if (String(permit.operacao || '').toUpperCase() !== String(operacao || '').toUpperCase()) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA,
      mensagem: 'Permit excepcional com operação divergente'
    };
  }
  if (!tipoCompativel(tipoPdv, permit.tipoPermitido)) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA,
      mensagem: 'Permit excepcional com modalidade divergente'
    };
  }
  return { ok: true, codigo: null };
}

/**
 * Gate env ON ou permit excepcional válido em memória.
 * Nunca liga DESTAXA_REAL_TRANSACTION_ENABLED.
 */
function transacaoRealEfetivaPermitida(exceptionalPermit = null) {
  if (transacaoRealHabilitada()) return true;
  return Boolean(exceptionalPermit && exceptionalPermit.exceptional === true && exceptionalPermit.oneShot === true);
}

function descreverPolitica() {
  return {
    gateEnv: REAL_TRANSACTION_ENV,
    gatePadrao: 'OFF',
    valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    tipos: ['cartao_debito', 'debito'],
    formaPagamento: 'A vista',
    operacao: OPERACOES.CRT,
    ttlPadraoMs: TTL_PADRAO_MS,
    ledgerPath: obterCaminhoLedger(),
    estados: { ...ESTADOS_AUTH },
    emitOnBoot: false,
    retryAposConsumo: false
  };
}

module.exports = {
  ESTADOS_AUTH,
  TTL_PADRAO_MS,
  emitirAutorizacaoExcepcional,
  inspecionarAutorizacaoExcepcional,
  encontrarAutorizacaoIssuidaCompativel,
  consumirAutorizacaoExcepcionalAtomico,
  validarPermitExcepcional,
  transacaoRealEfetivaPermitida,
  configurarCaminhoLedgerParaTeste,
  limparCaminhoLedgerDeTeste,
  obterCaminhoLedger,
  descreverPolitica
};
