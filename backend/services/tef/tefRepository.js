const db = require('../../database');
const cryptoService = require('../crypto/cryptoService');
const { gravarAuditoria } = require('../auditoria');

function criarTransacao(dados, callback) {
  // Criptografar dados sensíveis antes de salvar
  const comprovanteClienteCriptografado = dados.comprovante_cliente 
    ? cryptoService.criptografar(dados.comprovante_cliente) 
    : null;
  const comprovanteEstabelecimentoCriptografado = dados.comprovante_estabelecimento 
    ? cryptoService.criptografar(dados.comprovante_estabelecimento) 
    : null;
  const payloadRetornoCriptografado = dados.payload_retorno 
    ? cryptoService.criptografarObjeto(dados.payload_retorno) 
    : null;

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
    comprovanteClienteCriptografado,
    comprovanteEstabelecimentoCriptografado,
    payloadRetornoCriptografado
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
  const payloadRetornoCriptografado = dados.payload_retorno
    ? cryptoService.criptografarObjeto(dados.payload_retorno)
    : null;

  db.run(`
    INSERT INTO tef_transacoes (
      venda_id,
      tipo,
      valor,
      parcelas,
      status,
      provedor,
      idempotency_key,
      payload_retorno,
      criado_em,
      atualizado_em
    )
    SELECT ?, ?, ?, ?, 'pendente', ?, ?, ?, datetime('now'), datetime('now')
    WHERE NOT EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')
  `, [
    dados.venda_id || null,
    dados.tipo,
    dados.valor,
    dados.parcelas || 1,
    dados.provedor || 'SITEF',
    dados.idempotency_key || null,
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

function consultarPendentes(callback) {
  db.all(`
    SELECT id, status, provedor, tipo, codigo_transacao, payload_retorno, criado_em, atualizado_em
    FROM tef_transacoes
    WHERE status = 'pendente'
    ORDER BY id ASC
  `, [], (err, rows) => {
    if (err) return callback(err, []);
    callback(null, (rows || []).map((row) => {
      let payload = null;
      try {
        payload = row.payload_retorno ? cryptoService.descriptografarObjeto(row.payload_retorno) : null;
      } catch (_) {
        payload = null;
      }
      return { ...row, payload_retorno: payload };
    }));
  });
}

function atualizarTransacao(id, dados, callback) {
  // Criptografar dados sensíveis antes de atualizar
  const comprovanteClienteCriptografado = dados.comprovante_cliente 
    ? cryptoService.criptografar(dados.comprovante_cliente) 
    : null;
  const comprovanteEstabelecimentoCriptografado = dados.comprovante_estabelecimento 
    ? cryptoService.criptografar(dados.comprovante_estabelecimento) 
    : null;
  const payloadRetornoCriptografado = dados.payload_retorno 
    ? cryptoService.criptografarObjeto(dados.payload_retorno) 
    : null;

  db.run(`
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
    WHERE id = ?
  `, [
    dados.venda_id || null,
    dados.status,
    dados.adquirente || null,
    dados.bandeira || null,
    dados.nsu || null,
    dados.autorizacao || null,
    dados.codigo_transacao || null,
    comprovanteClienteCriptografado,
    comprovanteEstabelecimentoCriptografado,
    payloadRetornoCriptografado,
    id
  ], callback);
}

function registrarLog(transacaoId, tipo, mensagem, payload) {
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
  ]);
}

module.exports = {
  criarTransacao,
  criarTransacaoExclusiva,
  listarTransacoesPendentes,
  atualizarTransacao,
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