'use strict';
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const LEDGER = path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'tef', 'destaxa-autorizacao-excepcional.json');

function get(db, sql, p = []) {
  return new Promise((resolve, reject) => db.get(sql, p, (e, r) => (e ? reject(e) : resolve(r || null))));
}
function all(db, sql, p = []) {
  return new Promise((resolve, reject) => db.all(sql, p, (e, r) => (e ? reject(e) : resolve(r || []))));
}

(async () => {
  const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
  const tx3 = await get(db, 'SELECT * FROM tef_transacoes WHERE id = 3');
  const txByKey = await get(
    db,
    `SELECT id,status,nsu,autorizacao,venda_id,valor,tipo,codigo_resposta,mensagem_resposta,
            length(comprovante_cliente) AS len_comp_cli,
            length(comprovante_estabelecimento) AS len_comp_loj,
            criado_em, atualizado_em, idempotency_key
     FROM tef_transacoes WHERE idempotency_key = ?`,
    ['tef-segunda-tentativa-bd6a8809bc64abb7']
  );
  const logs = await all(
    db,
    `SELECT id, tipo, mensagem, substr(payload,1,500) AS p, criado_em
     FROM tef_logs WHERE transacao_id = 3 ORDER BY id`
  );
  const venda = await get(
    db,
    `SELECT id, total, valor_fiscal, status, status_pagamento, tef_transacao_id, forma_pagamento
     FROM vendas WHERE id = 66`
  );
  db.close();

  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const permit = (ledger.autorizacoes || []).find((a) => a.authorizationId === 'cff481501f704f672b3e956f4bcb62b4');

  const out = {
    ts: new Date().toISOString(),
    tx3Resumo: txByKey,
    tx3Nsu: tx3 && tx3.nsu,
    tx3Autorizacao: tx3 && tx3.autorizacao,
    tx3Status: tx3 && tx3.status,
    tx3ComprovanteClienteLen: tx3 && tx3.comprovante_cliente ? String(tx3.comprovante_cliente).length : 0,
    tx3ComprovanteLojaLen: tx3 && tx3.comprovante_estabelecimento ? String(tx3.comprovante_estabelecimento).length : 0,
    logs: logs.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      mensagem: l.mensagem,
      criado_em: l.criado_em,
      acao: (String(l.p).match(/"acao":"([^"]+)"/) || [])[1] || null,
      codigo: (String(l.p).match(/"codigoDestaxa":"([^"]+)"/) || [])[1]
        || (String(l.p).match(/"codigo":"([^"]+)"/) || [])[1] || null
    })),
    venda66: venda,
    permit,
    gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
  };
  fs.writeFileSync(path.join(__dirname, 'estado-final-db.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
