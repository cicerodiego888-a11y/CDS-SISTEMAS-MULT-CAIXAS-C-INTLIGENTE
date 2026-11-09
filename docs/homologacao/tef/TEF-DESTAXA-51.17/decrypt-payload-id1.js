'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const db = new DatabaseSync('C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db', { readOnly: true });
const row = db.prepare(
  `SELECT payload_retorno, nsu, autorizacao, codigo_resposta, mensagem_resposta,
          comprovante_cliente, comprovante_estabelecimento, adquirente, bandeira, status,
          idempotency_key, codigo_transacao, criado_em, atualizado_em
   FROM tef_transacoes WHERE id = 1`
).get();
let tefLogCols = db.prepare('PRAGMA table_info(tef_logs)').all();
let tefLogs = [];
try {
  tefLogs = db.prepare('SELECT * FROM tef_logs WHERE transacao_id = 1 ORDER BY id').all();
} catch (e) {
  tefLogs = [{ erro: e.message, cols: tefLogCols }];
}
db.close();

const cryptoService = require(path.join(root, 'backend/services/crypto/cryptoService'));
let payload = null;
let decryptErro = null;
try {
  payload = cryptoService.descriptografarObjeto(row.payload_retorno);
} catch (e) {
  decryptErro = e.message;
}

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase();
    if (/(pan|card|cvv|senha|track|emv|token)/i.test(key) && typeof v === 'string' && v.length > 4) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const out = {
  camposResultado: {
    nsu: row.nsu,
    autorizacao: row.autorizacao,
    codigo_resposta: row.codigo_resposta,
    mensagem_resposta: row.mensagem_resposta,
    adquirente: row.adquirente,
    bandeira: row.bandeira,
    status: row.status,
    comprovante_cliente: row.comprovante_cliente,
    comprovante_estabelecimento: row.comprovante_estabelecimento,
    idempotency_key: row.idempotency_key,
    codigo_transacao: row.codigo_transacao,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em
  },
  decryptErro,
  payload: sanitize(payload),
  tefLogCols,
  tefLogs: sanitize(tefLogs)
};

fs.writeFileSync(path.join(__dirname, 'payload-id1.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  decryptOk: !!payload,
  decryptErro,
  financialState: payload?.financialState || null,
  persistencia: payload?.persistencia || null,
  continuidadeEstado: payload?.continuidade?.estado || null,
  solicitacao99: payload?.continuidade?.solicitacao99
    ? {
      codigoDestaxa: payload.continuidade.solicitacao99.codigoDestaxa,
      solicitadaEm: payload.continuidade.solicitacao99.solicitadaEm,
      chave: payload.continuidade.solicitacao99.chave || payload.continuidade.solicitacao99.acao?.chave || null
    }
    : null,
  nsu: row.nsu,
  autorizacao: row.autorizacao,
  tefLogsCount: Array.isArray(tefLogs) ? tefLogs.length : 0
}, null, 2));
