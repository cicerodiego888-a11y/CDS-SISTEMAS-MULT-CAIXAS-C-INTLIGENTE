'use strict';

/**
 * TEF-DESTAXA-51.27 — Reconciliação administrativa do cenário INEXISTENT.
 *
 * Escopo exclusivo: tef_transacoes.id=1 (operação histórica Destaxa).
 * Não chama DLL / NativeHost / FINALIZE. Não gera NSU, autorização, venda,
 * lançamento financeiro nem evento fiscal.
 *
 * Distinção explícita:
 *   CONFIRMED_SUCCESS | CONFIRMED_DENIED | CANCELLED | INEXISTENT
 * INEXISTENT ≠ CANCELLED (não houve cancelamento financeiro na adquirente).
 */

const crypto = require('crypto');
const tefContrato = require('./tefContrato');
const { FINANCIAL_STATES } = require('./tefFinancialSafetyPolicy');

const OPERACAO_AUTORIZADA_51_27 = Object.freeze({
  id: 1,
  valor: 1,
  modalidade: 'cartao_debito',
  provedor: 'destaxa',
  idempotency_key: 'tef-fp-90b41858f0aff5d47c573e5c3d86bc62',
  operation_id: 'op_ef2ed65b9230_744378e59797f9a7',
  requestId: 'd3cd929385f4281e',
  sprint: 'TEF-DESTAXA-51.27'
});

const STATUS_ADMINISTRATIVO = tefContrato.STATUS.NAO_REALIZADA;
const FINANCIAL_STATE_ALVO = FINANCIAL_STATES.INEXISTENT;
const TIPO_LOG = 'RECONCILIACAO_ADMINISTRATIVA_INEXISTENTE';

const REFERENCIA_DESTAXA_ESPERADA = Object.freeze({
  canal: 'WhatsApp Integração Destaxa',
  resumo:
    'Sem aproximação do cartão / sem continuaTransacao → não aprovada pela adquirente; não existe pendência remota.'
});

const REFERENCIA_LOG_HISTORICO_ESPERADA = Object.freeze({
  artefato: 'vspague-client.log',
  resumo:
    'Timeout aguardando aplicação comercial; encerramento operacional com resposta 78; CDS START→99→CONTINUE HOST_SECURITY_OPERATION_BLOCKED (pré-51.20).'
});

function criarErro(codigo, mensagem, detalhes = null) {
  const error = new Error(mensagem);
  error.code = codigo;
  if (detalhes) error.detalhes = detalhes;
  return error;
}

function normalizarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normalizarStatus(v) {
  return normalizarTexto(v).toLowerCase();
}

