'use strict';

/**
 * MRT-39 — Persistência durável da continuidade Destaxa (99/OPCAO).
 *
 * Reutiliza tef_transacoes.payload_retorno.continuidade (padrão CDS existente).
 * Não cria tabela paralela. Não chama DLL / NativeHost / V$Pague.
 *
 * Anti-duplicata sobrevive a reinício de processo (fonte: SQLite teste/prod conforme DB_DIR).
 */

const db = require('../../../database');
const cryptoService = require('../../crypto/cryptoService');
const repository = require('../tefRepository');
const {
  ERROS_CONTINUIDADE,
  normalizarAcaoContinuidade,
  limparRegistrosContinuidade
} = require('./destaxaContinuidadeContrato');

const PREFIXO_TESTE_MRT39 = 'mrt39_';
const PREFIXO_TESTE_MRT40 = 'mrt40_';

function prefixoTesteContinuidadeValido(idempotencyKey) {
  const key = String(idempotencyKey || '');
  return key.startsWith(PREFIXO_TESTE_MRT39) || key.startsWith(PREFIXO_TESTE_MRT40);
}

function promisifyCriar(dados) {
  return new Promise((resolve, reject) => {
    repository.criarTransacao(dados, (err, id) => (err ? reject(err) : resolve(id)));
  });
}

function promisifyAtualizar(id, dados) {
  return new Promise((resolve, reject) => {
    repository.atualizarTransacao(id, dados, (err) => (err ? reject(err) : resolve()));
  });
}

function getRow(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function fingerprintResposta(resposta) {
  if (resposta == null) return '';
  if (typeof resposta === 'string' || typeof resposta === 'number') {
    return `informacao=${String(resposta).trim()}`;
  }
  if (typeof resposta === 'object') {
    if (resposta.informacao != null) return `informacao=${String(resposta.informacao).trim()}`;
    if (resposta.displayAck === true) return 'displayAck';
  }
  return String(resposta);
}

function lerPayload(row) {
  if (!row || row.payload_retorno == null || row.payload_retorno === '') return {};
  try {
    if (typeof row.payload_retorno === 'object') return { ...row.payload_retorno };
    return cryptoService.descriptografarObjeto(row.payload_retorno) || {};
  } catch (_) {
    try {
      return JSON.parse(row.payload_retorno);
    } catch {
      return {};
    }
  }
}

async function buscarTransacao(transacaoId) {
  const row = await getRow(
    `SELECT id, status, provedor, tipo, valor, venda_id, idempotency_key,
            codigo_transacao, payload_retorno, criado_em, atualizado_em
     FROM tef_transacoes WHERE id = ?`,
    [transacaoId]
  );
  if (!row) return null;
  return { ...row, payload_retorno: lerPayload(row) };
}

function obterBlocoContinuidade(payload) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const cont = base.continuidade && typeof base.continuidade === 'object'
    ? { ...base.continuidade }
    : {};
  if (!Array.isArray(cont.respostas)) cont.respostas = [];
  if (!cont.solicitacao99) cont.solicitacao99 = null;
  if (!cont.estado) cont.estado = 'INEXISTENTE';
  if (cont.txStartCount == null) cont.txStartCount = 0;
  if (cont.continueCount == null) cont.continueCount = 0;
  return cont;
}

async function gravarContinuidade(transacaoId, status, continuidadePatch, extras = {}) {
  const atual = await buscarTransacao(transacaoId);
  if (!atual) {
    const err = new Error(`Transação ${transacaoId} não encontrada`);
    err.codigo = 'TEF_TRANSACAO_NAO_ENCONTRADA';
    throw err;
  }
  const payload = { ...(atual.payload_retorno || {}) };
  const cont = obterBlocoContinuidade(payload);
  Object.assign(cont, continuidadePatch || {});
  payload.continuidade = cont;
  if (extras.persistencia) payload.persistencia = { ...payload.persistencia, ...extras.persistencia };
  await promisifyAtualizar(transacaoId, {
    status: status || atual.status || 'pendente',
    payload_retorno: payload,
    codigo_transacao: atual.codigo_transacao || extras.operation_id || null
  });
  return buscarTransacao(transacaoId);
}

/**
 * Cria linha pendente Destaxa exclusiva MRT-39 (não usa criarTransacaoExclusiva —
 * evita bloquear por outras pendentes do banco de teste).
 */
