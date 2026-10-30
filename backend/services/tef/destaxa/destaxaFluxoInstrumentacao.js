'use strict';

/**
 * MRT-31 — Instrumentação do fluxo oficial Destaxa (evidências técnicas).
 *
 * Não altera decisões financeiras. Não carrega DLL. Não chama Koffi.
 * Os eventos 3–7 só ocorrem em execução futura autorizada (TX real).
 *
 * Etapas canônicas:
 *  1. PERSISTENCIA_CONFIRMADA
 *  2. ADAPTER_AUTORIZADO
 *  3. HOST_RECEBEU_TX_START
 *  4. ORQUESTRADOR_ENTROU
 *  5. KOFFI_CALL_BEGIN
 *  6. KOFFI_CALL_END
 *  7. TX_START_RESULT
 */

const destaxaLogger = require('./destaxaLogger');

const ETAPAS_FLUXO = Object.freeze({
  PERSISTENCIA_CONFIRMADA: 'PERSISTENCIA_CONFIRMADA',
  ADAPTER_AUTORIZADO: 'ADAPTER_AUTORIZADO',
  HOST_RECEBEU_TX_START: 'HOST_RECEBEU_TX_START',
  ORQUESTRADOR_ENTROU: 'ORQUESTRADOR_ENTROU',
  KOFFI_CALL_BEGIN: 'KOFFI_CALL_BEGIN',
  KOFFI_CALL_END: 'KOFFI_CALL_END',
  TX_START_RESULT: 'TX_START_RESULT'
});

const CAMPOS_IDENTIDADE = Object.freeze([
  'operation_id',
  'transactionId',
  'venda_id',
  'pdvId',
  'terminalTefId',
  'pid',
  'ppid',
  'fingerprint',
  'idempotency_key',
  'provedor'
]);

/** Sink opcional para testes (não escreve console se coletando). */
let _coletorTeste = null;

function instalarColetorTeste(fn) {
  _coletorTeste = typeof fn === 'function' ? fn : null;
  return () => {
    _coletorTeste = null;
  };
}

function montarContextoEvidencia(parcial = {}) {
  const ctx = {
    sprintInstrumentacao: 'MRT-31',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ppid: typeof process.ppid === 'number' ? process.ppid : null,
    operation_id: parcial.operation_id != null ? String(parcial.operation_id) : null,
    transactionId: parcial.transactionId != null
      ? String(parcial.transactionId)
      : (parcial.transacao_id != null ? String(parcial.transacao_id) : null),
    venda_id: parcial.venda_id != null ? parcial.venda_id : null,
    pdvId: parcial.pdvId != null ? String(parcial.pdvId) : null,
    terminalTefId: parcial.terminalTefId != null ? String(parcial.terminalTefId) : null,
    fingerprint: parcial.fingerprint != null ? String(parcial.fingerprint) : null,
    idempotency_key: parcial.idempotency_key != null ? String(parcial.idempotency_key) : null,
    provedor: parcial.provedor != null ? String(parcial.provedor) : 'destaxa',
    etapa: parcial.etapa || null
  };
  return ctx;
}

/**
 * Remove campos sensíveis e limita payload a metadados de fluxo.
 */
function sanitizarEvidencia(dados = {}) {
  const base = destaxaLogger.sanitizar(dados) || {};
  const proibidos = /pan|senha|cvv|cartao|card|pin|track|password|token_completo|emv/i;
  const limpo = {};
  for (const [k, v] of Object.entries(base)) {
    if (proibidos.test(k)) {
      limpo[k] = '[REDACTED]';
      continue;
    }
    // Não espelhar string completa de entrada DLL (pode conter dados futuros)
    if (k === 'entradaDll' || k === 'entrada' || k === 'camposEntradaCompletos') {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        limpo.chavesEntrada = Object.keys(v);
      } else if (typeof v === 'string') {
        limpo.tamanhoEntrada = v.length;
        limpo.chavesEntrada = String(v).split(';')
          .map((p) => p.split('=')[0])
          .filter(Boolean);
      } else {
        limpo[k] = null;
      }
      continue;
    }
    limpo[k] = v;
  }
  return limpo;
}

function formatarLinhaEvidencia(etapa, contexto = {}, extra = {}) {
  const ctx = montarContextoEvidencia({ ...contexto, etapa });
  return sanitizarEvidencia({
    ...ctx,
    etapa,
    ...extra
  });
}

/**
 * Registra etapa estruturada. Nunca lança — instrumentação best-effort.
 * Falha do coletor/logger NÃO propaga (MRT-32).
 */
