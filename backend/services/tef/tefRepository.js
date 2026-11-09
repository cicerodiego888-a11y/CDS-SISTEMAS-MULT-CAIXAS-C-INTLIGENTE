const db = require('../../database');
const cryptoService = require('../crypto/cryptoService');
const { gravarAuditoria } = require('../auditoria');

function criptografarDadosTransacao(dados) {
  return {
    comprovanteClienteCriptografado: dados.comprovante_cliente
      ? cryptoService.criptografar(dados.comprovante_cliente)
      : null,
    comprovanteEstabelecimentoCriptografado: dados.comprovante_estabelecimento
      ? cryptoService.criptografar(dados.comprovante_estabelecimento)
      : null,
    payloadRetornoCriptografado: dados.payload_retorno
      ? cryptoService.criptografarObjeto(dados.payload_retorno)
      : null
  };
}

function criarTransacao(dados, callback) {
  let camposCriptografados;
  try {
    camposCriptografados = criptografarDadosTransacao(dados);
  } catch (error) {
    return callback(error, null);
  }

  db.run(`
    INSERT INTO tef_transacoes (
      venda_id,
      tipo,
      valor,
      parcelas,
      status,
      provedor,
      adquirente,
      bandeira,
      nsu,
      autorizacao,
      codigo_transacao,
      idempotency_key,
      comprovante_cliente,
      comprovante_estabelecimento,
      payload_retorno,
      criado_em,
      atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [
    dados.venda_id || null,
    dados.tipo,
    dados.valor,
    dados.parcelas || 1,
    dados.status || 'pendente',
    dados.provedor || 'SITEF',
    dados.adquirente || null,
    dados.bandeira || null,
    dados.nsu || null,
    dados.autorizacao || null,
    dados.codigo_transacao || null,
    dados.idempotency_key || null,
    camposCriptografados.comprovanteClienteCriptografado,
    camposCriptografados.comprovanteEstabelecimentoCriptografado,
    camposCriptografados.payloadRetornoCriptografado
  ], function (err) {
    callback(err, this ? this.lastID : null);
  });
}

/**
 * Cria a linha somente se não houver nenhuma transação TEF `pendente`
 * (operação sem desfecho seguro). A verificação e o INSERT são um único
 * comando SQLite: atômico também entre processos. callback(err, id|null).
 */
function criarTransacaoExclusiva(dados, callback) {
  let payloadRetornoCriptografado;
  try {
    payloadRetornoCriptografado = dados.payload_retorno
      ? cryptoService.criptografarObjeto(dados.payload_retorno)
      : null;
  } catch (error) {
    return callback(error, null);
  }

  db.run(`
    INSERT INTO tef_transacoes (
      venda_id,
      tipo,
      valor,
      parcelas,
      status,
      provedor,
      idempotency_key,
      codigo_transacao,
      payload_retorno,
      criado_em,
      atualizado_em
    )
    SELECT ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, datetime('now'), datetime('now')
    WHERE NOT EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')
  `, [
    dados.venda_id || null,
    dados.tipo,
    dados.valor,
    dados.parcelas || 1,
    dados.provedor || 'SITEF',
    dados.idempotency_key || null,
    dados.codigo_transacao || dados.operation_id || null,
    payloadRetornoCriptografado
  ], function (err) {
    if (err) return callback(err, null);
    callback(null, this && this.changes > 0 ? this.lastID : null);
  });
}

/** Transações TEF sem desfecho seguro (status `pendente`), mais antigas primeiro. */
function listarTransacoesPendentes(callback) {
  if (typeof db.whenReady === 'function') {
    return db.whenReady((erro) => (erro ? callback(erro, []) : consultarPendentes(callback)));
  }
  return consultarPendentes(callback);
}

function listarTransacoesFinalizadas(callback) {
  const consultar = () => db.all(`
    SELECT id, status, provedor, tipo, valor, venda_id, idempotency_key,
           codigo_transacao, payload_retorno, criado_em, atualizado_em
    FROM tef_transacoes
    WHERE status IN ('aprovado', 'negado', 'cancelado')
    ORDER BY id ASC
  `, [], (err, rows) => {
    if (err) return callback(err, []);
    decodificarPayloadsTransacao(rows || [], callback);
  });
  if (typeof db.whenReady === 'function') {
    return db.whenReady((erro) => (erro ? callback(erro, []) : consultar()));
  }
  return consultar();
}

function listarIdsTransacoesComTentativaReconciliacao(callback) {
  const consultar = () => db.all(`
    SELECT DISTINCT transacao_id
    FROM tef_logs
    WHERE tipo = 'RECONCILIACAO_RESULTADO_TARDIO'
      AND transacao_id IS NOT NULL
    ORDER BY transacao_id ASC
  `, [], (err, rows) => {
    if (err) return callback(err, []);
    callback(null, (rows || []).map((row) => String(row.transacao_id)));
  });
  if (typeof db.whenReady === 'function') {
    return db.whenReady((erro) => (erro ? callback(erro, []) : consultar()));
  }
  return consultar();
}

function listarEvidenciasReconciliacao(callback) {
  const consultar = () => db.all(`
    SELECT id, transacao_id, tipo, payload, criado_em
    FROM tef_logs
    WHERE tipo IN ('TEF_RECONCILIACAO_LIBERADA', 'TEF_RECONCILIACAO_COMMIT_CONFIRMADO')
    ORDER BY id ASC
  `, [], (err, rows) => {
    if (err) return callback(err, []);
    callback(null, rows || []);
  });
  if (typeof db.whenReady === 'function') {
    return db.whenReady((erro) => (erro ? callback(erro, []) : consultar()));
  }
  return consultar();
}

function consultarPendentes(callback) {
  db.all(`
    SELECT id, status, provedor, tipo, valor, venda_id, idempotency_key,
           codigo_transacao, payload_retorno, criado_em, atualizado_em
    FROM tef_transacoes
    WHERE status = 'pendente'
    ORDER BY id ASC
  `, [], (err, rows) => {
    if (err) return callback(err, []);
    decodificarPayloadsTransacao(rows || [], callback);
  });
}

function decodificarPayloadsTransacao(rows, callback) {
  const recuperadas = [];
  for (const row of rows) {
    let payload = null;
    try {
      payload = row.payload_retorno ? cryptoService.descriptografarObjeto(row.payload_retorno) : null;
    } catch (error) {
      return callback(error, []);
    }
    recuperadas.push({ ...row, payload_retorno: payload });
  }
  callback(null, recuperadas);
}

function obterTransacaoPorId(id, callback) {
  db.get(`
    SELECT id, status, provedor, tipo, valor, venda_id, idempotency_key,
           codigo_transacao, adquirente, bandeira, nsu, autorizacao,
           comprovante_cliente, comprovante_estabelecimento, payload_retorno,
           criado_em, atualizado_em
    FROM tef_transacoes
    WHERE id = ?
  `, [id], (err, row) => {
    if (err || !row) return callback(err, row || null);
    try {
      callback(null, {
        ...row,
        payload_retorno_criptografado: row.payload_retorno,
        payload_retorno: row.payload_retorno
          ? cryptoService.descriptografarObjeto(row.payload_retorno)
          : null
      });
    } catch (error) {
      callback(error);
    }
  });
}

function atualizarTransacao(id, dados, callback, condicoes = {}) {
  return atualizarTransacaoNaConexao(db, id, dados, callback, condicoes);
}

function atualizarTransacaoNaConexao(dbExec, id, dados, callback, condicoes = {}) {
  let camposCriptografados;
  try {
    camposCriptografados = criptografarDadosTransacao(dados);
  } catch (error) {
    return callback(error, null);
  }

  const where = ['id = ?'];
  const parametrosWhere = [id];
  if (Object.prototype.hasOwnProperty.call(condicoes, 'statusEsperado')) {
    where.push('status = ?');
    parametrosWhere.push(condicoes.statusEsperado);
  }
  if (Object.prototype.hasOwnProperty.call(condicoes, 'payloadEsperado')) {
    where.push('payload_retorno IS ?');
    parametrosWhere.push(condicoes.payloadEsperado);
  }

  dbExec.run(`
    UPDATE tef_transacoes
    SET
      venda_id = COALESCE(?, venda_id),
      status = ?,
      adquirente = ?,
      bandeira = ?,
      nsu = ?,
      autorizacao = ?,
      codigo_transacao = ?,
      comprovante_cliente = COALESCE(?, comprovante_cliente),
      comprovante_estabelecimento = COALESCE(?, comprovante_estabelecimento),
      payload_retorno = COALESCE(?, payload_retorno),
      atualizado_em = datetime('now')
    WHERE ${where.join(' AND ')}
  `, [
    dados.venda_id || null,
    dados.status,
    dados.adquirente || null,
    dados.bandeira || null,
    dados.nsu || null,
    dados.autorizacao || null,
    dados.codigo_transacao || null,
    camposCriptografados.comprovanteClienteCriptografado,
    camposCriptografados.comprovanteEstabelecimentoCriptografado,
    camposCriptografados.payloadRetornoCriptografado,
    ...parametrosWhere
  ], function (err) {
    if (err) return callback(err);
    if (condicoes.exigirUmaLinha === true && this.changes !== 1) {
      const conflito = new Error(`Atualização TEF concorrente ou registro ausente: ${id}`);
      conflito.code = 'TEF_TRANSACAO_CONCORRENTE';
      return callback(conflito, { changes: this.changes });
    }
    callback.call(this, null, { changes: this.changes });
  });
}

function registrarLog(transacaoId, tipo, mensagem, payload, callback) {
  // Calcular hash de integridade para imutabilidade
  const dadosParaHash = {
    transacao_id: transacaoId,
    tipo,
    mensagem,
    payload,
    timestamp: Date.now()
  };
  const hashIntegridade = cryptoService.gerarHash(JSON.stringify(dadosParaHash));

  db.run(`
    INSERT INTO tef_logs (
      transacao_id,
      tipo,
      mensagem,
      payload,
      hash_integridade,
      criado_em
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [
    transacaoId || null,
    tipo,
    mensagem,
    JSON.stringify(payload || {}),
    hashIntegridade
  ], function onLogPersistido(error) {
    if (typeof callback === 'function') callback(error || null, this ? this.lastID : null);
  });
}

module.exports = {
  criarTransacao,
  criarTransacaoExclusiva,
  listarTransacoesPendentes,
  listarTransacoesFinalizadas,
  listarIdsTransacoesComTentativaReconciliacao,
  listarEvidenciasReconciliacao,
  obterTransacaoPorId,
  atualizarTransacao,
  atualizarTransacaoNaConexao,
  registrarLog,
  registrarAcesso
};

function registrarAcesso(transacaoId, dadosAcesso) {
  const {
    usuario_id,
    usuario_nome,
    tipo_acesso,
    ip_address,
    user_agent,
    dados_acesso
  } = dadosAcesso;

  db.run(`
    INSERT INTO tef_auditoria_acesso (
      transacao_id,
      usuario_id,
      usuario_nome,
      tipo_acesso,
      ip_address,
      user_agent,
      dados_acesso,
      criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    transacaoId,
    usuario_id || null,
    usuario_nome || null,
    tipo_acesso,
    ip_address || null,
    user_agent || null,
    JSON.stringify(dados_acesso || {})
  ], (err) => {
    if (err) {
      console.error('Erro ao registrar acesso TEF:', err);
    }
  });

  gravarAuditoria({
    usuario_id: usuario_id || null,
    usuario_nome: usuario_nome || null,
    modulo: 'tef',
    acao: 'acesso_dados_sensiveis',
    referencia_tipo: 'tef_transacao',
    referencia_id: transacaoId,
    detalhes: {
      tipo_acesso,
      user_agent: user_agent || null,
      dados_acesso: dados_acesso || {}
    },
    ip_requisicao: ip_address || null
  }).catch((auditErr) => console.error('Erro ao gravar auditoria de acesso TEF:', auditErr));
}