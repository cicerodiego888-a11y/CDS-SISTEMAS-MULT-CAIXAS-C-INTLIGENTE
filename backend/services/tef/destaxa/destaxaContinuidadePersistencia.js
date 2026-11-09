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
const crypto = require('crypto');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cryptoService = require('../../crypto/cryptoService');
const repository = require('../tefRepository');
const {
  ERROS_CONTINUIDADE,
  normalizarAcaoContinuidade,
  normalizarTimestampSolicitacao99,
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

function promisifyAtualizar(id, dados, condicoes = {}, conexao = db) {
  return new Promise((resolve, reject) => {
    const callback = (err, resultado) => (err ? reject(err) : resolve(resultado));
    if (conexao === db) {
      repository.atualizarTransacao(id, dados, callback, condicoes);
    } else {
      repository.atualizarTransacaoNaConexao(conexao, id, dados, callback, condicoes);
    }
  });
}

function getRow(sql, params = [], conexao = db) {
  return new Promise((resolve, reject) => {
    conexao.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function runSqlOn(conexao, sql, params = []) {
  return new Promise((resolve, reject) => {
    conexao.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function runSql(sql, params = []) {
  return runSqlOn(db, sql, params);
}

function abrirConexaoReserva() {
  const caminho = path.resolve(db.dbPath || path.join(db.dbDir, 'mercadao.db'));
  return new Promise((resolve, reject) => {
    const conexao = new sqlite3.Database(caminho, sqlite3.OPEN_READWRITE, (openError) => {
      if (openError) return reject(openError);
      conexao.run('PRAGMA busy_timeout=30000', (timeoutError) => {
        if (timeoutError) {
          return conexao.close(() => reject(timeoutError));
        }
        resolve(conexao);
      });
    });
  });
}

function fecharConexao(conexao) {
  return new Promise((resolve, reject) => {
    conexao.close((error) => (error ? reject(error) : resolve()));
  });
}

function erroDeLockSqlite(error) {
  const code = String(error?.code || '').toUpperCase();
  return code === 'SQLITE_BUSY'
    || code === 'SQLITE_LOCKED'
    || /SQLITE_(BUSY|LOCKED)/i.test(String(error?.message || ''));
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
  if (typeof row.payload_retorno === 'object') return { ...row.payload_retorno };
  try {
    const payloadLegado = JSON.parse(row.payload_retorno);
    return payloadLegado && typeof payloadLegado === 'object' ? payloadLegado : {};
  } catch {
    return cryptoService.descriptografarObjeto(row.payload_retorno) || {};
  }
}

function confirmarLeituraIndependente(transacaoId, validar) {
  const caminho = path.resolve(db.dbPath || path.join(db.dbDir, 'mercadao.db'));
  return new Promise((resolve, reject) => {
    const leitor = new sqlite3.Database(caminho, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) return reject(openError);
      leitor.run('PRAGMA busy_timeout=5000', (timeoutError) => {
        if (timeoutError) {
          return leitor.close(() => reject(timeoutError));
        }
        leitor.get(
          'SELECT * FROM tef_transacoes WHERE id = ?',
          [transacaoId],
          (readError, row) => {
            if (readError) {
              return leitor.close(() => reject(readError));
            }
            let resultado;
            try {
              resultado = validar(row || null, lerPayload(row || null));
            } catch (validationError) {
              return leitor.close(() => reject(validationError));
            }
            leitor.close((closeError) => {
              if (closeError) reject(closeError);
              else resolve(resultado === true);
            });
          }
        );
      });
    });
  });
}

async function buscarTransacao(transacaoId, conexao = db) {
  const row = await getRow(
    `SELECT id, status, provedor, tipo, valor, venda_id, idempotency_key,
            codigo_transacao, payload_retorno, criado_em, atualizado_em
     FROM tef_transacoes WHERE id = ?`,
    [transacaoId],
    conexao
  );
  if (!row) return null;
  return {
    ...row,
    _payloadRetornoCriptografado: row.payload_retorno,
    payload_retorno: lerPayload(row)
  };
}

function identidadeTransacao(tx) {
  const persistencia = tx?.payload_retorno?.persistencia || {};
  return {
    transactionId: String(tx?.id ?? ''),
    operation_id: String(persistencia.operation_id || tx?.codigo_transacao || ''),
    idempotency_key: String(tx?.idempotency_key || persistencia.idempotency_key || ''),
    fingerprint: String(persistencia.fingerprint || '')
  };
}

function identidadeCompleta(identidade) {
  return Boolean(
    identidade?.transactionId
    && identidade?.operation_id
    && identidade?.idempotency_key
    && identidade?.fingerprint
  );
}

function identidadesIguais(a, b) {
  return ['transactionId', 'operation_id', 'idempotency_key', 'fingerprint']
    .every((campo) => String(a?.[campo] || '') === String(b?.[campo] || ''));
}

function acoesIguais(a, b) {
  return JSON.stringify(normalizarAcaoContinuidade(a))
    === JSON.stringify(normalizarAcaoContinuidade(b));
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

async function gravarContinuidade(
  transacaoId,
  status,
  continuidadePatch,
  extras = {},
  conexao = db
) {
  const atual = await buscarTransacao(transacaoId, conexao);
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
  const atualizacao = await promisifyAtualizar(transacaoId, {
    status: status || atual.status || 'pendente',
    payload_retorno: payload,
    codigo_transacao: atual.codigo_transacao || extras.operation_id || null
  }, {
    statusEsperado: atual.status,
    payloadEsperado: atual._payloadRetornoCriptografado,
    exigirUmaLinha: true
  }, conexao);
  if (atualizacao?.changes !== 1) {
    const conflito = new Error(`Atualização TEF não alterou exatamente uma linha: ${transacaoId}`);
    conflito.code = 'TEF_TRANSACAO_CONCORRENTE';
    throw conflito;
  }
  return buscarTransacao(transacaoId, conexao);
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
  const timestampOriginal = normalizarTimestampSolicitacao99(solicitadaEm);
  if (!timestampOriginal) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.TIMESTAMP_INVALIDO,
      mensagem: 'Solicitação 99 não persistida: timestamp original ausente ou inválido'
    };
  }
  const tx = await buscarTransacao(transacaoId);
  if (!tx) {
    return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  }
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  const identidade = identidadeTransacao(tx);
  if (!identidadeCompleta(identidade)) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_DIVERGENTE,
      mensagem: 'Solicitação 99 não persistida: identidade completa da transação ausente'
    };
  }
  const solicitacaoAtual = cont.solicitacao99;
  if ((cont.respostas || []).some((registro) =>
    registro.solicitadaEm === timestampOriginal)) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
      mensagem: 'Solicitação 99 já possui resposta persistida; não pode ser reaberta'
    };
  }
  if (solicitacaoAtual
    && cont.estado === 'AGUARDANDO_RESPOSTA'
    && solicitacaoAtual.solicitadaEm === timestampOriginal
    && acoesIguais(solicitacaoAtual.acao, acaoN)
    && identidadesIguais(solicitacaoAtual.identidade, identidade)) {
    return {
      ok: true,
      duravel: true,
      confirmada: true,
      continuidade: cont,
      solicitacao99: solicitacaoAtual,
      identidade
    };
  }
  if (solicitacaoAtual && cont.estado === 'AGUARDANDO_RESPOSTA') {
    return {
      ok: false,
      codigo: 'TEF_CONTINUIDADE_SOLICITACAO_CONFLITANTE',
      mensagem: 'Solicitação 99 ativa divergente; identidade permanece bloqueada'
    };
  }
  cont.estado = 'AGUARDANDO_RESPOSTA';
  cont.solicitacao99 = {
    codigoDestaxa,
    solicitadaEm: timestampOriginal,
    acao: acaoN,
    opcoes: acaoN.opcoes || [],
    chave: acaoN.chave || null,
    timeout: acaoN.timeout || null,
    mensagem: acaoN.mensagem || null,
    identidade
  };
  // TX_START já ocorreu antes do 99 no fluxo real; em teste marcamos 1 se ainda 0
  if (!cont.txStartCount) cont.txStartCount = 1;
  const relida = await gravarContinuidade(transacaoId, 'pendente', cont);
  const confirmada = relida
    && relida.status === 'pendente'
    && relida.payload_retorno?.continuidade?.estado === 'AGUARDANDO_RESPOSTA'
    && relida.payload_retorno?.continuidade?.solicitacao99?.solicitadaEm === timestampOriginal
    && acoesIguais(relida.payload_retorno?.continuidade?.solicitacao99?.acao, acaoN)
    && identidadesIguais(
      relida.payload_retorno?.continuidade?.solicitacao99?.identidade,
      identidade
    );
  if (!confirmada) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: 'Solicitação 99 não foi confirmada após releitura; identidade permanece bloqueada'
    };
  }
  repository.registrarLog(transacaoId, 'MRT39_SOLICITACAO_99', 'Solicitação 99/OPCAO persistida', {
    chave: acaoN.chave,
    opcoes: acaoN.opcoes,
    timeout: acaoN.timeout
  });
  return {
    ok: true,
    duravel: true,
    confirmada: true,
    continuidade: relida.payload_retorno.continuidade,
    solicitacao99: relida.payload_retorno.continuidade.solicitacao99,
    identidade,
    transacaoId: String(transacaoId)
  };
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
    identidade: cont.solicitacao99.identidade || identidadeTransacao(tx),
    idempotency_key: tx.idempotency_key,
    txStartCount: cont.txStartCount,
    continueCount: cont.continueCount,
    respostas: cont.respostas
  };
}

