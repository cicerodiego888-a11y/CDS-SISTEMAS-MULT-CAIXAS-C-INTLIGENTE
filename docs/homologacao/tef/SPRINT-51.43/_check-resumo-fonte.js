'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%venda%'"
).all();
const venda = db.prepare(
  'SELECT id, tef_transacao_id, total, status FROM vendas WHERE id = 66'
).get();
const tx3 = db.prepare(
  'SELECT id, nsu, autorizacao, status, venda_id, adquirente, bandeira FROM tef_transacoes WHERE id = 3'
).get();
let pagamentos = null;
let pagamentosErr = null;
try {
  pagamentos = db.prepare('SELECT * FROM venda_pagamentos WHERE venda_id = 66').all();
} catch (e) {
  pagamentosErr = e.message;
}
let recebimentos = null;
try {
  recebimentos = db.prepare(
    'SELECT id, venda_id, valor, tef_transacao_id, status, nsu, autorizacao FROM venda_recebimentos WHERE venda_id = 66'
  ).all();
} catch (e) {
  recebimentos = { erro: e.message };
}

const resumoAtual = db.prepare(`
  SELECT
    v.id AS venda_id,
    vp.tef_transacao_id AS vp_tef,
    vp.tef_nsu AS vp_nsu,
    vp.tef_autorizacao AS vp_auth,
    tt.id AS tt_id,
    tt.nsu AS tt_nsu,
    tt.autorizacao AS tt_auth
  FROM vendas v
  LEFT JOIN venda_pagamentos vp
    ON vp.venda_id = v.id AND vp.tef_transacao_id IS NOT NULL
  LEFT JOIN tef_transacoes tt
    ON tt.id = v.tef_transacao_id OR tt.venda_id = v.id
  WHERE v.id = 66
  LIMIT 1
`).get();

console.log(JSON.stringify({
  tables,
  venda,
  tx3,
  pagamentos,
  pagamentosErr,
  recebimentos,
  resumoAtual
}, null, 2));
db.close();
