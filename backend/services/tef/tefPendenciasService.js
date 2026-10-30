'use strict';

/**
 * TEF-14 — Consulta e reconciliação segura de pendências/órfãs.
 * Nunca aprova automaticamente. Timeout ≠ cancelamento.
 * Bloqueio global de nova autorização permanece enquanto houver pendente (provider/instalação).
 */

const tefManager = require('./TefManager');
const repository = require('./tefRepository');
const { FINANCIAL_STATES } = require('./tefFinancialSafetyPolicy');

const ESTADOS_OPERACIONAIS = Object.freeze({
  AGUARDANDO_RESULTADO_TARDIO: 'AGUARDANDO_RESULTADO_TARDIO',
  RECONCILIACAO_PENDENTE: 'RECONCILIACAO_PENDENTE',
  PENDENTE_SEM_TRAVA_MEMORIA: 'PENDENTE_SEM_TRAVA_MEMORIA',
  ORFA_SEM_VENDA: 'ORFA_SEM_VENDA',
  TIMEOUT_DESCONHECIDO: 'TIMEOUT_DESCONHECIDO'
});

const ESTADOS_FINANCEIROS_RECONCILIACAO = Object.freeze({
  CONFIRMED_SUCCESS: FINANCIAL_STATES.CONFIRMED_SUCCESS,
  CONFIRMED_DENIED: FINANCIAL_STATES.CONFIRMED_DENIED,
  CANCELLED: 'CANCELLED'
});

const POLITICA_BLOQUEIO = Object.freeze({
  escopo: 'instalacao_global',
  motivo: 'Uma linha tef_transacoes.status=pendente bloqueia nova autorização (criarTransacaoExclusiva + trava em memória).',
  multiPdv: false,
  nota: 'Não liberar outro pagamento para contornar pendência. Destaxa/instalação CDS é singleton.'
});

function criarErro(codigo, mensagem) {
  const error = new Error(mensagem);
  error.code = codigo;
  return error;
}

function classificarPendencia(row, trava) {
  const tags = [];
  const vendaId = row.venda_id;
  const semVenda = vendaId == null || vendaId === '';
  if (semVenda) tags.push(ESTADOS_OPERACIONAIS.ORFA_SEM_VENDA);

  const payload = row.payload_retorno && typeof row.payload_retorno === 'object'
    ? row.payload_retorno
    : {};
  const resultadoTardio = payload.resultadoTardio || (trava && trava.resultadoTardio) || null;
  const codigo = String(
    (trava && trava.codigo)
    || resultadoTardio?.codigo
    || row.codigo_transacao
    || ''
  ).toUpperCase();

  if (codigo === 'TIMEOUT' || codigo === 'TEF_UNKNOWN' || resultadoTardio) {
    tags.push(ESTADOS_OPERACIONAIS.TIMEOUT_DESCONHECIDO);
  }

  let estadoOperacional = ESTADOS_OPERACIONAIS.PENDENTE_SEM_TRAVA_MEMORIA;
  if (trava?.estado === 'AGUARDANDO_RESULTADO_TARDIO') {
    estadoOperacional = ESTADOS_OPERACIONAIS.AGUARDANDO_RESULTADO_TARDIO;
  } else if (trava?.estado === 'RECONCILIACAO_PENDENTE') {
    estadoOperacional = ESTADOS_OPERACIONAIS.RECONCILIACAO_PENDENTE;
  }

  const podeReconciliarExplicitamente = estadoOperacional === ESTADOS_OPERACIONAIS.RECONCILIACAO_PENDENTE;
  const bloqueiaNovasAutorizacoes = true;

  return {
    id: row.id,
    venda_id: vendaId == null ? null : vendaId,
    tipo: row.tipo || null,
    valor: row.valor != null ? Number(row.valor) : null,
    status: row.status,
    provedor: row.provedor || null,
    idempotency_key: row.idempotency_key || null,
    criado_em: row.criado_em || null,
    atualizado_em: row.atualizado_em || null,
    estadoOperacional,
    tags,
    orfaSemVenda: semVenda,
    podeReconciliarExplicitamente,
    bloqueiaNovasAutorizacoes,
    liberacaoAutomaticaProibida: true,
    timeoutNaoECancelamento: true,
    trava: trava
      ? {
        estado: trava.estado,
        financialState: trava.financialState || null,
        codigo: trava.codigo || null,
        resultadoTardio: trava.resultadoTardio || null
      }
      : null,
    resultadoTardio
  };
}