async function recuperarRespostaOperador(transacaoId, {
  solicitadaEm,
  acao,
  identidadeEsperada = null,
  respostaEsperada = null
} = {}, conexao = db) {
  const timestamp = normalizarTimestampSolicitacao99(solicitadaEm);
  if (!timestamp) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.TIMESTAMP_INVALIDO,
      mensagem: 'Timestamp original da resposta ausente ou inválido'
    };
  }
  const tx = await buscarTransacao(transacaoId, conexao);
  if (!tx) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_AUSENTE,
      mensagem: 'Transação ausente ao recuperar resposta de continuidade'
    };
  }
  const cont = obterBlocoContinuidade(tx.payload_retorno);
  const identidade = identidadeTransacao(tx);
  const solicitacao = cont.solicitacao99;
  if (!identidadeCompleta(identidade)
    || !solicitacao
    || normalizarTimestampSolicitacao99(solicitacao.solicitadaEm) !== timestamp
    || !acoesIguais(solicitacao.acao, acao)
    || !identidadesIguais(solicitacao.identidade, identidade)
    || (identidadeEsperada && !identidadesIguais(identidade, identidadeEsperada))) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_DIVERGENTE,
      mensagem: 'Resposta persistida não corresponde à solicitação 99 e à identidade completa'
    };
  }

  const correspondentes = cont.respostas.filter((registro) =>
    registro.solicitadaEm === timestamp);
  if (correspondentes.length !== 1) {
    return {
      ok: false,
      codigo: correspondentes.length === 0
        ? 'DESTAXA_CONTINUIDADE_RESPOSTA_AUSENTE'
        : ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
      mensagem: correspondentes.length === 0
        ? 'Resposta persistida não encontrada para a solicitação 99'
        : 'Mais de uma resposta persistida para a mesma solicitação 99'
    };
  }

  const registro = correspondentes[0];
  if (!registro.resposta
    || registro.fingerprint !== fingerprintResposta(registro.resposta)
    || (respostaEsperada != null
      && registro.fingerprint !== fingerprintResposta(respostaEsperada))
    || !acoesIguais(registro.acao, solicitacao.acao)
    || !identidadesIguais(registro.identidade, identidade)
    || !['PRONTA', 'INICIADO'].includes(registro.estadoDespacho)) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_DIVERGENTE,
      mensagem: 'Resposta persistida inválida, divergente ou sem estado de despacho confiável'
    };
  }

  return {
    ok: true,
    resposta: registro.resposta,
    fingerprint: registro.fingerprint,
    identidade,
    solicitadaEm: timestamp,
    acao: registro.acao,
    estadoDespacho: registro.estadoDespacho,
    despachoId: registro.despachoId || null,
    duravel: true
  };
}

