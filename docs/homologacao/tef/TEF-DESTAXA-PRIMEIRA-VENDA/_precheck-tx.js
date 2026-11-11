'use strict';
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

(async () => {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  try {
    const ativas = await all(
      db,
      `SELECT id, status, tipo, valor, nsu, autorizacao, criado_em, atualizado_em
       FROM tef_transacoes
       WHERE lower(coalesce(status,'')) IN ('pendente','em_andamento','processando','aguardando','coleta','opcao','unknown','inconclusivo')
       ORDER BY id DESC LIMIT 20`
    );
    const recentes = await all(
      db,
      `SELECT id, status, tipo, valor, nsu, autorizacao, criado_em, atualizado_em
       FROM tef_transacoes
       ORDER BY id DESC LIMIT 5`
    );
    const cfg = await all(db, 'SELECT id, habilitado, provedor, ambiente FROM tef_configuracao LIMIT 1');
    const pin = await all(db, 'SELECT habilitado, modelo, porta_com, codigo, ativo FROM tef_pinpads LIMIT 5');
    const ops = await all(db, 'SELECT debito FROM tef_operacoes LIMIT 1');
    console.log(JSON.stringify({
      dbPath,
      transacoesAtivas: ativas,
      recentes,
      cfg,
      pin,
      ops,
      gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
    }, null, 2));
  } finally {
    db.close();
  }
})();