function listarPendenciasDoBanco(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, venda_id, tipo, valor, status, provedor, idempotency_key,
              codigo_transacao, payload_retorno, criado_em, atualizado_em
       FROM tef_transacoes
       WHERE status = 'pendente'
       ORDER BY id ASC`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

function descriptografarPayloadSeNecessario(row, cryptoService) {
  if (!row || row.payload_retorno == null) return row;
  if (typeof row.payload_retorno === 'object') return row;
  if (!cryptoService) return { ...row, payload_retorno: null };
  try {
    return {
      ...row,
      payload_retorno: cryptoService.descriptografarObjeto(row.payload_retorno)
    };
  } catch (_) {
    return { ...row, payload_retorno: null };
  }
}

/**
 * Lista operacional: banco (fonte da verdade) + trava em memória.
 */
async function listarPendenciasOperacionais(opcoes = {}) {
  const manager = opcoes.tefManager || tefManager;
  const db = opcoes.db || require('../../database');
  const cryptoService = opcoes.cryptoService || require('../crypto/cryptoService');

  if (typeof manager.garantirRecuperacao === 'function') {
    try {
      await manager.garantirRecuperacao();
    } catch (_) {
      // listagem continua; bloqueio de nova auth já trata falha de recuperação
    }
  }

  let rows = [];
  if (typeof opcoes.linhasPendentes === 'function') {
    rows = await opcoes.linhasPendentes();
  } else if (opcoes.linhasPendentes) {
    rows = opcoes.linhasPendentes;
  } else {
    rows = await listarPendenciasDoBanco(db);
  }

  const travaAtual = typeof manager.obterTravaResultadoTardio === 'function'
    ? manager.obterTravaResultadoTardio()
    : null;
  const mapaTrava = new Map();
  const travas = typeof manager.listarTravasPendencias === 'function'
    ? manager.listarTravasPendencias()
    : [];
  for (const trava of travas) {
    mapaTrava.set(String(trava.transacaoId), trava);
  }

  const itens = rows.map((rowBruto) => {
    const row = descriptografarPayloadSeNecessario(rowBruto, cryptoService);
    const trava = mapaTrava.get(String(row.id)) || null;
    return classificarPendencia(row, trava);
  });

  return {
    sucesso: true,
    quantidade: itens.length,
    bloqueioGlobalAtivo: itens.length > 0,
    politicaBloqueio: POLITICA_BLOQUEIO,
    travaResumo: travaAtual
      ? {
        transacaoId: travaAtual.transacaoId,
        estado: travaAtual.estado,
        pendentes: travaAtual.pendentes || []
      }
      : null,
    pendencias: itens,
    regras: {
      nuncaAprovarAutomaticamente: true,
      timeoutNaoECancelamento: true,
      naoAssociarPorValorOuOrdem: true,
      reconciliacaoExigeConfirmacaoExplicita: true,
      estadosFinanceirosPermitidos: Object.keys(ESTADOS_FINANCEIROS_RECONCILIACAO)
    }
  };
}

/**
 * Recusa explícita a qualquer tentativa de liberar operação ainda inconclusiva
 * sem desfecho financeiro confirmado pelo operador.
 */
function tentarLiberarInconclusiva() {
  return {
    sucesso: false,
    liberada: false,
    codigo: 'TEF_LIBERACAO_INCONCLUSIVA_PROIBIDA',
    mensagem: 'Operação financeira inconclusiva não pode ser liberada nem descartada. Use reconciliação explícita após desfecho conhecido.'
  };
}

/**
 * Reconciliação explícita de uma pendência (nunca em lote silencioso).
 */
function reconciliarExplicita(opcoes = {}) {
  const manager = opcoes.tefManager || tefManager;
  const {
    transacaoId,
    financialState,
    usuario,
    observacao,
    confirmacao_explicita: confirmacaoExplicita
  } = opcoes;

  if (confirmacaoExplicita !== true) {
    throw criarErro(
      'TEF_RECONCILIACAO_SEM_CONFIRMACAO',
      'Reconciliação exige confirmacao_explicita=true'
    );
  }
  if (!ESTADOS_FINANCEIROS_RECONCILIACAO[financialState]
    && !Object.values(ESTADOS_FINANCEIROS_RECONCILIACAO).includes(financialState)) {
    throw criarErro(
      'TEF_RECONCILIACAO_INVALIDA',
      `Estado financeiro inválido: ${financialState}`
    );
  }

  const resultado = manager.reconciliarResultadoTardio(transacaoId, {
    financialState,
    usuario,
    observacao
  });

  const repo = opcoes.repository || repository;
  let historicoRegistrado = false;
  if (repo && typeof repo.registrarLog === 'function') {
    try {
      repo.registrarLog(
        Number(transacaoId),
        'TEF14_RECONCILIACAO_EXPLICITA',
        `Operador confirmou reconciliação como ${financialState}`,
        {
          financialState,
          usuario: String(usuario || ''),
          observacao: String(observacao || ''),
          travaLiberada: resultado.travaLiberada === true,
          confirmacao_explicita: true
        }
      );
      historicoRegistrado = true;
    } catch (_) {
      historicoRegistrado = false;
    }
  }

  return {
    sucesso: true,
    ...resultado,
    historicoRegistrado
  };
}

/**
 * Substitui o lote inseguro: não atualiza status por consulta automática.
 */
function rejeitarReconcilicaoEmLoteAutomatica() {
  return {
    sucesso: false,
    codigo: 'TEF_RECONCILIACAO_LOTE_PROIBIDA',
    mensagem: 'Reconciliação em lote automática é proibida (risco de aprovar/descartar inconclusivas). Use POST /api/tef/transacao/:id/reconciliar com confirmacao_explicita.',
    reconciliadas: 0
  };
}

module.exports = {
  ESTADOS_OPERACIONAIS,
  ESTADOS_FINANCEIROS_RECONCILIACAO,
  POLITICA_BLOQUEIO,
  classificarPendencia,
  listarPendenciasOperacionais,
  tentarLiberarInconclusiva,
  reconciliarExplicita,
  rejeitarReconcilicaoEmLoteAutomatica
};
