'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PROVIDER } = require('./destaxaConstantes');

const CAMPOS_SENSIVEIS = /pan|senha|password|passphrase|cvv|cartao|card|pin|track|secret|credential|token|chave|key/i;
const VALORES_SENSIVEIS = /\b(pan|senha|password|passphrase|cvv|cartao|card|pin|track|secret|credential|token|chave|key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
let arquivoAuditoriaOverride = null;
const chamadasNativasQueFalharam = new WeakSet();

function sanitizarTexto(valor) {
  return valor.replace(VALORES_SENSIVEIS, '$1$2[REDACTED]');
}

function sanitizar(valor) {
  if (typeof valor === 'string') return sanitizarTexto(valor);
  if (valor == null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(sanitizar);
  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (CAMPOS_SENSIVEIS.test(chave)) {
      saida[chave] = '[REDACTED]';
    } else {
      saida[chave] = sanitizar(item);
    }
  }
  return saida;
}

function obterArquivoAuditoria() {
  if (arquivoAuditoriaOverride) return arquivoAuditoriaOverride;
  if (process.env.DESTAXA_OBSERVABILITY_LOG_PATH) {
    return path.resolve(process.env.DESTAXA_OBSERVABILITY_LOG_PATH);
  }
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, 'CDS-SISTEMAS', 'logs', 'destaxa-nativehost-observability.jsonl');
}

function persistir(payload) {
  const arquivo = obterArquivoAuditoria();
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const fd = fs.openSync(arquivo, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(payload)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function criarPayload(evento, dados = {}) {
  return sanitizar({
    provider: PROVIDER,
    evento,
    ...dados
  });
}

function registrar(evento, dados = {}) {
  const payload = criarPayload(evento, dados);
  console.log(`[TEF-${PROVIDER}] ${evento}`, JSON.stringify(payload));
  return payload;
}

function registrarPersistente(evento, dados = {}) {
  const payload = criarPayload(evento, {
    registradoEm: new Date().toISOString(),
    ...dados
  });
  persistir(payload);
  console.log(`[TEF-${PROVIDER}] ${evento}`, JSON.stringify(payload));
  return payload;
}

function executarChamadaNativaAuditada({
  requestId,
  pid = process.pid,
  functionName,
  fn,
  obterCodigoResultado
}) {
  if (typeof fn !== 'function') throw new TypeError('A função nativa simulada ou real é obrigatória');
  const id = requestId || crypto.randomUUID();
  const startedAt = new Date().toISOString();

  registrarPersistente('native.call.enter', {
    requestId: id,
    pid,
    functionName,
    startedAt,
    entryConfirmed: true
  });

  const inicio = process.hrtime.bigint();
  let retorno;
  try {
    retorno = fn();
  } catch (error) {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      chamadasNativasQueFalharam.add(error);
    }
    const returnedAt = new Date().toISOString();
    const durationMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    registrarPersistente('native.call.exception', {
      requestId: id,
      pid,
      functionName,
      startedAt,
      returnedAt,
      durationMs,
      exception: {
        name: error?.name || 'Error',
        code: error?.code || null
      }
    });
    throw error;
  }

  const returnedAt = new Date().toISOString();
  const durationMs = Number(process.hrtime.bigint() - inicio) / 1e6;
  const resultCode = typeof obterCodigoResultado === 'function'
    ? obterCodigoResultado(retorno)
    : null;
  registrarPersistente('native.call.return', {
    requestId: id,
    pid,
    functionName,
    startedAt,
    returnedAt,
    durationMs,
    resultCode,
    result: { code: resultCode }
  });
  return { retorno, resultCode, startedAt, returnedAt, durationMs };
}

function ehExcecaoDeChamadaNativa(error) {
  return Boolean(error && chamadasNativasQueFalharam.has(error));
}

function configurarArquivoAuditoria(caminho) {
  if (typeof caminho !== 'string' || !caminho.trim()) {
    throw new TypeError('O caminho do arquivo de auditoria deve ser informado');
  }
  arquivoAuditoriaOverride = path.resolve(caminho);
}

function limparArquivoAuditoriaConfigurado() {
  arquivoAuditoriaOverride = null;
}

function registrarBlocoReal(diag = {}, extra = {}) {
  const exports = diag.exports || {};
  const linhas = [
    '[DESTAXA]',
    `Arquitetura: ${diag.processArch || process.arch}`,
    `DLL: ${diag.dllPath || ''}`,
    `DLL encontrada: ${diag.dllExists === true}`,
    `DLL carregada: ${diag.dllLoaded === true}`,
    `Exports: iniciaClientDestaxa=${Boolean(exports.iniciaClientDestaxa)}; iniciaTransacaoDestaxa=${Boolean(exports.iniciaTransacaoDestaxa)}; continuaTransacaoDestaxa=${Boolean(exports.continuaTransacaoDestaxa)}; finalizaTransacaoDestaxa=${Boolean(exports.finalizaTransacaoDestaxa)}`,
    `iniciaClient: ${extra.iniciaClientExecutado === true}`,
    `Código: ${diag.clientResultCode || extra.codigoDestaxa || ''}`,
    `Tempo: ${extra.duracaoMs != null ? `${extra.duracaoMs}ms` : ''}`,
    `Estado: ${diag.estado || ''}`
  ];
  const bloco = linhas.join('\n');
  registrarPersistente('diagnostic.block', {
    requestId: extra.requestId || null,
    pid: extra.pid || process.pid,
    functionName: 'iniciaClientDestaxa',
    bloco
  });
  return bloco;
}

module.exports = {
  registrar,
  registrarPersistente,
  registrarBlocoReal,
  sanitizar,
  executarChamadaNativaAuditada,
  ehExcecaoDeChamadaNativa,
  configurarArquivoAuditoria,
  limparArquivoAuditoriaConfigurado,
  obterArquivoAuditoria
};
