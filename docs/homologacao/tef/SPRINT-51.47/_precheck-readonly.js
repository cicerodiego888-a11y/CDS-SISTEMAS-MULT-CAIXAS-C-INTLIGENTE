'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const t = db.prepare('SELECT id,status,nsu,autorizacao,venda_id,idempotency_key,valor FROM tef_transacoes WHERE id IN (2,3)').all();
const v = db.prepare('SELECT id,total,status,status_pagamento,tef_transacao_id FROM vendas WHERE id=66').get();
const p = db.prepare("SELECT id,status FROM tef_transacoes WHERE status='pendente'").all();
const max = db.prepare('SELECT MAX(id) m FROM tef_transacoes').get();
db.close();
console.log(JSON.stringify({ t, v, p, max }, null, 2));