async function reservarDespachoResposta(transacaoId, {
  solicitadaEm,
  acao,
  identidadeEsperada = null,
  respostaEsperada = null
} = {}) {
  let conexao = null;
  let transacaoAberta = false;
  let commitConfirmado = false;
  let erro = null;
  let erroRollback = null;
  let falhaValidacao = null;
  let reserva = null;

  try {
    conexao = await abrirConexaoReserva();
    await runSqlOn(conexao, 'BEGIN IMMEDIATE');
    transacaoAberta = true;

    const recuperada = await recuperarRespostaOperador(transacaoId, {
      solicitadaEm,
      acao,
      identidadeEsperada,
      respostaEsperada
    }, conexao);
    if (!recuperada.ok) {
      falhaValidacao = recuperada;
    } else if (recuperada.estadoDespacho !== 'PRONTA') {
      falhaValidacao = {
        ok: false,
        codigo: ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
        mensagem: 'Resposta já reservada para despacho; replay bloqueado',
        retryAllowed: false
      };
    } else {
      const tx = await buscarTransacao(transacaoId, conexao);
      if (!tx) {
        falhaValidacao = {
          ok: false,
          codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
          mensagem: 'Transação não pode ser relida para reservar o despacho',
          retryAllowed: false
        };
      } else if (String(tx.status || '').toLowerCase() !== 'pendente') {
        falhaValidacao = {
          ok: false,
          codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
          mensagem: 'Transação deixou de estar pendente antes da reserva',
          retryAllowed: false
        };
      } else {
        const cont = obterBlocoContinuidade(tx.payload_retorno);
        const registro = cont.respostas.find((item) =>
          item.solicitadaEm === recuperada.solicitadaEm
          && item.fingerprint === recuperada.fingerprint);
        if (!registro || registro.estadoDespacho !== 'PRONTA') {
          falhaValidacao = {
            ok: false,
            codigo: ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
            mensagem: 'Resposta deixou de estar disponível para despacho',
            retryAllowed: false
          };
        } else {
          const despachoId = crypto.randomBytes(16).toString('hex');
          registro.estadoDespacho = 'INICIADO';
          registro.despachoId = despachoId;
          registro.despachoIniciadoEm = new Date().toISOString();
          const relida = await gravarContinuidade(
            transacaoId,
            tx.status,
            cont,
            {},
            conexao
          );
          const registroRelido = relida?.payload_retorno?.continuidade?.respostas?.find((item) =>
            item.solicitadaEm === recuperada.solicitadaEm
            && item.fingerprint === recuperada.fingerprint);
          if (!registroRelido
            || registroRelido.estadoDespacho !== 'INICIADO'
            || registroRelido.despachoId !== despachoId) {
            const erroPersistencia = new Error('Reserva não foi relida dentro da transação');
            erroPersistencia.code = ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU;
            throw erroPersistencia;
          }
          await runSqlOn(conexao, 'COMMIT');
          commitConfirmado = true;
          transacaoAberta = false;
          reserva = {
            resposta: registroRelido.resposta,
            fingerprint: registroRelido.fingerprint,
            identidade: recuperada.identidade,
            solicitadaEm: recuperada.solicitadaEm,
            despachoId,
            changes: 1
          };
        }
      }
    }
  } catch (errorReserva) {
    erro = errorReserva;
  }

  if (conexao && transacaoAberta && !commitConfirmado) {
    try {
      await runSqlOn(conexao, 'ROLLBACK');
      transacaoAberta = false;
    } catch (error) {
      erroRollback = error;
    }
  }
  if (conexao) {
    try {
      await fecharConexao(conexao);
    } catch (errorFechamento) {
      if (!erro) erro = errorFechamento;
    }
  }

  if (erro || erroRollback) {
    const causa = erroRollback || erro;
    const bloqueioPorConcorrencia = erroDeLockSqlite(causa);
    return {
      ok: false,
      codigo: bloqueioPorConcorrencia
        ? 'DESTAXA_CONTINUIDADE_CONCORRENCIA'
        : ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: bloqueioPorConcorrencia
        ? 'Reserva não obtida por conflito de concorrência SQLite'
        : 'Reserva não confirmada; a transação foi revertida quando possível',
      causaCodigo: causa?.code || null,
      retryAllowed: false,
      financialStateHint: 'UNKNOWN',
      reconciliacaoObrigatoria: true
    };
  }
  if (falhaValidacao) return falhaValidacao;
  if (!commitConfirmado || !reserva) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: 'Reserva não confirmou COMMIT',
      retryAllowed: false,
      financialStateHint: 'UNKNOWN',
      reconciliacaoObrigatoria: true
    };
  }

  let confirmadaIndependente = false;
  try {
    confirmadaIndependente = await confirmarLeituraIndependente(
      transacaoId,
      (linha, payload) => {
        const respostaRelida = payload?.continuidade?.respostas?.find((item) =>
          item.solicitadaEm === reserva.solicitadaEm
          && item.fingerprint === reserva.fingerprint);
        return String(linha?.status || '').toLowerCase() === 'pendente'
          && respostaRelida?.estadoDespacho === 'INICIADO'
          && respostaRelida?.despachoId === reserva.despachoId;
      }
    );
  } catch (errorLeitura) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: 'COMMIT confirmado, mas a releitura independente falhou; identidade permanece bloqueada',
      causaCodigo: errorLeitura?.code || null,
      retryAllowed: false,
      financialStateHint: 'UNKNOWN',
      reconciliacaoObrigatoria: true
    };
  }
  if (!confirmadaIndependente) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: 'Reserva commitada não foi confirmada por releitura independente',
      retryAllowed: false,
      financialStateHint: 'UNKNOWN',
      reconciliacaoObrigatoria: true
    };
  }
  return {
    ok: true,
    duravel: true,
    confirmada: true,
    resposta: reserva.resposta,
    fingerprint: reserva.fingerprint,
    identidade: reserva.identidade,
    solicitadaEm: reserva.solicitadaEm,
    despachoId: reserva.despachoId,
    changes: reserva.changes
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
  incrementarContinue = true,
  exigirSolicitacao = false,
  acao = null,
  solicitadaEm = null,
  identidadeEsperada = null
} = {}) {
  const tx = await buscarTransacao(transacaoId);
  if (!tx) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_AUSENTE,
      mensagem: 'Transação ausente para persistir resposta de continuidade'
    };
  }
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
  const identidade = identidadeTransacao(tx);
  const solicitacao = cont.solicitacao99;
  const timestampOriginal = normalizarTimestampSolicitacao99(solicitadaEm);
  let fingerprint;
  if (exigirSolicitacao) {
    if (!solicitacao
      || cont.estado !== 'AGUARDANDO_RESPOSTA'
      || !timestampOriginal
      || solicitacao.solicitadaEm !== timestampOriginal
      || !acoesIguais(solicitacao.acao, acao)
      || !identidadeCompleta(identidade)
      || !identidadesIguais(solicitacao.identidade, identidade)
      || (identidadeEsperada && !identidadesIguais(identidade, identidadeEsperada))) {
      return {
        ok: false,
        codigo: ERROS_CONTINUIDADE.IDENTIDADE_DIVERGENTE,
        mensagem: 'Resposta recusada: solicitação 99, timestamp ou identidade não corresponde ao registro persistido'
      };
    }
    if ((cont.respostas || []).some((registro) =>
      registro.solicitadaEm === timestampOriginal)) {
      return {
        ok: false,
        codigo: ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
        mensagem: 'Resposta já registrada para esta solicitação 99; reenvio bloqueado',
        retryAllowed: false
      };
    }
    fingerprint = fingerprintResposta(resposta);
  } else {
    const dup = await verificarRespostaDuplicadaPersistente(transacaoId, resposta);
    if (!dup.ok) return dup;
    fingerprint = dup.fingerprint;
  }
  const informacao = typeof resposta === 'object' && resposta != null
    ? (resposta.informacao != null ? String(resposta.informacao) : null)
    : String(resposta);
  cont.respostas.push({
    fingerprint,
    informacao,
    resposta: typeof resposta === 'object' && resposta != null
      ? { ...resposta }
      : { informacao },
    acao: exigirSolicitacao ? solicitacao.acao : null,
    solicitadaEm: exigirSolicitacao ? timestampOriginal : null,
    identidade: exigirSolicitacao ? identidade : null,
    estadoDespacho: exigirSolicitacao ? 'PRONTA' : null,
    registradaEm: new Date().toISOString()
  });
  cont.estado = 'RESPONDIDA';
  if (incrementarContinue) cont.continueCount = Number(cont.continueCount || 0) + 1;
  // Continuidade ≠ novo TX_START
  cont.ultimoEvento = 'RESPOSTA_OPERADOR';
  const relida = await gravarContinuidade(transacaoId, 'pendente', cont);
  const confirmada = relida
    && relida.status === 'pendente'
    && relida.payload_retorno?.continuidade?.estado === 'RESPONDIDA'
    && relida.payload_retorno?.continuidade?.respostas?.some((registro) =>
      registro.fingerprint === fingerprint
      && registro.solicitadaEm === (exigirSolicitacao ? timestampOriginal : null)
      && (!exigirSolicitacao || identidadesIguais(registro.identidade, identidade)));
  if (!confirmada) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: 'Resposta não confirmada após releitura; TX_CONTINUE bloqueado'
    };
  }
  const confirmadaIndependente = await confirmarLeituraIndependente(
    transacaoId,
    (linha, payload) => {
      const respostaRelida = payload?.continuidade?.respostas?.find((registro) =>
        registro.fingerprint === fingerprint
        && registro.solicitadaEm === (exigirSolicitacao ? timestampOriginal : null));
      return String(linha?.status || '').toLowerCase() === 'pendente'
        && respostaRelida?.estadoDespacho === (exigirSolicitacao ? 'PRONTA' : null)
        && (!exigirSolicitacao || identidadesIguais(respostaRelida.identidade, identidade));
    }
  );
  if (!confirmadaIndependente) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.PERSISTENCIA_FALHOU,
      mensagem: 'Resposta não está visível por conexão independente; TX_CONTINUE bloqueado'
    };
  }
  repository.registrarLog(transacaoId, 'MRT39_RESPOSTA_CONTINUIDADE', 'Resposta OPCAO persistida', {
    fingerprint,
    continueCount: cont.continueCount,
    txStartCount: cont.txStartCount
  });
  return {
    ok: true,
    duravel: true,
    confirmada: true,
    fingerprint,
    entradaContinuaEsperada: informacao != null ? `informacao=${informacao}` : null,
    continuidade: relida.payload_retorno.continuidade,
    txStartCount: cont.txStartCount,
    continueCount: cont.continueCount,
    identidade,
    solicitadaEm: exigirSolicitacao ? timestampOriginal : null,
    estadoDespacho: exigirSolicitacao ? 'PRONTA' : null
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
  recuperarRespostaOperador,
  reservarDespachoResposta,
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
