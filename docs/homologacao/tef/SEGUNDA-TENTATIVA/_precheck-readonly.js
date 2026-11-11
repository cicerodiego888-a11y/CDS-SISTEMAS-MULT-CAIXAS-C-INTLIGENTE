'use strict';

/**
 * Pré-checks read-only — segunda tentativa TEF homologação.
 * Não emite permit, não chama TEF, não altera banco.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const LEDGER = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function main() {
  const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
  const out = { ts: new Date().toISOString(), db: DB };

  out.tefTransacoesCols = (await all(db, 'PRAGMA table_info(tef_transacoes)')).map((c) => c.name);
  out.tefLogsCols = (await all(db, 'PRAGMA table_info(tef_logs)')).map((c) => c.name);

  out.tx2 = await get(db, 'SELECT * FROM tef_transacoes WHERE id = 2');

  out.ativasOuUnknown = await all(
    db,
    `SELECT id, status, valor, tipo, venda_id, criado_em, atualizado_em
     FROM tef_transacoes
     WHERE LOWER(COALESCE(status,'')) IN (
       'pendente','em_andamento','processando','aguardando','unknown','inconclusivo','autorizada'
     )
     OR UPPER(COALESCE(status,'')) IN ('UNKNOWN','PENDING','INCONCLUSIVO')
     ORDER BY id DESC LIMIT 20`
  );

  out.ultimasTx = await all(
    db,
    `SELECT id, status, valor, tipo, venda_id, nsu, autorizacao, criado_em, atualizado_em
     FROM tef_transacoes ORDER BY id DESC LIMIT 8`
  );

  const logCols = out.tefLogsCols;
  const eventoCol = logCols.find((c) => /evento|tipo|acao|event/i.test(c)) || null;
  const payloadCol = logCols.find((c) => /payload|dados|detalhe|message|json/i.test(c)) || null;
  const createdCol = logCols.find((c) => /criado|created|data|timestamp/i.test(c)) || logCols[0];

  if (eventoCol && payloadCol) {
    out.leasesRecentes = await all(
      db,
      `SELECT id, ${eventoCol} AS evento, substr(${payloadCol},1,900) AS payload_preview, ${createdCol} AS criado_em
       FROM tef_logs
       WHERE ${eventoCol} LIKE '%LEASE%' OR ${eventoCol} LIKE '%lease%'
          OR ${payloadCol} LIKE '%lease%'
       ORDER BY id DESC LIMIT 20`
    );

    out.leaseId2Foco = await all(
      db,
      `SELECT id, ${eventoCol} AS evento, substr(${payloadCol},1,1200) AS payload_preview, ${createdCol} AS criado_em
       FROM tef_logs
       WHERE ${payloadCol} LIKE '%lease_1ddd7a48f3655670%'
          OR ${payloadCol} LIKE '%"id":2%'
          OR ${payloadCol} LIKE '%transacao%2%'
       ORDER BY id DESC LIMIT 25`
    );
  } else {
    out.leasesRecentes = [];
    out.leaseId2Foco = [];
    out.tefLogsSchemaNota = 'colunas de log não identificadas';
  }

  out.tefConfig = await get(
    db,
    `SELECT id, habilitado, provedor, ambiente, timeout, tentativas, tipo_integracao, atualizado_em
     FROM tef_configuracao ORDER BY id LIMIT 1`
  );

  try {
    out.tefOperacoes = await all(db, 'SELECT * FROM tef_operacoes LIMIT 20');
  } catch (e) {
    out.tefOperacoesErro = String(e.message || e);
  }

  try {
    out.pinpads = await all(db, 'SELECT * FROM tef_pinpads LIMIT 10');
  } catch (e) {
    out.pinpadsErro = String(e.message || e);
  }

  db.close();

  out.ledger = { path: LEDGER, exists: fs.existsSync(LEDGER) };
  if (out.ledger.exists) {
    const raw = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    out.ledger.autorizacoes = (raw.autorizacoes || []).map((a) => ({
      id: a.authorizationId,
      status: a.status,
      valorCentavos: a.valorCentavos,
      tipoPermitido: a.tipoPermitido,
      operacao: a.operacao,
      expiresAt: a.expiresAt,
      consumidoEm: a.consumidoEm,
      motivo: a.motivo
    }));
    out.ledger.issuedAtivas = out.ledger.autorizacoes.filter((a) => a.status === 'ISSUED');
    out.ledger.consumed = out.ledger.autorizacoes.filter((a) => a.status === 'CONSUMED');
  }

  out.gateEnv = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;

  const authMod = require('../../../../backend/services/tef/destaxa/destaxaAutorizacaoExcepcional');
  out.permitMeta = {
    valorCentavos: authMod.VALOR_HOMOLOGACAO_CENTAVOS,
    ttlPadraoMs: authMod.TTL_PADRAO_MS
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