function registrarEtapaFluxo(etapa, contexto = {}, extra = {}) {
  try {
    const nome = String(etapa || '').trim();
    if (!nome) return null;
    const linha = formatarLinhaEvidencia(nome, contexto, extra);
    try {
      if (_coletorTeste) {
        _coletorTeste(linha);
      } else {
        destaxaLogger.registrar(`fluxo.${nome}`, linha);
      }
    } catch (_) {
      // coletor/logger falhou — fluxo principal intacto
    }
    return linha;
  } catch (_) {
    return null;
  }
}

/**
 * Envolve chamada nativa com KOFFI_CALL_BEGIN/END.
 * Sempre repropaga a exceção original da `fn` (instrumentação não mascara).
 * Falha ao registrar BEGIN/END é ignorada.
 *
 * @template T
 * @param {object} opcoes
 * @param {string} opcoes.exportNome
 * @param {object} [opcoes.contexto]
 * @param {object} [opcoes.extraBegin]
 * @param {function(): T} opcoes.fn
 * @returns {T}
 */
function envolverChamadaInstrumentada({ exportNome, contexto = {}, extraBegin = {}, fn }) {
  const t0 = process.hrtime.bigint();
  try {
    registrarEtapaFluxo(ETAPAS_FLUXO.KOFFI_CALL_BEGIN, contexto, {
      export: exportNome || null,
      ...extraBegin
    });
  } catch (_) { /* ignore */ }

  try {
    const out = fn();
    try {
      registrarEtapaFluxo(ETAPAS_FLUXO.KOFFI_CALL_END, contexto, {
        export: exportNome || null,
        duracaoMs: Number(process.hrtime.bigint() - t0) / 1e6,
        ok: true,
        codigo: out && out.codigo != null ? out.codigo : null
      });
    } catch (_) { /* ignore */ }
    return out;
  } catch (error) {
    try {
      registrarEtapaFluxo(ETAPAS_FLUXO.KOFFI_CALL_END, contexto, {
        export: exportNome || null,
        duracaoMs: Number(process.hrtime.bigint() - t0) / 1e6,
        ok: false,
        erro: String(error?.message || error || '')
      });
    } catch (_) { /* ignore */ }
    throw error;
  }
}

/**
 * Documentação estática do caminho oficial (sem execução).
 */
function descreverCaminhoOficial() {
  return {
    caminho: [
      'PDV/API',
      'TefManager.autorizar',
      'garantirIdentidadeOperacao + criarTransacaoExclusiva',
      ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA,
      'DestaxaRealAdapter.autorizarPagamento(persistenciaConfirmada)',
      ETAPAS_FLUXO.ADAPTER_AUTORIZADO,
      'habilitarTransacaoReal (somente se gate ON — futuro)',
      'executarCicloCrt → DestaxaHostBridge.iniciarTransacaoDestaxa',
      'IPC TX_START (transactionId no envelope; campos ≠ transactionId)',
      'DestaxaNativeHost._executarNativa(TX_START)',
      ETAPAS_FLUXO.HOST_RECEBEU_TX_START,
      'DestaxaTransacaoOrquestrador.iniciarTransacao',
      ETAPAS_FLUXO.ORQUESTRADOR_ENTROU,
      ETAPAS_FLUXO.KOFFI_CALL_BEGIN,
      'Koffi iniciaTransacaoDestaxa(...)',
      ETAPAS_FLUXO.KOFFI_CALL_END,
      ETAPAS_FLUXO.TX_START_RESULT
    ],
    etapas: { ...ETAPAS_FLUXO },
    camposIdentidade: [...CAMPOS_IDENTIDADE],
    mrt24: 'UNKNOWN — não repetir',
    gatePadrao: 'DESTAXA_REAL_TRANSACTION_ENABLED deve permanecer OFF nesta sprint'
  };
}

/**
 * Serializa envelope IPC TX_START (espelho do HostBridge) — sem enviar.
 */
function montarEnvelopeIpcTxStart({ operacao, campos = {}, transactionId = null } = {}) {
  return {
    operation: 'TX_START',
    payload: {
      operacao: operacao != null ? String(operacao) : null,
      campos: campos && typeof campos === 'object' ? { ...campos } : {}
    },
    transactionId: transactionId != null ? String(transactionId) : null,
    nota: 'transactionId é correlação CDS↔Host; não entra na string entrada da DLL'
  };
}

module.exports = {
  ETAPAS_FLUXO,
  CAMPOS_IDENTIDADE,
  montarContextoEvidencia,
  sanitizarEvidencia,
  formatarLinhaEvidencia,
  registrarEtapaFluxo,
  envolverChamadaInstrumentada,
  descreverCaminhoOficial,
  montarEnvelopeIpcTxStart,
  instalarColetorTeste
};