function valorNumerico(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function ePendenciaOperacionalAtiva(status) {
  return normalizarStatus(status) === tefContrato.STATUS.PENDENTE;
}

function eTerminalAdministrativoInexistente(status) {
  return normalizarStatus(status) === STATUS_ADMINISTRATIVO;
}

function contaComoPendenciaBloqueadora(status) {
  return ePendenciaOperacionalAtiva(status);
}

/**
 * Valida pedido administrativo. Não escreve no banco.
 * @returns {{ ok: true } | never} lança erro tipado em falha
 */
function validarPedidoReconciliacaoInexistente(pedido = {}, linha = null) {
  const idPedido = Number(pedido.transacaoId ?? pedido.id);
  if (idPedido !== OPERACAO_AUTORIZADA_51_27.id) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_ID_NAO_AUTORIZADO',
      `Reconciliação INEXISTENT autorizada somente para id=${OPERACAO_AUTORIZADA_51_27.id}.`,
      { idInformado: idPedido }
    );
  }

  if (!normalizarTexto(pedido.operador)) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_OPERADOR_AUSENTE',
      'Operador responsável é obrigatório.'
    );
  }

  if (!normalizarTexto(pedido.observacao)) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_OBSERVACAO_AUSENTE',
      'Observação obrigatória para reconciliação administrativa.'
    );
  }

  if (pedido.confirmacaoExplicitaPo !== true
      && pedido.confirmacao_explicita_po !== true
      && pedido.confirmacaoExplicita !== true
      && pedido.confirmacao_explicita !== true) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_CONFIRMACAO_AUSENTE',
      'Confirmação explícita do Product Owner é obrigatória.'
    );
  }

  if (!normalizarTexto(pedido.referenciaDestaxa)
      && !normalizarTexto(pedido.referencia_destaxa)) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_REF_DESTAXA_AUSENTE',
      'Referência à resposta Destaxa é obrigatória.'
    );
  }

  if (!normalizarTexto(pedido.referenciaLogHistorico)
      && !normalizarTexto(pedido.referencia_log_historico)) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_REF_LOG_AUSENTE',
      'Referência ao log histórico é obrigatória.'
    );
  }

  if (linha == null || typeof linha !== 'object') {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_LINHA_AUSENTE',
      'Linha atual da operação é obrigatória para auditoria.'
    );
  }

  if (Number(linha.id) !== OPERACAO_AUTORIZADA_51_27.id) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_ID_NAO_AUTORIZADO',
      `Linha id=${linha.id} fora do escopo autorizado.`,
      { idLinha: linha.id }
    );
  }

  const idem = normalizarTexto(linha.idempotency_key);
  if (idem !== OPERACAO_AUTORIZADA_51_27.idempotency_key) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_IDEMPOTENCY_DIVERGENTE',
      'idempotency_key diverge da operação autorizada.',
      { esperado: OPERACAO_AUTORIZADA_51_27.idempotency_key, atual: idem || null }
    );
  }

  if (valorNumerico(linha.valor) !== OPERACAO_AUTORIZADA_51_27.valor) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_VALOR_DIVERGENTE',
      'Valor diverge da operação autorizada.',
      { esperado: OPERACAO_AUTORIZADA_51_27.valor, atual: linha.valor }
    );
  }

  const modalidade = normalizarTexto(linha.tipo || linha.modalidade).toLowerCase();
  if (modalidade !== OPERACAO_AUTORIZADA_51_27.modalidade) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_MODALIDADE_DIVERGENTE',
      'Modalidade diverge da operação autorizada.',
      { esperado: OPERACAO_AUTORIZADA_51_27.modalidade, atual: modalidade || null }
    );
  }

  const provedor = normalizarTexto(linha.provedor).toLowerCase();
  if (provedor && provedor !== OPERACAO_AUTORIZADA_51_27.provedor) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_PROVEDOR_DIVERGENTE',
      'Provedor diverge da operação autorizada.',
      { esperado: OPERACAO_AUTORIZADA_51_27.provedor, atual: provedor }
    );
  }

  return { ok: true };
}

function montarPayloadAuditoria({ linha, pedido, estadoAnterior, estadoPosterior, reconciliadoEm }) {
  return {
    sprint: OPERACAO_AUTORIZADA_51_27.sprint,
    cenario: 'INEXISTENT',
    financialState: FINANCIAL_STATE_ALVO,
    statusAnterior: estadoAnterior,
    statusPosterior: estadoPosterior,
    motivoAdministrativo:
      'Operação não realizada/existente na adquirente conforme esclarecimento Destaxa (sem aproximação / sem continuaTransacao).',
    operador: normalizarTexto(pedido.operador),
    observacao: normalizarTexto(pedido.observacao),
    confirmacaoExplicitaPo: true,
    referenciaDestaxa: normalizarTexto(pedido.referenciaDestaxa || pedido.referencia_destaxa),
    referenciaLogHistorico: normalizarTexto(
      pedido.referenciaLogHistorico || pedido.referencia_log_historico
    ),
    referenciaDestaxaEsperada: REFERENCIA_DESTAXA_ESPERADA,
    referenciaLogHistoricoEsperada: REFERENCIA_LOG_HISTORICO_ESPERADA,
    identidade: {
      id: OPERACAO_AUTORIZADA_51_27.id,
      valor: OPERACAO_AUTORIZADA_51_27.valor,
      modalidade: OPERACAO_AUTORIZADA_51_27.modalidade,
      provedor: OPERACAO_AUTORIZADA_51_27.provedor,
      idempotency_key: OPERACAO_AUTORIZADA_51_27.idempotency_key,
      operation_id: OPERACAO_AUTORIZADA_51_27.operation_id,
      requestId: OPERACAO_AUTORIZADA_51_27.requestId
    },
    preservacoes: {
      nsu: linha.nsu == null ? null : linha.nsu,
      autorizacao: linha.autorizacao == null ? null : linha.autorizacao,
      venda_id: linha.venda_id == null ? null : linha.venda_id,
      nsuDevePermanecerNull: true,
      autorizacaoDevePermanecerNull: true,
      vendaDevePermanecerNull: true,
      semLancamentoFinanceiro: true,
      semEventoFiscal: true,
      semChamadaDll: true,
      semCrt: true
    },
    timestamps: {
      criado_em_original: linha.criado_em || null,
      atualizado_em_anterior: linha.atualizado_em || null,
      reconciliado_em: reconciliadoEm
    },
    naoInventar: {
      FINALIZE_9: true,
      nsu: true,
      autorizacao: true,
      comprovante: true
    }
  };
}

