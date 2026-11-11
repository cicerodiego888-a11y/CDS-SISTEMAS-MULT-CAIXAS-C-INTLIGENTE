'use strict';
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const LEDGER = path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'tef', 'destaxa-autorizacao-excepcional.json');

function all(db, sql, p = []) {
  return new Promise((resolve, reject) => db.all(sql, p, (e, r) => (e ? reject(e) : resolve(r || []))));
}
function get(db, sql, p = []) {
  return new Promise((resolve, reject) => db.get(sql, p, (e, r) => (e ? reject(e) : resolve(r || null))));
}

(async () => {
  const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
  const out = {
    ts: new Date().toISOString(),
    tx2: await get(db, 'SELECT id,status,nsu,autorizacao,atualizado_em FROM tef_transacoes WHERE id=2'),
    ativas: await all(
      db,
      `SELECT id,status,valor,tipo,venda_id FROM tef_transacoes
       WHERE LOWER(COALESCE(status,'')) IN ('pendente','em_andamento','processando','aguardando','unknown','inconclusivo','autorizada')
          OR UPPER(COALESCE(status,'')) IN ('UNKNOWN','PENDING','INCONCLUSIVO')`
    ),
    sessaoCaixa: await get(
      db,
      `SELECT * FROM caixa_sessoes WHERE status IN ('aberta','ABERTA','aberto','ABERTO') OR data_fechamento IS NULL ORDER BY id DESC LIMIT 1`
    ).catch(() => null),
    cfg: await get(db, 'SELECT habilitado,provedor,ambiente FROM tef_configuracao ORDER BY id LIMIT 1')
  };
  db.close();
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { autorizacoes: [] };
  out.issued = (ledger.autorizacoes || []).filter((a) => a.status === 'ISSUED').map((a) => ({
    id: a.authorizationId, valorCentavos: a.valorCentavos, expiresAt: a.expiresAt, status: a.status
  }));
  out.gate = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;
  console.log(JSON.stringify(out, null, 2));
  const bloqueio = out.ativas.length > 0 || (out.tx2 && out.tx2.status !== 'negado');
  process.exit(bloqueio ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
