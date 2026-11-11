'use strict';
/** SPRINT-51.38 — somente SELECT read-only sobre mercadao.db oficial. */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(
  process.env.PROGRAMDATA || 'C:\\ProgramData',
  'MercantilFiscal',
  'dados',
  'mercadao.db'
);

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

(async () => {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  try {
    const out = { dbPath, readOnly: true };
    out.tx = await get(
      db,
      `SELECT id, venda_id, tipo, valor, parcelas, status, provedor, adquirente, bandeira,
              nsu, autorizacao, codigo_transacao, codigo_resposta, mensagem_resposta,
              idempotency_key, comprovante_cliente, comprovante_estabelecimento,
              length(payload_retorno) AS payload_len,
              data_hora, criado_em, atualizado_em, created_at, updated_at,
              reversao_executada, reversao_motivo, reversao_data
       FROM tef_transacoes WHERE id = 2`
    );
    out.logs = await all(
      db,
      `SELECT id, transacao_id, tipo, mensagem, payload, criado_em, hash_integridade
       FROM tef_logs
       WHERE transacao_id = 2 OR (transacao_id IS NULL AND criado_em >= '2026-11-10 19:28:00' AND criado_em <= '2026-11-10 19:32:00')
       ORDER BY id`
    );
    out.locks = await all(db, `SELECT * FROM tef_locks ORDER BY id DESC LIMIT 20`).catch((e) => ({ error: e.message }));
    out.venda65 = await get(
      db,
      `SELECT id, codigo, total, valor_fiscal, valor_nao_fiscal, status, status_pagamento,
              forma_pagamento, tef_transacao_id, criado_em, created_at, updated_at
       FROM vendas WHERE id = 65`
    ).catch(async () => get(db, `SELECT id, codigo, total, valor_fiscal, status, status_pagamento, forma_pagamento, tef_transacao_id, created_at FROM vendas WHERE id = 65`));
    out.recebimentos65 = await all(db, `SELECT * FROM venda_recebimentos WHERE venda_id = 65`).catch((e) => ({ error: e.message }));
    // continuidade / solicitações se existirem
    const tables = (await all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tef%' ORDER BY name`)).map((r) => r.name);
    out.tefTables = tables;
    for (const t of ['tef_continuidade', 'tef_solicitacoes', 'tef_operacoes_nativas', 'tef_leases', 'tef_terminal_leases']) {
      if (tables.includes(t)) {
        out[t] = await all(db, `SELECT * FROM ${t} WHERE CAST(transacao_id AS TEXT)='2' OR CAST(tef_transacao_id AS TEXT)='2' OR id=2 ORDER BY 1 DESC LIMIT 20`).catch(async () => {
          try {
            return await all(db, `SELECT * FROM ${t} ORDER BY 1 DESC LIMIT 10`);
          } catch (e) {
            return { error: e.message };
          }
        });
      }
    }
    // payload dos logs relevantes (truncar se enorme)
    out.logsDetalhe = (out.logs || []).map((l) => {
      let payload = l.payload;
      let parsed = null;
      if (typeof payload === 'string' && payload.length) {
        try {
          parsed = JSON.parse(payload);
        } catch (_) {
          parsed = { rawPreview: String(payload).slice(0, 400) };
        }
      }
      return {
        id: l.id,
        tipo: l.tipo,
        mensagem: l.mensagem,
        criado_em: l.criado_em,
        payload: parsed
      };
    });
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
