'use strict';

/**
 * TEF-DESTAXA-51.17 — dump readonly da linha id=1 (sem escrita).
 * node docs/homologacao/tef/TEF-DESTAXA-51.17/dump-id1-readonly.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DB = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';
const OUT = __dirname;

function sha256File(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (e) {
    return null;
  }
}

const db = new DatabaseSync(DB, { readOnly: true });

const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tef_transacoes'").get();
const cols = db.prepare('PRAGMA table_info(tef_transacoes)').all();
const row = db.prepare('SELECT * FROM tef_transacoes WHERE id = 1').get();
const pendentes = db.prepare(
  "SELECT id, status, valor, tipo, provedor, idempotency_key, criado_em, atualizado_em FROM tef_transacoes WHERE status='pendente'"
).all();
const porIdem = row?.idempotency_key
  ? db.prepare('SELECT id, status, valor, tipo, provedor, idempotency_key, criado_em FROM tef_transacoes WHERE idempotency_key = ?').all(row.idempotency_key)
  : [];
const porCodigo = row?.codigo_transacao
  ? db.prepare('SELECT id, status, codigo_transacao, idempotency_key FROM tef_transacoes WHERE codigo_transacao = ?').all(row.codigo_transacao)
  : [];

let logs = [];
try {
  logs = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tef_%'"
  ).all();
} catch (_) { /* ignore */ }

let tefLogs = [];
const temLogs = logs.some((t) => t.name === 'tef_logs');
if (temLogs) {
  try {
    tefLogs = db.prepare(
      'SELECT id, transacao_id, tipo, mensagem, detalhes, criado_em FROM tef_logs WHERE transacao_id = 1 ORDER BY id ASC LIMIT 200'
    ).all();
  } catch (e) {
    try {
      const colsLog = db.prepare('PRAGMA table_info(tef_logs)').all();
      tefLogs = [{ _erro: e.message, cols: colsLog }];
    } catch (e2) {
      tefLogs = [{ _erro: e.message, _erro2: e2.message }];
    }
  }
}

let auditoria = [];
try {
  const temAud = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='auditoria'"
  ).get();
  if (temAud) {
    auditoria = db.prepare(
      `SELECT id, modulo, acao, referencia_tipo, referencia_id, detalhes, data_hora
       FROM auditoria
       WHERE (referencia_tipo LIKE '%tef%' OR modulo = 'tef')
         AND (referencia_id = '1' OR referencia_id = 1 OR detalhes LIKE '%90b41858%' OR detalhes LIKE '%5aed71f2%')
       ORDER BY id DESC LIMIT 50`
    ).all();
  }
} catch (e) {
  auditoria = [{ _erro: e.message }];
}

let vendaRel = null;
if (row?.venda_id != null) {
  try {
    vendaRel = db.prepare('SELECT id, total, status, status_pagamento, tef_transacao_id, data_venda FROM vendas WHERE id = ?').get(row.venda_id);
  } catch (e) {
    vendaRel = { _erro: e.message };
  }
}

let recebimentos = [];
try {
  recebimentos = db.prepare(
    "SELECT id, venda_id, valor, status, tef_transacao_id, tipo_recebimento FROM venda_recebimentos WHERE tef_transacao_id = 1 OR tef_transacao_id = '1' LIMIT 20"
  ).all();
} catch (e) {
  recebimentos = [{ _erro: e.message }];
}

db.close();

// Decrypt attempt only if crypto service available - DO NOT invent; try read payload as-is
let payloadParsed = null;
let payloadRawPreview = null;
if (row && row.payload_retorno != null) {
  const raw = row.payload_retorno;
  if (Buffer.isBuffer(raw)) {
    payloadRawPreview = {
      type: 'buffer',
      length: raw.length,
      hexHead: raw.slice(0, 32).toString('hex')
    };
    const asUtf8 = raw.toString('utf8');
    if (asUtf8.trim().startsWith('{')) {
      try { payloadParsed = JSON.parse(asUtf8); } catch (_) { /* encrypted */ }
    }
  } else if (typeof raw === 'string') {
    payloadRawPreview = { type: 'string', length: raw.length, head: raw.slice(0, 80) };
    if (raw.trim().startsWith('{')) {
      try { payloadParsed = JSON.parse(raw); } catch (_) { /* encrypted */ }
    }
  } else {
    payloadRawPreview = { type: typeof raw };
  }
}

// Try official decrypt readonly (may open same db via app crypto - only decrypt buffer in memory)
let payloadDecrypted = null;
let decryptErro = null;
if (row?.payload_retorno && !payloadParsed) {
  try {
    const root = path.resolve(__dirname, '..', '..', '..', '..');
    const cryptoService = require(path.join(root, 'backend/services/cryptoService'));
    payloadDecrypted = cryptoService.descriptografarObjeto(row.payload_retorno);
  } catch (e) {
    decryptErro = e.message;
  }
}

const out = {
  coletadoEm: new Date().toISOString(),
  dbPath: DB,
  dbSha256: sha256File(DB),
  schemaSql: schema?.sql || null,
  colunas: cols,
  tabelasTef: logs,
  linha: row
    ? {
      ...Object.fromEntries(
        Object.entries(row).map(([k, v]) => {
          if (k === 'payload_retorno') {
            return [k, payloadRawPreview];
          }
          return [k, v];
        })
      )
    }
    : null,
  payloadParsed,
  payloadDecrypted,
  decryptErro,
  pendentes,
  porIdempotencyKey: porIdem,
  porCodigoTransacao: porCodigo,
  tefLogs,
  auditoria,
  vendaRel,
  recebimentos
};

fs.writeFileSync(path.join(OUT, 'dump-id1.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  ok: !!row,
  id: row?.id,
  status: row?.status,
  idempotency_key: row?.idempotency_key,
  payloadDecrypted: !!payloadDecrypted,
  decryptErro,
  tefLogsCount: Array.isArray(tefLogs) ? tefLogs.length : 0,
  pendentes: pendentes.length
}, null, 2));