/**
 * Aplica reconciliação administrativa INEXISTENT.
 *
 * @param {object} opcoes
 * @param {object} opcoes.linha — snapshot atual (pré-alteração)
 * @param {object} opcoes.pedido — operador, observação, confirmações, referências
 * @param {function} opcoes.persistir — ({ update, log }) => resultado
 * @param {string} [opcoes.agora] — ISO datetime
 */
function reconciliarAdministrativamenteInexistente({
  linha,
  pedido = {},
  persistir,
  agora = null
} = {}) {
  validarPedidoReconciliacaoInexistente(pedido, linha);

  const reconciliadoEm = agora || new Date().toISOString();
  const estadoAnterior = normalizarStatus(linha.status) || null;

  if (eTerminalAdministrativoInexistente(estadoAnterior)) {
    const auditoria = montarPayloadAuditoria({
      linha,
      pedido,
      estadoAnterior,
      estadoPosterior: STATUS_ADMINISTRATIVO,
      reconciliadoEm
    });
    return {
      ok: true,
      idempotente: true,
      alterado: false,
      transacaoId: OPERACAO_AUTORIZADA_51_27.id,
      statusAnterior: estadoAnterior,
      statusPosterior: STATUS_ADMINISTRATIVO,
      financialState: FINANCIAL_STATE_ALVO,
      nsu: null,
      autorizacao: null,
      venda_id: linha.venda_id == null ? null : linha.venda_id,
      auditoria,
      mensagem: 'Reconciliação INEXISTENT já aplicada (idempotente).'
    };
  }

  if (!ePendenciaOperacionalAtiva(estadoAnterior)) {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_ESTADO_INVALIDO',
      `Estado atual "${estadoAnterior}" não é elegível para INEXISTENT (exige pendente).`,
      { status: estadoAnterior }
    );
  }

  if (linha.nsu != null && String(linha.nsu).trim() !== '') {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_NSU_PRESENTE',
      'Operação com NSU não pode ser marcada como INEXISTENT nesta sprint.'
    );
  }
  if (linha.autorizacao != null && String(linha.autorizacao).trim() !== '') {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_AUTORIZACAO_PRESENTE',
      'Operação com autorização não pode ser marcada como INEXISTENT nesta sprint.'
    );
  }
  if (linha.venda_id != null && String(linha.venda_id).trim() !== '') {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_VENDA_VINCULADA',
      'Operação com venda vinculada fora do escopo desta reconciliação.'
    );
  }

  const auditoria = montarPayloadAuditoria({
    linha,
    pedido,
    estadoAnterior,
    estadoPosterior: STATUS_ADMINISTRATIVO,
    reconciliadoEm
  });

  const update = {
    id: OPERACAO_AUTORIZADA_51_27.id,
    statusEsperado: tefContrato.STATUS.PENDENTE,
    status: STATUS_ADMINISTRATIVO,
    nsu: null,
    autorizacao: null,
    venda_id: null,
    adquirente: linha.adquirente || null,
    bandeira: linha.bandeira || null,
    codigo_transacao: linha.codigo_transacao || null,
    mensagem_resposta:
      'RECONCILIACAO_ADMINISTRATIVA INEXISTENT/nao_realizada (TEF-DESTAXA-51.27) — sem NSU/autorização; sem FINALIZE DLL.',
    codigo_resposta: null,
    preservaPayloadRetorno: true,
    preservaComprovantes: true,
    reconciliadoEm
  };

  const log = {
    transacaoId: OPERACAO_AUTORIZADA_51_27.id,
    tipo: TIPO_LOG,
    mensagem:
      'Reconciliação administrativa INEXISTENT (não realizada na adquirente) — TEF-DESTAXA-51.27',
    payload: auditoria
  };

  if (typeof persistir !== 'function') {
    throw criarErro(
      'TEF_RECONC_INEXISTENTE_PERSISTIR_AUSENTE',
      'Callback persistir é obrigatório.'
    );
  }

  const resultadoPersistencia = persistir({ update, log, auditoria });

  return {
    ok: true,
    idempotente: false,
    alterado: true,
    transacaoId: OPERACAO_AUTORIZADA_51_27.id,
    statusAnterior: estadoAnterior,
    statusPosterior: STATUS_ADMINISTRATIVO,
    financialState: FINANCIAL_STATE_ALVO,
    nsu: null,
    autorizacao: null,
    venda_id: null,
    auditoria,
    persistencia: resultadoPersistencia || null,
    mensagem: 'Reconciliação administrativa INEXISTENT aplicada.'
  };
}