async function criarTransacaoContinuidadeTeste({
  idempotencyKey,
  operationId,
  fingerprint,
  valor = 1.0
} = {}) {
  if (!prefixoTesteContinuidadeValido(idempotencyKey)) {
    throw new Error('idempotency_key de teste deve usar prefixo mrt39_ ou mrt40_');
  }
  const sprint = String(idempotencyKey).startsWith(PREFIXO_TESTE_MRT40) ? 'MRT-40' : 'MRT-39';
  const payload = {
    persistencia: {
      operation_id: operationId || null,
      fingerprint: fingerprint || null,
      idempotency_key: idempotencyKey,
      provedor: 'destaxa',
      sprint
    },
    continuidade: {
      estado: 'CRIADA',
      solicitacao99: null,
      respostas: [],
      txStartCount: 0,
      continueCount: 0,
      identidade: {
        idempotency_key: idempotencyKey,
        operation_id: operationId || null,
        fingerprint: fingerprint || null
      }
    }
  };
  const id = await promisifyCriar({
    venda_id: null,
    tipo: 'credito',
    valor,
    parcelas: 1,
    status: 'pendente',
    provedor: 'destaxa',
    idempotency_key: idempotencyKey,
    codigo_transacao: operationId || null,
    payload_retorno: payload
  });
  return buscarTransacao(id);
}

async function registrarSolicitacao99(transacaoId, {
  acao,
  solicitadaEm = new Date().toISOString(),
  codigoDestaxa = '99'
} = {}) {
  const acaoN = normalizarAcaoContinuidade(acao);
  const tx = await buscarTransacao(transacaoId);
  if (!tx) {
    return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  }
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  cont.estado = 'AGUARDANDO_RESPOSTA';
  cont.solicitacao99 = {
    codigoDestaxa,
    solicitadaEm,
    acao: acaoN,
    opcoes: acaoN.opcoes || [],
    chave: acaoN.chave || null,
    timeout: acaoN.timeout || null,
    mensagem: acaoN.mensagem || null
  };
  // TX_START já ocorreu antes do 99 no fluxo real; em teste marcamos 1 se ainda 0
  if (!cont.txStartCount) cont.txStartCount = 1;
  await gravarContinuidade(transacaoId, 'pendente', cont);
  repository.registrarLog(transacaoId, 'MRT39_SOLICITACAO_99', 'Solicitação 99/OPCAO persistida', {
    chave: acaoN.chave,
    opcoes: acaoN.opcoes,
    timeout: acaoN.timeout
  });
  return { ok: true, continuidade: cont, transacaoId: String(transacaoId) };
}

async function recuperarSolicitacao99(transacaoId) {
  const tx = await buscarTransacao(transacaoId);
  if (!tx) return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  if (!cont.solicitacao99) {
    return { ok: false, codigo: 'DESTAXA_CONTINUIDADE_SEM_SOLICITACAO', continuidade: cont };
  }
  return {
    ok: true,
    solicitacao99: cont.solicitacao99,
    estado: cont.estado,
    identidade: cont.identidade || tx.payload_retorno?.persistencia || null,
    idempotency_key: tx.idempotency_key,
    txStartCount: cont.txStartCount,
    continueCount: cont.continueCount,
    respostas: cont.respostas
  };
}

async function verificarRespostaDuplicadaPersistente(transacaoId, resposta) {
  const fp = fingerprintResposta(resposta);
  const tx = await buscarTransacao(transacaoId);
  if (!tx) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_AUSENTE,
      mensagem: 'Transação ausente para anti-duplicata persistente'
    };
  }
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  const existe = (cont.respostas || []).some((r) => r.fingerprint === fp);
  if (existe) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
      mensagem: 'Resposta já persistida para esta solicitação — reenvio bloqueado após reinício',
      retryAllowed: false,
      fingerprint: fp
    };
  }
  return { ok: true, fingerprint: fp };
}

async function registrarRespostaOperador(transacaoId, {
  resposta,
  incrementarContinue = true
} = {}) {
  const dup = await verificarRespostaDuplicadaPersistente(transacaoId, resposta);
  if (!dup.ok) return dup;

  const tx = await buscarTransacao(transacaoId);
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  if (cont.estado === 'TIMEOUT') {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.TIMEOUT,
      mensagem: 'Continuidade já marcada TIMEOUT — resposta recusada',
      financialStateHint: 'UNKNOWN',
      retryAllowed: false,
      reconciliacaoObrigatoria: true
    };
  }
  const informacao = typeof resposta === 'object' && resposta != null
    ? (resposta.informacao != null ? String(resposta.informacao) : null)
    : String(resposta);
  cont.respostas.push({
    fingerprint: dup.fingerprint,
    informacao,
    registradaEm: new Date().toISOString()
  });
  cont.estado = 'RESPONDIDA';
  if (incrementarContinue) cont.continueCount = Number(cont.continueCount || 0) + 1;
  // Continuidade ≠ novo TX_START
  cont.ultimoEvento = 'RESPOSTA_OPERADOR';
  await gravarContinuidade(transacaoId, 'pendente', cont);
  repository.registrarLog(transacaoId, 'MRT39_RESPOSTA_CONTINUIDADE', 'Resposta OPCAO persistida', {
    fingerprint: dup.fingerprint,
    continueCount: cont.continueCount,
    txStartCount: cont.txStartCount
  });
  return {
    ok: true,
    fingerprint: dup.fingerprint,
    entradaContinuaEsperada: informacao != null ? `informacao=${informacao}` : null,
    continuidade: cont,
    txStartCount: cont.txStartCount,
    continueCount: cont.continueCount
  };
}

