'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId, COUNT(*) AS total FROM tef_transacoes').get();
const txs = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, bandeira, adquirente
  FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id
`).all();
const v66 = db.prepare(`
  SELECT id, status, status_pagamento, tef_transacao_id FROM vendas WHERE id = 66
`).get();
const v67 = db.prepare(`
  SELECT id, status, status_pagamento, tef_transacao_id FROM vendas WHERE id = 67
`).get();
const rec80 = db.prepare(`
  SELECT id, venda_id, tef_transacao_id, nsu, autorizacao, status
  FROM venda_recebimentos WHERE id = 80
`).get();
const pend = db.prepare(`
  SELECT id, status FROM tef_transacoes
  WHERE status = 'pendente' OR lower(status) = 'unknown'
`).all();
db.close();

const ledgerPath = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);
let ledger = null;
if (fs.existsSync(ledgerPath)) {
  const j = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger = {
    issued: (j.autorizacoes || [])
      .filter((a) => a.status === 'ISSUED')
      .map((a) => ({ id: a.authorizationId, expiresAt: a.expiresAt })),
    last: (j.autorizacoes || []).slice(-3).map((a) => ({
      id: a.authorizationId,
      status: a.status,
      consumidoEm: a.consumidoEm || null,
      motivo: a.motivo || null
    }))
  };
}

const out = {
  gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  max,
  txs,
  v66,
  v67,
  rec80,
  pend,
  ledger
};

fs.writeFileSync(
  path.join(__dirname, 'integridade-readonly.json'),
  `${JSON.stringify(out, null, 2)}\n`,
  'utf8'
);
console.log(JSON.stringify(out, null, 2));