/**
 * Persistência síncrona via DatabaseSync (node:sqlite) — uso administrativo/local.
 * Não toca payload_retorno criptografado (preserva histórico).
 */
function persistirInexistenteSqliteSync(db, { update, log }) {
  if (!db || typeof db.prepare !== 'function') {
    throw criarErro('TEF_RECONC_INEXISTENTE_DB_INVALIDO', 'Conexão SQLite inválida.');
  }

  const tx = db.prepare('BEGIN IMMEDIATE');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');

  tx.run();
  try {
    const stmt = db.prepare(`
      UPDATE tef_transacoes
      SET
        status = ?,
        nsu = NULL,
        autorizacao = NULL,
        venda_id = NULL,
        mensagem_resposta = ?,
        atualizado_em = datetime('now')
      WHERE id = ?
        AND status = ?
        AND idempotency_key = ?
        AND nsu IS NULL
        AND autorizacao IS NULL
        AND venda_id IS NULL
    `);
    const info = stmt.run(
      update.status,
      update.mensagem_resposta,
      update.id,
      update.statusEsperado,
      OPERACAO_AUTORIZADA_51_27.idempotency_key
    );
    if (info.changes !== 1) {
      throw criarErro(
        'TEF_RECONC_INEXISTENTE_UPDATE_CONFLITO',
        'UPDATE não afetou exatamente 1 linha (concorrência ou precondição falhou).',
        { changes: info.changes }
      );
    }

    const hashIntegridade = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        transacao_id: log.transacaoId,
        tipo: log.tipo,
        mensagem: log.mensagem,
        payload: log.payload,
        timestamp: Date.now()
      }))
      .digest('hex');

    db.prepare(`
      INSERT INTO tef_logs (
        transacao_id, tipo, mensagem, payload, hash_integridade, criado_em
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      log.transacaoId,
      log.tipo,
      log.mensagem,
      JSON.stringify(log.payload || {}),
      hashIntegridade
    );

    commit.run();
    return { changes: info.changes, logTipo: log.tipo };
  } catch (error) {
    try { rollback.run(); } catch (_) { /* ignore */ }
    throw error;
  }
}

/**
 * Simula exclusividade de criarTransacaoExclusiva após transição.
 * UNKNOWN/pendente continua bloqueando; nao_realizada não bloqueia.
 */
function simularExclusividadeAposStatus(statusesExistentes) {
  const bloqueadores = (statusesExistentes || []).filter(contaComoPendenciaBloqueadora);
  return {
    bloqueada: bloqueadores.length > 0,
    pendentesAtivos: bloqueadores.length,
    idsBloqueadores: bloqueadores
  };
}

module.exports = {
  OPERACAO_AUTORIZADA_51_27,
  STATUS_ADMINISTRATIVO,
  FINANCIAL_STATE_ALVO,
  TIPO_LOG,
  REFERENCIA_DESTAXA_ESPERADA,
  REFERENCIA_LOG_HISTORICO_ESPERADA,
  ePendenciaOperacionalAtiva,
  eTerminalAdministrativoInexistente,
  contaComoPendenciaBloqueadora,
  validarPedidoReconciliacaoInexistente,
  reconciliarAdministrativamenteInexistente,
  persistirInexistenteSqliteSync,
  simularExclusividadeAposStatus,
  montarPayloadAuditoria
};