async function marcarTimeout(transacaoId, motivo = 'timeout coleta') {
  const tx = await buscarTransacao(transacaoId);
  if (!tx) return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  cont.estado = 'TIMEOUT';
  cont.timeoutEm = new Date().toISOString();
  cont.timeoutMotivo = motivo;
  cont.financialStateHint = 'UNKNOWN';
  await gravarContinuidade(transacaoId, 'pendente', cont);
  return { ok: true, continuidade: cont, financialStateHint: 'UNKNOWN', retryAllowed: false };
}

async function marcarPerdaComunicacao(transacaoId) {
  const tx = await buscarTransacao(transacaoId);
  if (!tx) return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  cont.estado = 'PERDA_COMUNICACAO';
  cont.financialStateHint = 'UNKNOWN';
  cont.perdaEm = new Date().toISOString();
  await gravarContinuidade(transacaoId, 'pendente', cont);
  return { ok: true, continuidade: cont, retryAllowed: false, reconciliacaoObrigatoria: true };
}

async function marcarSemOperador(transacaoId) {
  const tx = await buscarTransacao(transacaoId);
  if (!tx) return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  cont.estado = 'SEM_OPERADOR';
  cont.semOperadorEm = new Date().toISOString();
  await gravarContinuidade(transacaoId, 'pendente', cont);
  return { ok: true, continuidade: cont, codigo: ERROS_CONTINUIDADE.SEM_OPERADOR, retryAllowed: false };
}

/**
 * Remove somente linhas de teste de continuidade (prefixo mrt39_/mrt40_ e/ou ids).
 */
async function limparRegistrosTesteMrt39({
  ids = [],
  idempotencyPrefix = PREFIXO_TESTE_MRT39,
  incluirMrt40 = false
} = {}) {
  limparRegistrosContinuidade();
  const prefixos = [idempotencyPrefix];
  if (incluirMrt40 || idempotencyPrefix === PREFIXO_TESTE_MRT40) {
    if (!prefixos.includes(PREFIXO_TESTE_MRT40)) prefixos.push(PREFIXO_TESTE_MRT40);
  }
  const likeClauses = prefixos.map(() => 'idempotency_key LIKE ?').join(' OR ');
  const rows = await allSql(
    `SELECT id FROM tef_transacoes
     WHERE (${likeClauses})
        OR id IN (${(ids.length ? ids : [0]).map(() => '?').join(',')})`,
    [...prefixos.map((p) => `${p}%`), ...(ids.length ? ids : [0])]
  );
  const apagados = [];
  for (const r of rows) {
    await runSql('DELETE FROM tef_logs WHERE transacao_id = ?', [r.id]);
    await runSql('DELETE FROM tef_transacoes WHERE id = ?', [r.id]);
    apagados.push(r.id);
  }
  return { ok: true, apagados };
}

async function limparRegistrosTesteMrt40({ ids = [] } = {}) {
  return limparRegistrosTesteMrt39({ ids, idempotencyPrefix: PREFIXO_TESTE_MRT40 });
}

function caminhoBancoEfetivo() {
  return {
    dbDir: db.dbDir || process.env.DB_DIR || null,
    dbPath: db.dbDir
      ? require('path').join(db.dbDir, 'mercadao.db')
      : null
  };
}

module.exports = {
  PREFIXO_TESTE_MRT39,
  PREFIXO_TESTE_MRT40,
  fingerprintResposta,
  buscarTransacao,
  criarTransacaoContinuidadeTeste,
  registrarSolicitacao99,
  recuperarSolicitacao99,
  verificarRespostaDuplicadaPersistente,
  registrarRespostaOperador,
  marcarTimeout,
  marcarPerdaComunicacao,
  marcarSemOperador,
  limparRegistrosTesteMrt39,
  limparRegistrosTesteMrt40,
  caminhoBancoEfetivo,
  obterBlocoContinuidade
};
